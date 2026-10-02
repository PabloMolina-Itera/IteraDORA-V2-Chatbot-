import type { APIRoute } from "astro";

import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@aws-sdk/signature-v4";

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
 *   AWS_REGION          – Región de la Function URL. Default us-east-1.
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN – Credenciales de AWS. Opcionales:
 *                         si no están, se usa la cadena de proveedores por defecto (rol IAM de la
 *                         instancia en despliegues en contenedor).
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

/** Servicio de AWS al que se firma: el de las Function URL de Lambda. */
const SIGNING_SERVICE = "lambda";
const AWS_DEFAULT_REGION = "us-east-1";

/**
 * OJO: AWS_REGION y las credenciales se leen SÓLO de `process.env`, a diferencia de
 * LAMBDA_FUNCTION_URL y LAMBDA_TIMEOUT_MS. Es deliberado: Vite congela `import.meta.env` en el
 * bundle de build, así que leer una clave de AWS por ahí la escribiría dentro del artefacto
 * desplegado (claves de larga duración en el disco, versionadas junto al build). `process.env` no
 * se congela y es de todas formas lo que el adapter node lee en producción. Para `AWS_REGION` la
 * diferencia es inocua: tiene default. Para las credenciales no: sin variables de entorno la
 * cadena de proveedores por defecto resuelve el rol IAM de la instancia.
 */
const AWS_REGION = (process.env.AWS_REGION || "").trim() || AWS_DEFAULT_REGION;

/**
 * Proveedor por defecto de credenciales: variables de entorno → SSO → web identity token →
 * ~/.aws/*.ini → ECS/EC2 Instance Metadata. Se acota el timeout de IMDS para que el caso "no hay
 * credenciales" falle rápido en vez de colgar la request. Se memoiza a nivel de módulo para no
 * reintentar la resolución en cada request.
 */
const defaultCredentials = defaultProvider({ timeout: 1000, maxRetries: 1 });

/** Subconjunto de `AwsCredentialIdentity` que necesitamos, para no depender de tipos internos. */
type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Traduce los headers que devuelve el firmador a un objeto plano para `fetch`.
 * `SignatureV4` los entrega como objeto con las claves ya en minúscula; se acepta también un
 * `Headers`/`Map` por si la versión del SDK cambia la forma.
 */
function toHeaderRecord(signed: unknown): Record<string, string> {
  const source: [string, unknown][] =
    typeof (signed as { entries?: unknown } | null)?.entries === "function"
      ? [...(signed as { entries(): IterableIterator<[string, string]> }).entries()]
      : Object.entries((signed ?? {}) as Record<string, unknown>);

  const headers: Record<string, string> = {};
  for (const [name, value] of source) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return headers;
}

/**
 * Devuelve un firmador SigV4 para la Function URL, o `null` si no se pueden resolver credenciales.
 *
 * Prioridad: variables de entorno explícitas, y si no hay, la cadena de proveedores por defecto
 * (que es lo que hace que funcione el rol IAM de la instancia en contenedores). La resolución va
 * envuelta en try/catch a propósito: los proveedores lanzan cuando no encuentran nada, y acá eso
 * se traduce en "no se puede firmar", nunca en un request sin firma.
 */
async function buildSigner(): Promise<SignatureV4 | null> {
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const sessionToken = (process.env.AWS_SESSION_TOKEN || "").trim();

  let credentials: AwsCredentials | null = null;
  if (accessKeyId && secretAccessKey) {
    credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  } else {
    try {
      credentials = await defaultCredentials();
    } catch (err) {
      console.error("No se pudieron resolver credenciales de AWS para firmar la llamada:", err);
      credentials = null;
    }
  }

  if (!credentials) return null;

  return new SignatureV4({
    service: SIGNING_SERVICE,
    region: AWS_REGION,
    credentials,
    sha256: Sha256,
  });
}

/**
 * Firma el POST con SigV4 y devuelve los headers para `fetch`.
 *
 * `host` se declara explícitamente en la petición que se firma: el firmador sólo entra al cálculo
 * de la firma con los headers que recibe, y sin `host` la firma no coincidiría con lo que AWS
 * valida. El `x-amz-security-token` de las credenciales temporales lo agrega el firmador solo.
 */
async function signedHeaders(
  signer: SignatureV4,
  url: URL,
  body: string
): Promise<Record<string, string>> {
  const signed = await signer.sign({
    method: "POST",
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: { "content-type": "application/json", host: url.host },
    body,
  });

  return toHeaderRecord(signed.headers);
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
  // El body se serializa UNA sola vez y esa misma cadena es la que se firma y la que se envía:
  // firmar un payload y mandar otro es la causa clásica de `InvalidSignature`.
  const body = JSON.stringify(payload);

  const url = new URL(LAMBDA_FUNCTION_URL);
  const signer = await buildSigner();
  if (!signer) {
    // Fail closed: sin firma NO se manda nada. Un fallback sin firma reabriría exactamente la
    // exposición que cierra este proxy.
    console.error(
      "No hay credenciales de AWS: no se envía la petición a la Lambda porque iría sin firmar."
    );
    return json(503, {
      error: "El asistente no está disponible en este momento.",
      hint:
        "Configurá AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY (opcional AWS_SESSION_TOKEN), " +
        "o ejecutá el backend con un rol IAM asociado. La Function URL requiere AWS_IAM.",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAMBDA_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: await signedHeaders(signer, url, body),
      body,
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
