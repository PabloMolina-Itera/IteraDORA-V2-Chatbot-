import type { APIRoute } from "astro";

export const prerender = false;

// ─── Configuración ───
const OLLAMA_URL = import.meta.env.OLLAMA_URL || "";
const OLLAMA_MODEL = import.meta.env.OLLAMA_MODEL || "llama3.2:3b";
const BEDROCK_MODEL = import.meta.env.BEDROCK_MODEL || "us.anthropic.claude-3-haiku-20240307-v1:0";
const AWS_REGION = import.meta.env.AWS_REGION || "us-east-1";
const USE_OLLAMA = !!OLLAMA_URL;

// ─── Cliente Bedrock lazy (evita crash si el SDK no está disponible) ───
let bedrockClient: any = null;
let bedrockInitAttempted = false;

async function getBedrockClient() {
  if (!bedrockInitAttempted && !USE_OLLAMA) {
    bedrockInitAttempted = true;
    try {
      const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
      bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
    } catch (e: any) {
      console.error("Bedrock init error:", e.message);
    }
  }
  return bedrockClient;
}

// ─── BEDROCK (CLAUDE) ───
async function bedrockChat(messages: { role: string; content: string }[]): Promise<string> {
  const client = await getBedrockClient();
  if (!client) throw new Error("Bedrock no disponible");

  const systemMsg = messages.find((m: any) => m.role === "system");
  const systemText = systemMsg ? systemMsg.content : "";
  const chatMessages = messages
    .filter((m: any) => m.role !== "system")
    .map((m: any) => ({
      role: m.role,
      content: [{ type: "text", text: m.content }],
    }));

  const { InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 500,
      temperature: 0.3,
      system: systemText,
      messages: chatMessages,
    }),
  });

  const response = await client.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.content?.[0]?.text || "";
}

// ─── OLLAMA (FALLBACK) ───
async function ollamaChat(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: { num_predict: 500, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.substring(0, 200)}`);
  }
  const json = await res.json();
  return json.message?.content || "";
}

// ─── LLAMADA UNIFICADA ───
async function callAI(messages: { role: string; content: string }[]): Promise<string> {
  if (USE_OLLAMA) return ollamaChat(messages);
  return bedrockChat(messages);
}

const PREGUNTAS = [
  `Tema: Control de versiones y trazabilidad

Para comenzar, revisemos cómo gestionan la configuración de sus procesos de integración y despliegue.

¿Las definiciones del pipeline están bajo control de código fuente (SCM) como GitHub o GitLab?`,

  `Tema: Infraestructura como Código

La automatización de la infraestructura ayuda a reducir errores manuales y mejorar la consistencia entre entornos.

¿La Infraestructura como Código (IaC) se utiliza como estándar en su organización?`,

  `Tema: Integración Continua

La integración frecuente permite detectar problemas más rápido y reducir conflictos entre desarrolladores.

¿El código se integra en la rama principal al menos una vez al día?`,

  `Tema: Estabilidad del pipeline

Un pipeline inestable puede afectar significativamente la velocidad de entrega.

¿Las builds o despliegues fallidos son tratados como la máxima prioridad por el equipo?`,

  `Tema: Calidad automatizada

Los controles automáticos ayudan a mantener estándares de calidad consistentes.

¿Las builds fallan automáticamente cuando no se cumplen los umbrales acordados de calidad, cobertura o análisis estático?`,

  `Tema: Automatización de despliegues

Evaluemos el nivel de automatización de los entornos de desarrollo y pruebas.

¿El pipeline despliega automáticamente los artefactos en el entorno más bajo disponible (Dev o Test)?`,

  `Tema: Feature Toggles

Las banderas de funcionalidad permiten desplegar código sin exponer funcionalidades incompletas.

¿Utilizan feature toggles para facilitar el desarrollo y la integración continua del equipo?`,

  `Tema: Estado liberable

Las organizaciones con alta madurez DevOps suelen mantener su código en un estado constantemente desplegable.

¿Las funcionalidades incompletas pueden liberarse de forma segura a producción sin afectar a los usuarios?`,

  `Tema: Arquitectura desacoplada

La independencia entre componentes facilita pruebas, despliegues y mantenimiento.

¿El código puede desarrollarse, probarse y desplegarse de forma independiente?`,

  `Tema: Seguridad integrada

La seguridad es más efectiva cuando forma parte del pipeline de desarrollo.

¿Las builds fallan automáticamente cuando los escaneos detectan vulnerabilidades por encima del nivel de riesgo aceptado?`,

  `Tema: Observabilidad y confiabilidad

Por último, revisemos las prácticas de validación en producción.

¿Se ejecutan health checks o pruebas smoke para verificar que los servicios funcionan correctamente después del despliegue?`,
];

const TOTAL = PREGUNTAS.length;

// Configuración compartida del diagnóstico profundo
const DEEP_PRACTICES: Record<string, Record<string, number>> = {
  Fundacional:  { CV: 1, BD: 2, EC: 3, AP: 5, IS: 6, IC: 2 },
  Intermedio:   { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 },
  Avanzado:     { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 }
};

function buildSystemPrompt(respuestasCount: number = 0): string {
  // ── Fase de preguntas ──
  if (respuestasCount < TOTAL) {
    const idx = Math.max(0, respuestasCount); // índice de la PRÓXIMA pregunta
    if (idx < PREGUNTAS.length) {
      // Prompt mínimo: solo la pregunta exacta, sin lista completa que confunda al modelo
      return `Eres IteraDORA, un asistente que realiza diagnósticos DevOps. Responde en español, tono profesional y cálido.

REGLAS ESTRICTAS:
1. TU ÚNICA TAREA es repetir exactamente el texto que el sistema te indica abajo. NADA MÁS.
2. NO inventes preguntas. NO cambies el tema. NO agregues texto extra.

RESPONDE ÚNICAMENTE CON ESTE TEXTO:

¡Ánimo! Vas muy bien.

Pregunta ${idx + 1} de ${TOTAL}:

${PREGUNTAS[idx]}`;
    }
  }

  // ── Resultado final ──
  return `Eres IteraDORA, un asistente que realiza diagnósticos DevOps usando la metodología DORA. Responde en español, tono profesional y cálido.

El usuario ya respondió las ${TOTAL} preguntas. Entrega el diagnóstico final con este formato:

RESULTADO DEL DIAGNÓSTICO:

Nivel: [clasificación basada en las respuestas]

[breve resumen del nivel]

Luego indica que puede pedir recomendaciones o hacer el diagnóstico profundo.

REGLAS:
- NO hagas más preguntas. El diagnóstico ya terminó.
- Si el usuario pide recomendaciones, entrégalas agrupadas por FORTALEZAS, OPORTUNIDADES DE MEJORA y CONCLUSIÓN.
- Si el usuario escribe otra cosa, recuérdale que puede pedir recomendaciones.`;
}

const RESPUESTAS_VALIDAS = ["Sí", "No", "Quiero recomendaciones", "Si", "si", "no"];

// ─── DEEP DIAGNOSTIC PROMPT ───
function buildDeepDiagnosticPrompt(level: string, respuestasCount: number = 0): string {
  const cats = DEEP_PRACTICES[level] || DEEP_PRACTICES["Intermedio"];
  const totalPracticas = Object.values(cats).reduce((a: number, b: number) => a + b, 0);

  // ── Primera pregunta: texto fijo desde el backend ──
  if (respuestasCount === 0) {
    return `Eres IteraDORA. Diagnóstico profundo nivel ${level}. Responde en español.

RESPONDE ÚNICAMENTE CON ESTE TEXTO:

[CV] Pregunta 1 de ${totalPracticas}:

Tema: Sistema de Control de Versiones

Un sistema de control de versiones como Git es la base fundamental de cualquier práctica DevOps.

¿La organización utiliza un sistema de control de versiones como Git para gestionar todos sus repositorios de código?`;
  }

  // ── Preguntas siguientes: instrucción simple ──
  if (respuestasCount < totalPracticas) {
    return `Eres IteraDORA. Diagnóstico profundo DevOps nivel ${level}. Responde en español.

El usuario respondió ${respuestasCount} de ${totalPracticas} prácticas. Ahora te toca la pregunta ${respuestasCount + 1} de ${totalPracticas}.

FORMATO OBLIGATORIO - copia esta estructura exacta:

[CAT] Pregunta ${respuestasCount + 1} de ${totalPracticas}:

Tema: [título corto]

[una frase explicando la importancia]

¿[pregunta concreta de Sí o No]?

REEMPLAZA [CAT] por una de estas siglas según la categoría que corresponda:
- CV = Control de Versiones (${cats.CV} prácticas en total)
- BD = Build & Deploy (${cats.BD} prácticas en total)
- EC = Code Standards (${cats.EC} prácticas en total)
- AP = Test Automation (${cats.AP} prácticas en total)
- IS = Security Engineering (${cats.IS} prácticas en total)
- IC = Continuous Integration (${cats.IC} prácticas en total)

El orden es: CV → BD → EC → AP → IS → IC. Ya se respondieron ${respuestasCount}. La categoría actual es la que corresponda según el orden y conteo.

NO escribas recomendaciones. NO escribas análisis. SOLO la pregunta.`;
  }

  // ── Resultado final ──
  return `Eres IteraDORA. Diagnóstico profundo nivel ${level} COMPLETADO. Responde en español.

El usuario respondió las ${totalPracticas} prácticas. Calcula los aciertos (Sí = acierto) y muestra:

=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===
CV: [aciertos]/${cats.CV} ([porcentaje]%)
BD: [aciertos]/${cats.BD} ([porcentaje]%)
EC: [aciertos]/${cats.EC} ([porcentaje]%)
AP: [aciertos]/${cats.AP} ([porcentaje]%)
IS: [aciertos]/${cats.IS} ([porcentaje]%)
IC: [aciertos]/${cats.IC} ([porcentaje]%)

Solo el bloque de resultados. Nada más.`;
}

function validarMensaje(messages: { role: string; content: string }[]): string | null {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return null;

  const ultimo = userMessages[userMessages.length - 1].content.trim();

  if (RESPUESTAS_VALIDAS.includes(ultimo)) return null;

  // Bloqueado
  return "Responde Si o No a la pregunta actual, por favor. Usa los botones disponibles.";
}

function contarRespuestas(messages: { role: string; content: string }[]): number {
  const validas = ["Sí", "No", "Si", "si", "no", "sí", "SÍ", "NO"];
  let count = 0;
  for (const m of messages) {
    if (m.role !== "user") continue;
    const content = m.content.trim();
    if (validas.includes(content)) {
      count++;
    }
  }
  return count;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { messages } = await request.json();

    // ── Detectar modo diagnóstico profundo ──
    let isDeepDiagnostic = false;
    let deepLevel = "";

    const lastMsg = messages.length > 0 ? (messages[messages.length - 1].content || "") : "";
    const deepMatch = lastMsg.match(/^\[DEEP:(\w+)\]:/);
    if (deepMatch) {
      isDeepDiagnostic = true;
      deepLevel = deepMatch[1];
      // Limpiar TODOS los mensajes del usuario con prefijo [DEEP:...]
      for (let di = 0; di < messages.length; di++) {
        if (messages[di].role === "user") {
          const dm = messages[di].content.match(/^\[DEEP:\w+\]:(.*)/);
          if (dm) {
            let clean = dm[1].trim();
            if (!clean || clean.toUpperCase() === "INICIAR" || clean.toUpperCase() === "INICIAR DIAGNÓSTICO" || clean.toUpperCase() === "INICIAR DIAGNOSTICO") {
              clean = "Quiero iniciar el diagnóstico profundo de nivel " + deepLevel;
            }
            messages[di].content = clean;
          }
        }
      }
    }

    const respuestasCount = contarRespuestas(messages);

    // ── DIAGNÓSTICO GENERAL: todas las preguntas SIN LLM ──
    if (!isDeepDiagnostic && respuestasCount < TOTAL) {
      const idx = respuestasCount;
      if (idx < PREGUNTAS.length) {
        const animo = idx > 0 ? "¡Ánimo! Vas muy bien.\n\n" : "";
        const preguntaDirecta = `${animo}Pregunta ${idx + 1} de ${TOTAL}:\n\n${PREGUNTAS[idx]}`;
        return new Response(
          JSON.stringify({ message: { role: "assistant", content: preguntaDirecta } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // ── DIAGNÓSTICO PROFUNDO: primera pregunta SIN LLM ──
    if (isDeepDiagnostic && respuestasCount === 0) {
      const cats = DEEP_PRACTICES[deepLevel] || DEEP_PRACTICES["Intermedio"];
      const total = Object.values(cats).reduce((a: number, b: number) => a + b, 0);
      const preguntaDirecta = `[CV] Pregunta 1 de ${total}:\n\nTema: Sistema de Control de Versiones\n\nUn sistema de control de versiones como Git es la base fundamental de cualquier práctica DevOps.\n\n¿La organización utiliza un sistema de control de versiones como Git para gestionar todos sus repositorios de código?`;
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: preguntaDirecta } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── DIAGNÓSTICO GENERAL: off-topic ──
    if (!isDeepDiagnostic) {
      const bloqueo = validarMensaje(messages);
      if (bloqueo) {
        return new Response(
          JSON.stringify({ message: { role: "assistant", content: bloqueo } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // ── LLAMADA A IA: solo para resultado final, recomendaciones, o resto del diagnóstico profundo ──
    if (!USE_OLLAMA && !(await getBedrockClient())) {
      return new Response(
        JSON.stringify({ error: "No hay motor de IA configurado", hint: "Configura OLLAMA_URL o asegura que las credenciales AWS estén disponibles para Bedrock." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = isDeepDiagnostic ? buildDeepDiagnosticPrompt(deepLevel, respuestasCount) : buildSystemPrompt(respuestasCount);
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const content = await callAI(aiMessages);

    if (!content) {
      return new Response(
        JSON.stringify({ error: "El modelo no generó respuesta. Intenta de nuevo." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: { role: "assistant", content } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Error al llamar al modelo de IA",
        detail: err.message,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
};
