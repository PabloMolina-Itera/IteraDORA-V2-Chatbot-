// ─── IteraDORA Lambda Backend ───
// Reemplaza src/pages/api/chat.ts para despliegue en AWS Amplify
//
// Configuración (variables de entorno en AWS Lambda):
//   OLLAMA_URL    – URL del servidor Ollama (ej: http://ec2-xx-xx-xx-xx.compute.amazonaws.com:11434/api/chat)
//   OLLAMA_MODEL  – Modelo a usar (default: llama3.2:3b)
//   CORS_ORIGIN   – Origen permitido para CORS (default: *)

const OLLAMA_URL = process.env.OLLAMA_URL || "";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// ─── PREGUNTAS DEL DIAGNÓSTICO ───
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

// ─── RESPUESTAS VÁLIDAS ───
const RESPUESTAS_VALIDAS = ["Sí", "No", "Quiero recomendaciones", "Si", "si", "no"];

// ─── SYSTEM PROMPT ───
function buildSystemPrompt() {
  return `Eres IteraDORA, un asistente amigable que realiza diagnósticos DevOps usando la metodología DORA. Responde en español, con un tono profesional pero cálido y natural.

REGLAS DE ORO:
1. NUNCA mezcles una pregunta con el resultado final. Son pasos separados.
2. Cuando presentas una pregunta, SOLO muestras esa pregunta. Nada más.
3. El resultado SOLO se muestra después de que el usuario haya respondido la Pregunta 11 con Sí o No.
4. Cada respuesta tuya contiene ÚNICAMENTE una cosa: o un mensaje de ánimo + siguiente pregunta, o el resultado final, o recomendaciones. Nunca combines dos de estas cosas.

CONTEXTO: La presentación y la Pregunta 1 ya fueron mostradas al usuario. El usuario está respondiendo Sí o No a la Pregunta 1. Tu trabajo es continuar desde ahí.

FLUJO NORMAL (Preguntas 2 a 11):
Cuando el usuario responda Sí o No, responde con esto y solo esto:

1. Un mensaje de ánimo (1 línea), varíalo:
- "Excelente, sigamos evaluando."
- "Perfecto, continuemos."
- "Muy bien, vamos por más."
- "Gracias, avancemos."
- "Entendido, sigamos adelante."
- "¡Qué bien! Continuemos."

2. Una línea en blanco.

3. La siguiente pregunta en este formato:
"Pregunta X de ${TOTAL}:

[contenido exacto de la pregunta]"

Ejemplo de respuesta para la Pregunta 2:
"Excelente, sigamos evaluando.

Pregunta 2 de ${TOTAL}:

Tema: Infraestructura como Código

La automatización de la infraestructura ayuda a reducir errores manuales y mejorar la consistencia entre entornos.

¿La Infraestructura como Código (IaC) se utiliza como estándar en su organización?"

IMPORTANTE: No agregues nada después de la pregunta. No menciones resultados. Solo la pregunta.

Las preguntas son (las presentas en orden, de 2 a 11):
${PREGUNTAS.map((texto, i) => `Pregunta ${i + 1} de ${TOTAL}:\n${texto}`).join("\n\n")}

SOLO DESPUÉS de que el usuario responda la Pregunta 11, respondes ÚNICAMENTE con esto:
"¡Terminamos! Aquí están tus resultados.

RESULTADO DEL DIAGNÓSTICO:
Nivel: [Fundacional, Intermedio o Avanzado]
Puntaje: [calculado automáticamente]
Rangos: 0-33% Fundacional, 34-66% Intermedio, 67-100% Avanzado.

¿Te gustaría recibir recomendaciones personalizadas?"

No agregues nada más al resultado. No incluyas una pregunta adicional.

Cuando el usuario pida recomendaciones, entrega un análisis general dividido en secciones. No repitas las preguntas ni digas "en la pregunta X fallaste". Resume por áreas temáticas. Usa este formato:

"Basado en tus respuestas, aquí tienes un panorama de tu madurez DevOps:

FORTALEZAS
• [Menciona de forma general las áreas donde respondieron Sí, agrupando por temas. Sé alentador.]

OPORTUNIDADES DE MEJORA
• [Menciona las áreas donde respondieron No, agrupadas por temas como: control de versiones, automatización, calidad, seguridad, observabilidad. Da sugerencias generales, no por pregunta.]

CONCLUSIÓN
[Un párrafo breve que resuma el nivel de madurez general, reconociendo lo que ya hacen bien y motivando a trabajar en las oportunidades detectadas. Sin juicios negativos, siempre en tono constructivo.]

Gracias por confiar en IteraDORA. ¡Sigue mejorando tus prácticas DevOps!"

IMPORTANTE: No uses frases como "Fallaste en la pregunta 3" o "Respondiste No a...". Agrupa siempre por temas. Humaniza el mensaje para que el usuario sienta que es un acompañamiento, no una evaluación."

Si el usuario escribe algo que no es Sí o No, responde: "Responde Sí o No a la pregunta actual, por favor."`;
}

// ─── VALIDACIÓN OFF-TOPIC ───
function validarMensaje(messages) {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return null;

  const ultimo = userMessages[userMessages.length - 1].content.trim();

  if (RESPUESTAS_VALIDAS.includes(ultimo)) return null;

  // Bloqueado — no es una respuesta válida
  return "Responde Sí o No a la pregunta actual, por favor. Usa los botones disponibles.";
}

// ─── LLAMADA A OLLAMA ───
async function ollamaChat(messages) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: {
        num_predict: 500,
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text.substring(0, 300)}`);
  }

  const json = await response.json();
  return json.message?.content || "";
}

// ─── CORS HEADERS ───
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ─── LAMBDA HANDLER ───
export const handler = async (event) => {
  // ── Preflight CORS ──
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  // ── Validar que Ollama está configurado ──
  if (!OLLAMA_URL) {
    return {
      statusCode: 503,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Lambda no configurada",
        hint: "La variable de entorno OLLAMA_URL no está definida. Configúrala con la URL de tu servidor Ollama.",
      }),
    };
  }

  try {
    // ── Parsear body (soporta API Gateway v1 y v2 + Function URL) ──
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: 'El body debe incluir { messages: [...] }' }),
      };
    }

    // ── Filtrar mensajes off-topic ──
    const bloqueo = validarMensaje(messages);
    if (bloqueo) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: { role: "assistant", content: bloqueo } }),
      };
    }

    // ── Llamar a Ollama ──
    const systemPrompt = buildSystemPrompt();
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const content = await ollamaChat(ollamaMessages);

    if (!content) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "El modelo no generó respuesta. Intenta de nuevo." }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { role: "assistant", content },
      }),
    };
  } catch (err) {
    console.error("Lambda error:", err);
    return {
      statusCode: 503,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "No se pudo conectar con Ollama",
        detail: err.message,
        hint: `Verifica que Ollama esté corriendo en ${OLLAMA_URL} y que el modelo ${OLLAMA_MODEL} esté disponible.`,
      }),
    };
  }
};
