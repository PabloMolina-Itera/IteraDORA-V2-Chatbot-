import type { APIRoute } from "astro";

export const prerender = false;

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_MODEL = import.meta.env.OLLAMA_MODEL || "llama3.2:3b";

async function ollamaChat(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: {
        num_predict: 300,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.substring(0, 200)}`);
  }

  const json = await res.json();
  return json.message?.content || "";
}

const PREGUNTAS = [
  "¿Las definiciones del pipeline están bajo control de código fuente (SCM) tales como GitHub, GitLab, etc.?",
  "¿La Infraestructura como código (IaC) se usa como un estándar?",
  "El código se integra en la rama principal de desarrollo al menos una vez al día.",
  "¿Las builds o despliegues fallidos son atendidos inmediatamente por el equipo (squad) como la máxima prioridad a corregir?",
  "¿Las builds del pipeline fallan si los estándares aplicados programáticamente (como cobertura de pruebas o linters) alcanzan los umbrales de fallo acordados?",
  "¿El pipeline despliega automáticamente el artefacto en el entorno más bajo (si aplica) (Ej: Entorno Test o Entorno Dev)?",
  "Uso de feature toggles (banderas de funcionalidad) para permitir un desarrollo rápido y la integración del equipo.",
  "¿Las funcionalidades incompletas pueden liberarse de forma segura a producción; es decir, el código siempre está en un estado liberable?",
  "¿Se crea código desplegable y testeable de forma independiente?",
  "¿Las builds fallan cuando los escaneos de seguridad detectan amenazas por encima de un cierto nivel de severidad?",
  "¿Se realizan chequeos de salud (health checks) como pruebas smoke en producción?",
];

const TOTAL = PREGUNTAS.length;

function buildSystemPrompt(): string {
  return `Eres IteraDORA, asistente de diagnostico DevOps DORA. Responde en español, frases cortas. No expliques terminos. No te disculpes.

CONTEXTO: La presentacion y la Pregunta 1 ya fueron mostradas al usuario. El usuario esta respondiendo Si o No a la Pregunta 1. Tu trabajo es continuar desde ahi.

Cuando el usuario responda Si o No, di: "Gracias. Pregunta X de ${TOTAL}:" y haz la siguiente pregunta, donde X es el numero de la pregunta que sigue.

Las preguntas son (continuas desde la 2 en adelante):
${PREGUNTAS.map((a, i) => `Pregunta ${i + 1}: ${a}`).join("\n")}

Al terminar todas las preguntas responde exactamente:
"RESULTADO DEL DIAGNOSTICO:
Nivel: [Fundacional, Intermedio o Avanzado]
Puntaje: [calculado automaticamente]
Rangos: 0-33% Fundacional, 34-66% Intermedio, 67-100% Avanzado.
Te gustaria recibir recomendaciones personalizadas para mejorar tu puntaje?"

Cuando te pidan recomendaciones da sugerencias breves. Termina con: "Gracias por confiar en IteraDORA. Sigue mejorando tus practicas DevOps!"

Si el usuario escribe algo que no es Si o No: "Responde Si o No a la pregunta actual, por favor."`;
}

const RESPUESTAS_VALIDAS = ["Sí", "No", "Quiero recomendaciones", "Si", "si", "no"];

function validarMensaje(messages: { role: string; content: string }[]): string | null {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return null;

  const ultimo = userMessages[userMessages.length - 1].content.trim();

  if (RESPUESTAS_VALIDAS.includes(ultimo)) return null;

  // Bloqueado
  return "Responde Si o No a la pregunta actual, por favor. Usa los botones disponibles.";
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { messages } = await request.json();

    // Filtrar mensajes off-topic ANTES de llamar a Ollama
    const bloqueo = validarMensaje(messages);
    if (bloqueo) {
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: bloqueo } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = buildSystemPrompt();
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const content = await ollamaChat(ollamaMessages);

    if (!content) {
      return new Response(
        JSON.stringify({ error: "El modelo no generó respuesta. Intenta de nuevo." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        message: { role: "assistant", content },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "No se pudo conectar con Ollama",
        detail: err.message,
        hint: "Verifica que Ollama esté instalado y corriendo en http://127.0.0.1:11434",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
};
