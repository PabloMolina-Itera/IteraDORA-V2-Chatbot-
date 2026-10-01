import type { APIRoute } from "astro";

export const prerender = false;

/**
 * Proxy hacia la Lambda `IteraDORA-Lambda` (AWS).
 *
 * La Lambda es la única implementación del chat y del envío de correo. Este endpoint existe para
 * que el navegador nunca hable directo con AWS: sin esto habría que exponer la Function URL con
 * Auth=NONE al público y/o embeber credenciales en el bundle del cliente.
 *
 * Variables de entorno (server-only, sin prefijo PUBLIC_):
 *   LAMBDA_FUNCTION_URL – Function URL de la Lambda. Sin este valor el chat no tiene backend.
 *   LAMBDA_TIMEOUT_MS   – Timeout de la llamada. Default 9000.
 *
 * Se leen de `import.meta.env` y de `process.env` a propósito: Vite reemplaza `import.meta.env`
 * de forma estática al compilar, así que en el server ya construido ese valor queda congelado en
 * build. `process.env` es la única fuente real en tiempo de ejecución del adapter node, y en
 * `astro dev` es `import.meta.env` la que lee el `.env`. Consultando ambas funciona en los dos casos.
 *
 * Contrato Body → Lambda (sin traducción, se reenvía tal cual):
 *   { messages: [...] }                        → respuesta del chat
 *   { action: "SEND_EMAIL", userData: {...} }   → envío del informe por correo (SES)
 */

const LAMBDA_FUNCTION_URL = (
  import.meta.env.LAMBDA_FUNCTION_URL ||
  process.env.LAMBDA_FUNCTION_URL ||
  ""
).trim();
const LAMBDA_TIMEOUT_MS = Number(
  import.meta.env.LAMBDA_TIMEOUT_MS || process.env.LAMBDA_TIMEOUT_MS
) || 9000;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Traduce cualquier fallo de transporte hacia la Lambda a un error accionable para el cliente. */
function lambdaError(message: string, hint?: string): Response {
  return json(502, { error: message, ...(hint ? { hint } : {}) });
}

/**
 * Reenvía el payload a la Lambda y devuelve su respuesta sin reinterpretarla.
 * La Lambda ya valida su propio body y devuelve errores con mensaje útil.
 */
async function forwardToLambda(payload: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAMBDA_TIMEOUT_MS);

  try {
    const upstream = await fetch(LAMBDA_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await upstream.text();

    let parsed: unknown = null;
    let parseFailed = false;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parseFailed = true;
    }

    if (parseFailed) {
      console.error(`Respuesta no-JSON de la Lambda (HTTP ${upstream.status}):`, raw.slice(0, 300));
      return lambdaError(
        "El asistente devolvió una respuesta inválida.",
        `HTTP ${upstream.status} desde la Lambda.`
      );
    }

    // El estado lo decide la Lambda: 200 chat, 400 body inválido, 502 error de envío, etc.
    return json(upstream.status, parsed);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("Fallo la llamada a la Lambda:", err);
    return lambdaError(
      aborted
        ? `El asistente tardó más de ${LAMBDA_TIMEOUT_MS}ms y se cortó la petición.`
        : "No se pudo conectar con el asistente.",
      aborted
        ? "Intentá de nuevo en unos segundos."
        : "Verificá que LAMBDA_FUNCTION_URL esté configurada y la Lambda desplegada."
    );
  } finally {
    clearTimeout(timer);
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!LAMBDA_FUNCTION_URL) {
    console.error("Falta configurar LAMBDA_FUNCTION_URL: el backend no tiene a dónde reenviar.");
    return json(503, {
      error: "El asistente no está disponible en este momento.",
      hint: "Configurá LAMBDA_FUNCTION_URL con la Function URL de IteraDORA-Lambda.",
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "El body debe ser JSON válido." });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { error: "El body debe ser un objeto JSON." });
  }

  return forwardToLambda(payload);
};
