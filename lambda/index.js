// ─── IteraDORA Lambda Backend ───
// Usa AWS Bedrock (Claude) como motor de IA primario.
// Soporta también Ollama como fallback opcional.
//
// Variables de entorno en AWS Lambda:
//   BEDROCK_MODEL – Modelo de Bedrock (default: us.anthropic.claude-3-haiku-20240307-v1:0)
//   OLLAMA_URL    – (Opcional) URL de Ollama si querés usarlo en vez de Bedrock
//   OLLAMA_MODEL  – (Opcional) Modelo de Ollama (default: llama3.2:3b)
//   CORS_ORIGIN   – Dominio del frontend (default: *)

const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const OLLAMA_URL = process.env.OLLAMA_URL || "";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const BEDROCK_MODEL = process.env.BEDROCK_MODEL || "us.anthropic.claude-3-haiku-20240307-v1:0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const USE_OLLAMA = !!OLLAMA_URL;

const bedrockClient = USE_OLLAMA ? null : new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

// ─── PREGUNTAS ───
var PREGUNTAS = [
  "Tema: Control de versiones y trazabilidad\n\nPara comenzar, revisemos cómo gestionan la configuración de sus procesos de integración y despliegue.\n\n¿Las definiciones del pipeline están bajo control de código fuente (SCM) como GitHub o GitLab?",
  "Tema: Infraestructura como Código\n\nLa automatización de la infraestructura ayuda a reducir errores manuales y mejorar la consistencia entre entornos.\n\n¿La Infraestructura como Código (IaC) se utiliza como estándar en su organización?",
  "Tema: Integración Continua\n\nLa integración frecuente permite detectar problemas más rápido y reducir conflictos entre desarrolladores.\n\n¿El código se integra en la rama principal al menos una vez al día?",
  "Tema: Estabilidad del pipeline\n\nUn pipeline inestable puede afectar significativamente la velocidad de entrega.\n\n¿Las builds o despliegues fallidos son tratados como la máxima prioridad por el equipo?",
  "Tema: Calidad automatizada\n\nLos controles automáticos ayudan a mantener estándares de calidad consistentes.\n\n¿Las builds fallan automáticamente cuando no se cumplen los umbrales acordados de calidad, cobertura o análisis estático?",
  "Tema: Automatización de despliegues\n\nEvaluemos el nivel de automatización de los entornos de desarrollo y pruebas.\n\n¿El pipeline despliega automáticamente los artefactos en el entorno más bajo disponible (Dev o Test)?",
  "Tema: Feature Toggles\n\nLas banderas de funcionalidad permiten desplegar código sin exponer funcionalidades incompletas.\n\n¿Utilizan feature toggles para facilitar el desarrollo y la integración continua del equipo?",
  "Tema: Estado liberable\n\nLas organizaciones con alta madurez DevOps suelen mantener su código en un estado constantemente desplegable.\n\n¿Las funcionalidades incompletas pueden liberarse de forma segura a producción sin afectar a los usuarios?",
  "Tema: Arquitectura desacoplada\n\nLa independencia entre componentes facilita pruebas, despliegues y mantenimiento.\n\n¿El código puede desarrollarse, probarse y desplegarse de forma independiente?",
  "Tema: Seguridad integrada\n\nLa seguridad es más efectiva cuando forma parte del pipeline de desarrollo.\n\n¿Las builds fallan automáticamente cuando los escaneos detectan vulnerabilidades por encima del nivel de riesgo aceptado?",
  "Tema: Observabilidad y confiabilidad\n\nPor último, revisemos las prácticas de validación en producción.\n\n¿Se ejecutan health checks o pruebas smoke para verificar que los servicios funcionan correctamente después del despliegue?",
];

var TOTAL = PREGUNTAS.length;
var RESPUESTAS_VALIDAS = ["Sí", "No", "Quiero recomendaciones", "Si", "si", "no"];

function buildSystemPrompt(respuestasCount) {
  if (typeof respuestasCount !== "number") respuestasCount = 0;

  // ── Fase de preguntas ──
  if (respuestasCount < TOTAL) {
    var idx = Math.max(0, respuestasCount); // índice de la PRÓXIMA pregunta
    if (idx < PREGUNTAS.length) {
      // Prompt mínimo: solo la pregunta exacta, sin lista completa que confunda al modelo
      return "Eres IteraDORA, un asistente que realiza diagnósticos DevOps. Responde en español, tono profesional y cálido.\n\n" +
        "REGLAS ESTRICTAS:\n" +
        "1. TU ÚNICA TAREA es repetir exactamente el texto que el sistema te indica abajo. NADA MÁS.\n" +
        "2. NO inventes preguntas. NO cambies el tema. NO agregues texto extra.\n\n" +
        "RESPONDE ÚNICAMENTE CON ESTE TEXTO:\n\n" +
        "¡Ánimo! Vas muy bien.\n\n" +
        "Pregunta " + (idx + 1) + " de " + TOTAL + ":\n\n" +
        PREGUNTAS[idx];
    }
  }

  // ── Resultado final ──
  return "Eres IteraDORA, un asistente que realiza diagnósticos DevOps usando la metodología DORA. Responde en español, tono profesional y cálido.\n\n" +
    "El usuario ya respondió las " + TOTAL + " preguntas. Entrega el diagnóstico final con este formato:\n\n" +
    "RESULTADO DEL DIAGNÓSTICO:\n\n" +
    "Nivel: [clasificación basada en las respuestas]\n\n" +
    "[breve resumen del nivel]\n\n" +
    "Luego indica que puede pedir recomendaciones o hacer el diagnóstico profundo.\n\n" +
    "REGLAS:\n" +
    "- NO hagas más preguntas. El diagnóstico ya terminó.\n" +
    "- Si el usuario pide recomendaciones, entrégalas agrupadas por FORTALEZAS, OPORTUNIDADES DE MEJORA y CONCLUSIÓN.\n" +
    "- Si el usuario escribe otra cosa, recuérdale que puede pedir recomendaciones.";
}

// ─── DEEP DIAGNOSTIC PROMPT ───
function buildDeepDiagnosticPrompt(level, respuestasCount) {
  if (typeof respuestasCount !== "number") respuestasCount = 0;

  var practices = {
    "Fundacional":  { CV: 1, BD: 2, EC: 3, AP: 5, IS: 6, IC: 2 },
    "Intermedio":   { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 },
    "Avanzado":     { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 }
  };
  var cats = practices[level] || practices["Intermedio"];
  var catNames = {
    CV: "Control de Versiones", BD: "Build & Deploy Automation",
    EC: "Code Standards & Quality Code", AP: "Test Automation",
    IS: "Security Engineering", IC: "Continuous Integration"
  };
  var totalPracticas = Object.values(cats).reduce(function (a, b) { return a + b; }, 0);

  var base = "Eres IteraDORA, realizando un DIAGNÓSTICO PROFUNDO de madurez DevOps nivel " + level + ".\n\n" +
    "IMPORTANTE: El diagnóstico general YA TERMINÓ. Esto es el DIAGNÓSTICO PROFUNDO.\n" +
    "El usuario es nivel " + level + ". IGNORA mensajes anteriores. PROHIBIDO usar 'Pregunta X de 11'. Solo formato [CAT].\n\n" +
    "Haz preguntas de Sí/No sobre prácticas DevOps específicas para este nivel, organizadas por categoría.\n" +
    "Haz UNA pregunta a la vez. No mezcles categorías en una misma respuesta.\n\n" +
    "CATEGORÍAS (en este orden exacto):\n" +
    "1. CV - " + catNames.CV + " (" + cats.CV + " prácticas)\n" +
    "2. BD - " + catNames.BD + " (" + cats.BD + " prácticas)\n" +
    "3. EC - " + catNames.EC + " (" + cats.EC + " prácticas)\n" +
    "4. AP - " + catNames.AP + " (" + cats.AP + " prácticas)\n" +
    "5. IS - " + catNames.IS + " (" + cats.IS + " prácticas)\n" +
    "6. IC - " + catNames.IC + " (" + cats.IC + " prácticas)\n\n" +
    "Total: " + totalPracticas + " prácticas. Para cada una, pregunta si la organización YA implementa esa práctica (Sí/No).\n\n" +
    "FORMATO DE CADA PREGUNTA (OBLIGATORIO - o el sistema fallará):\n" +
    "[XX] Pregunta X de " + totalPracticas + ":\n\n" +
    "Tema: [título corto y descriptivo de la práctica]\n\n" +
    "[Una o dos líneas explicando brevemente por qué esta práctica es importante]\n\n" +
    "¿[pregunta concreta que se responda con Sí o No]?\n\n" +
    "Donde [XX] es el código REAL de categoría (CV, BD, EC, AP, IS, IC). NO uses [CAT] literal.\n" +
    "X = número secuencial global, de 1 hasta " + totalPracticas + ". NO reinicies el conteo por categoría.\n\n" +
    "Ejemplo (primera pregunta del diagnóstico):\n" +
    "[CV] Pregunta 1 de " + totalPracticas + ":\n\n" +
    "Tema: Estrategia de Branching\n\n" +
    "Las estrategias de branching definen cómo el equipo organiza y gestiona las ramas del repositorio.\n\n" +
    "¿El equipo utiliza trunk-based development o GitFlow con short-lived branches?\n\n" +
    "REGLAS:\n" +
    "- Cuando el usuario responda Sí o No, confirma (1 línea) y siguiente pregunta\n" +
    "- NO des recomendaciones ni análisis hasta completar TODAS las preguntas\n" +
    "- NO termines la pregunta con ¿Sí o No? ni frases similares. La pregunta debe ser natural.\n" +
    "- Preguntas ESPECÍFICAS para nivel " + level + "\n" +
    "- Para nivel Fundacional: pregunta sobre prácticas básicas (repositorios, primeros pipelines, documentación)\n" +
    "- Para nivel Intermedio: pregunta sobre automatización, CI/CD, testing automatizado, monitoreo\n" +
    "- Para nivel Avanzado: pregunta sobre canary releases, feature flags, SLOs, chaos engineering, DevSecOps\n\n" +
    "DESPUÉS DE LA ÚLTIMA PREGUNTA (" + totalPracticas + " en total), muestra ÚNICAMENTE este bloque:\n\n" +
    "=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===\n" +
    "CV: [aciertos]/" + cats.CV + " ([porcentaje]%)\n" +
    "BD: [aciertos]/" + cats.BD + " ([porcentaje]%)\n" +
    "EC: [aciertos]/" + cats.EC + " ([porcentaje]%)\n" +
    "AP: [aciertos]/" + cats.AP + " ([porcentaje]%)\n" +
    "IS: [aciertos]/" + cats.IS + " ([porcentaje]%)\n" +
    "IC: [aciertos]/" + cats.IC + " ([porcentaje]%)\n\n" +
    "No agregues recomendaciones ni análisis después del bloque de resultados. Solo el bloque.\n\n" +
    "Si el usuario escribe algo que no es Sí o No, responde: \"Por favor, responde Sí o No a la pregunta actual.\"";

  // ── Instrucción dinámica según conteo REAL de respuestas ──
  if (respuestasCount >= totalPracticas) {
    base += "\n\n⚠️ INSTRUCCIÓN FINAL: El backend confirma que ya se respondieron las " + totalPracticas + " prácticas. Muestra ÚNICAMENTE el bloque === RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===. PROHIBIDO hacer más preguntas.";
  } else if (respuestasCount === 0) {
    base += "\n\n⚠️ INSTRUCCIÓN: El backend confirma que este es el INICIO del diagnóstico profundo. Empieza INMEDIATAMENTE con la Pregunta 1 de " + totalPracticas + " [CV]. Sin introducciones.";
  } else {
    base += "\n\n⚠️ INSTRUCCIÓN OBLIGATORIA: El backend confirma que se han respondido " + respuestasCount + " de " + totalPracticas + " prácticas. Ahora debes mostrar ÚNICAMENTE la Pregunta " + (respuestasCount + 1) + " de " + totalPracticas + ". Sigue el orden CV → BD → EC → AP → IS → IC. NO te saltes preguntas. NO muestres resultados hasta completar las " + totalPracticas + ".";
  }

  return base;
}

function validarMensaje(messages) {
  var userMessages = messages.filter(function (m) { return m.role === "user"; });
  if (userMessages.length === 0) return null;
  var ultimo = userMessages[userMessages.length - 1].content.trim();
  if (RESPUESTAS_VALIDAS.indexOf(ultimo) !== -1) return null;
  return "Responde Sí o No a la pregunta actual, por favor. Usa los botones disponibles.";
}

function contarRespuestas(messages) {
  var validas = ["Sí", "No", "Si", "si", "no", "sí", "SÍ", "NO"];
  var count = 0;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role !== "user") continue;
    var content = m.content.trim();
    if (validas.indexOf(content) !== -1) {
      count++;
    }
  }
  return count;
}

// ─── BEDROCK (CLAUDE) ───
async function bedrockChat(messages) {
  var systemMsg = messages.find(function (m) { return m.role === "system"; });
  var systemText = systemMsg ? systemMsg.content : "";
  var chatMessages = messages.filter(function (m) { return m.role !== "system"; }).map(function (m) {
    return { role: m.role, content: [{ type: "text", text: m.content }] };
  });

  var body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 500,
    temperature: 0.3,
    system: systemText,
    messages: chatMessages,
  });

  var command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: body,
  });

  var response = await bedrockClient.send(command);
  var result = JSON.parse(new TextDecoder().decode(response.body));
  return (result.content && result.content[0] && result.content[0].text) ? result.content[0].text : "";
}

// ─── OLLAMA (FALLBACK) ───
async function ollamaChat(messages) {
  var response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: messages,
      stream: false,
      options: { num_predict: 500, temperature: 0.3 },
    }),
  });
  if (!response.ok) {
    var text = await response.text();
    throw new Error("Ollama error " + response.status + ": " + text.substring(0, 300));
  }
  var json = await response.json();
  return (json.message && json.message.content) ? json.message.content : "";
}

// ─── LLAMADA UNIFICADA ───
async function callAI(messages) {
  if (USE_OLLAMA) return ollamaChat(messages);
  return bedrockChat(messages);
}

// ─── HELPERS ───
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function respond(statusCode, data) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
    body: JSON.stringify(data),
  };
}

// ─── HANDLER ───
exports.handler = async function (event) {
  if ((event.requestContext && event.requestContext.http && event.requestContext.http.method === "OPTIONS") || event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    var body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    var messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return respond(400, { error: 'El body debe incluir { messages: [...] }' });
    }

    // ── Detectar modo diagnóstico profundo ──
    var isDeepDiagnostic = false;
    var deepLevel = "";

    var lastMsg = messages.length > 0 ? (messages[messages.length - 1].content || "") : "";
    var deepMatch = lastMsg.match(/^\[DEEP:(\w+)\]:/);
    if (deepMatch) {
      isDeepDiagnostic = true;
      deepLevel = deepMatch[1];
      // Limpiar TODOS los mensajes del usuario con prefijo [DEEP:...], no solo el último
      messages = JSON.parse(JSON.stringify(messages));
      for (var di = 0; di < messages.length; di++) {
        if (messages[di].role === "user") {
          var dm = messages[di].content.match(/^\[DEEP:\w+\]:(.*)/);
          if (dm) {
            var clean = dm[1].trim();
            if (!clean || clean.toUpperCase() === "INICIAR" || clean.toUpperCase() === "INICIAR DIAGNÓSTICO" || clean.toUpperCase() === "INICIAR DIAGNOSTICO") {
              clean = "Quiero iniciar el diagnostico profundo de nivel " + deepLevel;
            }
            messages[di].content = clean;
          }
        }
      }
    }

    // Off-topic se bloquea sin llamar a la IA (solo en modo general)
    if (!isDeepDiagnostic) {
      var bloqueo = validarMensaje(messages);
      if (bloqueo) {
        return respond(200, { message: { role: "assistant", content: bloqueo } });
      }
    }

    var respuestasCount = contarRespuestas(messages);

    // ── DIAGNÓSTICO GENERAL: preguntas 2-11 SIN LLM ──
    // Las preguntas son texto fijo. No necesitamos IA para mostrarlas.
    if (!isDeepDiagnostic && respuestasCount < TOTAL && respuestasCount > 0) {
      var idx = respuestasCount; // índice de la PRÓXIMA pregunta
      if (idx < PREGUNTAS.length) {
        var preguntaDirecta = "¡Ánimo! Vas muy bien.\n\nPregunta " + (idx + 1) + " de " + TOTAL + ":\n\n" + PREGUNTAS[idx];
        return respond(200, { message: { role: "assistant", content: preguntaDirecta } });
      }
    }

    if (!USE_OLLAMA && !bedrockClient) {
      return respond(503, { error: "No hay motor de IA configurado", hint: "Configura OLLAMA_URL o asegura que la Lambda tenga permisos para Bedrock." });
    }

    var systemPrompt = isDeepDiagnostic ? buildDeepDiagnosticPrompt(deepLevel, respuestasCount) : buildSystemPrompt(respuestasCount);
    var aiMessages = [{ role: "system", content: systemPrompt }].concat(messages);
    var content = await callAI(aiMessages);

    if (!content) {
      return respond(500, { error: "El modelo no generó respuesta. Intenta de nuevo." });
    }

    return respond(200, { message: { role: "assistant", content: content } });

  } catch (err) {
    console.error("Lambda error:", err);
    return respond(503, {
      error: "Error al llamar al modelo de IA",
      detail: err.message,
    });
  }
};
