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
        num_predict: 500,
        temperature: 0.3,
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

function buildSystemPrompt(): string {
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
