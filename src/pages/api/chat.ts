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

function buildSystemPrompt(respuestasCount: number = 0): string {
  let base = `Eres IteraDORA, un asistente amigable que realiza diagnósticos DevOps usando la metodología DORA. Responde en español, con un tono profesional pero cálido y natural.

REGLAS DE ORO:
1. NUNCA mezcles una pregunta con el resultado final. Son pasos separados.
2. Cuando presentas una pregunta, SOLO muestras esa pregunta. Nada más.
3. El resultado SOLO se muestra después de que el usuario haya respondido la Pregunta 11 con Sí o No.
4. Cada respuesta tuya contiene ÚNICAMENTE una cosa: o un mensaje de ánimo + siguiente pregunta, o el resultado final, o recomendaciones.

CONTEXTO: La presentación y la Pregunta 1 ya fueron mostradas al usuario.

Las preguntas de referencia son:
${PREGUNTAS.map((texto, i) => `Pregunta ${i + 1} de ${TOTAL}:\n${texto}`).join("\n\n")}

Cuando el usuario pida recomendaciones, entrega un análisis con FORTALEZAS, OPORTUNIDADES DE MEJORA y CONCLUSIÓN. Agrupa por áreas temáticas. No uses frases como "Fallaste en la pregunta 3".

Si el usuario escribe algo que no es Sí o No, responde: "Responde Sí o No a la pregunta actual, por favor."`;

  // ── Instrucción dinámica según conteo REAL de respuestas ──
  if (respuestasCount >= TOTAL) {
    base += `\n\n⚠️ INSTRUCCIÓN FINAL: El usuario ya respondió las ${TOTAL} preguntas. Muestra el RESULTADO o RECOMENDACIONES según el último mensaje del usuario. PROHIBIDO inventar más preguntas.`;
  } else if (respuestasCount > 0) {
    const idx = respuestasCount; // índice de la PRÓXIMA pregunta (0-based)
    if (idx < PREGUNTAS.length) {
      base += `\n\n⚠️ INSTRUCCIÓN OBLIGATORIA: El backend confirma que el usuario respondió la Pregunta ${respuestasCount}. Muestra ÚNICAMENTE esto:\n\n[1 línea de ánimo]\n\nPregunta ${respuestasCount + 1} de ${TOTAL}:\n\n${PREGUNTAS[idx]}\n\nNO muestres otra pregunta distinta. NO te saltes preguntas. NO muestres resultados aún.`;
    }
  }

  return base;
}

const RESPUESTAS_VALIDAS = ["Sí", "No", "Quiero recomendaciones", "Si", "si", "no"];

// ─── DEEP DIAGNOSTIC PROMPT ───
function buildDeepDiagnosticPrompt(level: string, respuestasCount: number = 0): string {
  const practices: Record<string, Record<string, number>> = {
    Fundacional:  { CV: 1, BD: 2, EC: 3, AP: 5, IS: 6, IC: 2 },
    Intermedio:   { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 },
    Avanzado:     { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 }
  };
  const cats = practices[level] || practices["Intermedio"];
  const catNames: Record<string, string> = {
    CV: "Control de Versiones", BD: "Build & Deploy Automation",
    EC: "Code Standards & Quality Code", AP: "Test Automation",
    IS: "Security Engineering", IC: "Continuous Integration"
  };
  const totalPracticas = Object.values(cats).reduce((a: number, b: number) => a + b, 0);

  let base = `Eres IteraDORA, realizando un DIAGNÓSTICO PROFUNDO de madurez DevOps nivel ${level}.

IMPORTANTE: El diagnóstico general de 11 preguntas YA TERMINÓ. Esto es el DIAGNÓSTICO PROFUNDO.
El usuario es nivel ${level}. IGNORA mensajes anteriores. PROHIBIDO usar 'Pregunta X de 11'. Solo formato [CAT].

Haz preguntas de Sí/No sobre prácticas DevOps específicas para este nivel, organizadas por categoría.
Haz UNA pregunta a la vez. No mezcles categorías en una misma respuesta.

CATEGORÍAS (en este orden exacto):
1. CV - ${catNames.CV} (${cats.CV} prácticas)
2. BD - ${catNames.BD} (${cats.BD} prácticas)
3. EC - ${catNames.EC} (${cats.EC} prácticas)
4. AP - ${catNames.AP} (${cats.AP} prácticas)
5. IS - ${catNames.IS} (${cats.IS} prácticas)
6. IC - ${catNames.IC} (${cats.IC} prácticas)

Total: ${totalPracticas} prácticas. Para cada una, pregunta si la organización YA implementa esa práctica (Sí/No).

FORMATO DE CADA PREGUNTA (OBLIGATORIO - o el sistema fallará):
[XX] Pregunta X de ${totalPracticas}:

Tema: [título corto y descriptivo de la práctica]

[Una o dos líneas explicando brevemente por qué esta práctica es importante]

¿[pregunta concreta que se responda con Sí o No]?

Donde [XX] es el código REAL de categoría (CV, BD, EC, AP, IS, IC). NO uses [CAT] literal.
X = número secuencial global, de 1 hasta ${totalPracticas}. NO reinicies el conteo por categoría.

REGLAS:
- Cuando el usuario responda Sí o No, confirma (1 línea) y siguiente pregunta
- NO des recomendaciones ni análisis hasta completar TODAS las preguntas
- Preguntas ESPECÍFICAS para nivel ${level}
- Para nivel Fundacional: pregunta sobre prácticas básicas (repositorios, primeros pipelines, documentación)
- Para nivel Intermedio: pregunta sobre automatización, CI/CD, testing automatizado, monitoreo
- Para nivel Avanzado: pregunta sobre canary releases, feature flags, SLOs, chaos engineering, DevSecOps

DESPUÉS DE LA ÚLTIMA PREGUNTA (${totalPracticas} en total), muestra ÚNICAMENTE este bloque:

=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===
CV: [aciertos]/${cats.CV} ([porcentaje]%)
BD: [aciertos]/${cats.BD} ([porcentaje]%)
EC: [aciertos]/${cats.EC} ([porcentaje]%)
AP: [aciertos]/${cats.AP} ([porcentaje]%)
IS: [aciertos]/${cats.IS} ([porcentaje]%)
IC: [aciertos]/${cats.IC} ([porcentaje]%)

No agregues recomendaciones ni análisis después del bloque de resultados. Solo el bloque.

Si el usuario escribe algo que no es Sí o No, responde: "Por favor, responde Sí o No a la pregunta actual."`;

  // ── Instrucción dinámica según conteo REAL de respuestas ──
  if (respuestasCount >= totalPracticas) {
    base += `\n\n⚠️ INSTRUCCIÓN FINAL: El backend confirma que ya se respondieron las ${totalPracticas} prácticas. Muestra ÚNICAMENTE el bloque === RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===. PROHIBIDO hacer más preguntas.`;
  } else if (respuestasCount === 0) {
    base += `\n\n⚠️ INSTRUCCIÓN: El backend confirma que este es el INICIO del diagnóstico profundo. Empieza INMEDIATAMENTE con la Pregunta 1 de ${totalPracticas} [CV]. Sin introducciones.`;
  } else {
    base += `\n\n⚠️ INSTRUCCIÓN OBLIGATORIA: El backend confirma que se han respondido ${respuestasCount} de ${totalPracticas} prácticas. Ahora debes mostrar ÚNICAMENTE la Pregunta ${respuestasCount + 1} de ${totalPracticas}. Sigue el orden CV → BD → EC → AP → IS → IC. NO te saltes preguntas. NO muestres resultados hasta completar las ${totalPracticas}.`;
  }

  return base;
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
      // Limpiar TODOS los mensajes del usuario con prefijo [DEEP:...], no solo el último
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

    // Filtrar mensajes off-topic ANTES de llamar a Ollama (solo en modo general)
    if (!isDeepDiagnostic) {
      const bloqueo = validarMensaje(messages);
      if (bloqueo) {
        return new Response(
          JSON.stringify({ message: { role: "assistant", content: bloqueo } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const systemPrompt = isDeepDiagnostic ? buildDeepDiagnosticPrompt(deepLevel, respuestasCount) : buildSystemPrompt(respuestasCount);
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
