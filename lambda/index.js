// ─── IteraDORA Lambda Backend ───
// Usa AWS Bedrock (Claude) como motor de IA primario.
// Soporta también Ollama como fallback opcional.
//
// Variables de entorno en AWS Lambda:
//   BEDROCK_MODEL – Modelo de Bedrock (default: us.anthropic.claude-3-haiku-20240307-v1:0)
//   OLLAMA_URL    – (Opcional) URL de Ollama si querés usarlo en vez de Bedrock
//   OLLAMA_MODEL  – (Opcional) Modelo de Ollama (default: llama3.2:3b)
//   CORS_ORIGIN   – Dominio del frontend (default: *)
//   SES_FROM_EMAIL – Identidad verificada en SES que envía el informe (obligatorio)
//   SES_CC_EMAIL   – Destinatario de la copia interna (obligatorio)
//   SES_REPLY_TO   – (Opcional) Dirección de respuesta directa
//
// Acciones aceptadas en el body:
//   { messages: [...] }                     → devuelve la respuesta del chat
//   { action: "SEND_EMAIL", userData: {...} } → envía el informe por correo (SES)

const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

//Agregado para envío de correos  
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const sesClient = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

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
  var totalPracticas = Object.values(cats).reduce(function (a, b) { return a + b; }, 0);

  // ── Primera pregunta: texto fijo desde el backend ──
  if (respuestasCount === 0) {
    return "Eres IteraDORA. Diagnóstico profundo nivel " + level + ". Responde en español.\n\n" +
      "RESPONDE ÚNICAMENTE CON ESTE TEXTO:\n\n" +
      "[CV] Pregunta 1 de " + totalPracticas + ":\n\n" +
      "Tema: Sistema de Control de Versiones\n\n" +
      "Un sistema de control de versiones como Git es la base fundamental de cualquier práctica DevOps.\n\n" +
      "¿La organización utiliza un sistema de control de versiones como Git para gestionar todos sus repositorios de código?";
  }

  // ── Preguntas siguientes: instrucción simple ──
  if (respuestasCount < totalPracticas) {
    return "Eres IteraDORA. Diagnóstico profundo DevOps nivel " + level + ". Responde en español.\n\n" +
      "El usuario respondió " + respuestasCount + " de " + totalPracticas + " prácticas. Ahora te toca la pregunta " + (respuestasCount + 1) + " de " + totalPracticas + ".\n\n" +
      "FORMATO OBLIGATORIO - copia esta estructura exacta:\n\n" +
      "[CAT] Pregunta " + (respuestasCount + 1) + " de " + totalPracticas + ":\n\n" +
      "Tema: [título corto]\n\n" +
      "[una frase explicando la importancia]\n\n" +
      "¿[pregunta concreta de Sí o No]?\n\n" +
      "REEMPLAZA [CAT] por una de estas siglas según la categoría que corresponda:\n" +
      "- CV = Control de Versiones (" + cats.CV + " prácticas en total)\n" +
      "- BD = Build & Deploy (" + cats.BD + " prácticas en total)\n" +
      "- EC = Code Standards (" + cats.EC + " prácticas en total)\n" +
      "- AP = Test Automation (" + cats.AP + " prácticas en total)\n" +
      "- IS = Security Engineering (" + cats.IS + " prácticas en total)\n" +
      "- IC = Continuous Integration (" + cats.IC + " prácticas en total)\n\n" +
      "El orden es: CV → BD → EC → AP → IS → IC. Ya se respondieron " + respuestasCount + ". La categoría actual es la que corresponda según el orden y conteo.\n\n" +
      "NO escribas recomendaciones. NO escribas análisis. SOLO la pregunta.";
  }

  // ── Resultado final ──
  return "Eres IteraDORA. Diagnóstico profundo nivel " + level + " COMPLETADO. Responde en español.\n\n" +
    "El usuario respondió las " + totalPracticas + " prácticas. Calcula los aciertos (Sí = acierto) y muestra:\n\n" +
    "=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===\n" +
    "CV: [aciertos]/" + cats.CV + " ([porcentaje]%)\n" +
    "BD: [aciertos]/" + cats.BD + " ([porcentaje]%)\n" +
    "EC: [aciertos]/" + cats.EC + " ([porcentaje]%)\n" +
    "AP: [aciertos]/" + cats.AP + " ([porcentaje]%)\n" +
    "IS: [aciertos]/" + cats.IS + " ([porcentaje]%)\n" +
    "IC: [aciertos]/" + cats.IC + " ([porcentaje]%)\n\n" +
    "Solo el bloque de resultados. Nada más.";
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

// ─── ENVÍO DE CORREO (SES) ───
// Configuración por variable de entorno (AWS Console → Configuration → Environment variables):
//   SES_FROM_EMAIL – identidad verificada en SES que envía el correo (obligatorio)
//   SES_CC_EMAIL   – destinatario de la copia interna (obligatorio)
//   SES_REPLY_TO   – respuesta directa opcional
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || "";
const SES_CC_EMAIL = process.env.SES_CC_EMAIL || "";
const SES_REPLY_TO = process.env.SES_REPLY_TO || "";

// Categories rendered in the deep diagnostic report, in evaluation order.
var CATEGORIAS_PROFUNDAS = ["CV", "BD", "EC", "AP", "IS", "IC"];
var NOMBRES_CATEGORIA = {
  CV: "Control de Versiones",
  BD: "Build & Deployment",
  EC: "Estándares de Código",
  AP: "Automatización de Pruebas",
  IS: "Ingeniería de Seguridad",
  IC: "Integración Continua",
};

// Formato de email deliberadamente simple: suficiente para DESCARTAR entradas inválidas
// (espacios, sin @, sin dominio) sin pretender ser un validador RFC 5322 completo.
var EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>.]{2,}$/;

/**
 * Escapa texto antes de interpolarlo en HTML.
 * Todo dato proviene del navegador (nombre, empresa, preguntas), así que nunca es confiable.
 */
function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapa texto y convierte saltos de línea en <br> (para el bloque de respuestas). */
function escapeHtmlMultilinea(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/**
 * Normaliza `respuestasDora` a una lista [{pregunta, respuesta}].
 * Acepta el array estructurado del frontend y el objeto {clave: valor} del test local.
 */
function normalizarRespuestas(respuestasDora) {
  var out = [];

  if (Array.isArray(respuestasDora)) {
    for (var i = 0; i < respuestasDora.length; i++) {
      var item = respuestasDora[i] || {};
      var pregunta = item.pregunta || item.tema || item.texto || "";
      var respuesta = item.respuesta !== undefined ? item.respuesta : item.valor;
      if (pregunta || respuesta) {
        out.push({ pregunta: String(pregunta), respuesta: String(respuesta === undefined ? "" : respuesta) });
      }
    }
  } else if (respuestasDora && typeof respuestasDora === "object") {
    for (var key in respuestasDora) {
      if (Object.prototype.hasOwnProperty.call(respuestasDora, key)) {
        out.push({ pregunta: String(key), respuesta: String(respuestasDora[key]) });
      }
    }
  }

  return out;
}

/** Construye el bloque HTML con las respuestas del diagnóstico. */
function buildRespuestasHtml(respuestas) {
  if (!respuestas.length) return "";

  var rows = respuestas
    .map(function (r) {
      var afirmo = /^s[ií]$/i.test(r.respuesta.trim());
      var color = afirmo ? "#137333" : "#c5221f";
      var icono = afirmo ? "&#10003;" : "&#10007;";

      return (
        '<tr>' +
        '<td style="padding:10px 12px;border-bottom:1px solid #e8eaed;color:#3c4043;font-size:14px;line-height:1.5;vertical-align:top;">' +
        escapeHtmlMultilinea(r.pregunta) +
        "</td>" +
        '<td style="padding:10px 12px;border-bottom:1px solid #e8eaed;text-align:center;vertical-align:top;">' +
        '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:' +
        (afirmo ? "#e6f4ea" : "#fce8e6") +
        ";color:" +
        color +
        ';font-weight:700;font-size:12px;white-space:nowrap;">' +
        icono +
        " " +
        escapeHtml(r.respuesta || "-") +
        "</span></td></tr>"
      );
    })
    .join("");

  return (
    '<h3 style="margin:28px 0 10px;color:#202124;font-size:16px;">Respuestas del diagn&oacute;stico</h3>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e8eaed;border-radius:8px;overflow:hidden;">' +
    "<thead><tr>" +
    '<th align="left" style="padding:10px 12px;background:#f8f9fa;color:#5f6368;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Pregunta</th>' +
    '<th align="center" style="padding:10px 12px;background:#f8f9fa;color:#5f6368;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Respuesta</th>' +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>"
  );
}

/** Construye el bloque HTML con los puntajes por categoría del diagnóstico profundo. */
function buildResultadosProfundosHtml(resultadosProfundos) {
  if (!resultadosProfundos || typeof resultadosProfundos !== "object") return "";

  var rows = CATEGORIAS_PROFUNDAS.map(function (cat) {
    var score = resultadosProfundos[cat];
    if (!score) return "";

    var match = String(score).match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/);
    var pct = match ? parseFloat(match[3]) : 0;
    var color = pct >= 70 ? "#137333" : pct >= 40 ? "#b06000" : "#c5221f";
    var fondo = pct >= 70 ? "#e6f4ea" : pct >= 40 ? "#fef7e0" : "#fce8e6";

    return (
      "<tr>" +
      '<td style="padding:9px 12px;border-bottom:1px solid #e8eaed;color:#3c4043;font-size:14px;">' +
      escapeHtml(NOMBRES_CATEGORIA[cat] || cat) +
      ' <span style="color:#5f6368;font-size:12px;">(' + escapeHtml(cat) + ")</span></td>" +
      '<td align="center" style="padding:9px 12px;border-bottom:1px solid #e8eaed;color:#3c4043;font-size:14px;white-space:nowrap;">' +
      escapeHtml(String(score).replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)\s*$/, "")) +
      "</td>" +
      '<td align="center" style="padding:9px 12px;border-bottom:1px solid #e8eaed;">' +
      '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:' +
      fondo +
      ";color:" +
      color +
      ';font-weight:700;font-size:12px;white-space:nowrap;">' +
      escapeHtml(String(score).match(/\(\s*\d+(?:\.\d+)?\s*%\s*\)/) ? String(score).match(/\(\s*\d+(?:\.\d+)?\s*%\s*\)/)[0] : "") +
      "</span></td></tr>"
    );
  })
    .filter(Boolean)
    .join("");

  if (!rows) return "";

  return (
    '<h3 style="margin:28px 0 10px;color:#202124;font-size:16px;">Puntajes por categor&iacute;a</h3>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e8eaed;border-radius:8px;overflow:hidden;">' +
    "<thead><tr>" +
    '<th align="left" style="padding:10px 12px;background:#f8f9fa;color:#5f6368;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Categor&iacute;a</th>' +
    '<th align="center" style="padding:10px 12px;background:#f8f9fa;color:#5f6368;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Pr&aacute;cticas</th>' +
    '<th align="center" style="padding:10px 12px;background:#f8f9fa;color:#5f6368;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Cumplimiento</th>' +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>"
  );
}

/** Versión en texto plano del mismo informe (fallback para clientes sin HTML). */
function buildPlainText(datos, respuestas) {
  var lineas = [];
  lineas.push("Informe de Madurez DevOps (DORA)");
  lineas.push("=======================================");
  lineas.push("");
  lineas.push("Nombre: " + (datos.nombre || "-"));
  lineas.push("Empresa: " + (datos.empresa || "-"));
  lineas.push("Evaluacion: " + (datos.tipo === "profundo" ? "Diagnostico profundo" : "Diagnostico inicial"));
  lineas.push("Nivel DORA: " + (datos.nivelDora || "Evaluado"));
  if (datos.puntaje) lineas.push("Puntaje: " + datos.puntaje);

  if (datos.resultadosProfundos) {
    lineas.push("");
    lineas.push("Puntajes por categoria:");
    for (var ci = 0; ci < CATEGORIAS_PROFUNDAS.length; ci++) {
      var cat = CATEGORIAS_PROFUNDAS[ci];
      if (datos.resultadosProfundos[cat]) {
        lineas.push("  - " + (NOMBRES_CATEGORIA[cat] || cat) + " (" + cat + "): " + datos.resultadosProfundos[cat]);
      }
    }
  }

  if (respuestas.length) {
    lineas.push("");
    lineas.push("Respuestas del diagnostico:");
    for (var ri = 0; ri < respuestas.length; ri++) {
      lineas.push("  " + (ri + 1) + ". " + respuestas[ri].pregunta + " -> " + (respuestas[ri].respuesta || "-"));
    }
  }

  lineas.push("");
  lineas.push("El reporte ha sido registrado exitosamente en nuestro sistema.");
  return lineas.join("\n");
}

/**
 * Envía el informe de resultados por correo (al cliente, con copia a IteraDORA).
 * Lanza Error con un mensaje accionable cuando la configuración o los datos no permiten enviar.
 */
async function sendReportEmail(datos) {
  if (!SES_FROM_EMAIL || !SES_CC_EMAIL) {
    throw new Error("Falta configurar SES_FROM_EMAIL y SES_CC_EMAIL en las variables de entorno de la Lambda");
  }

  var nombre = String((datos && datos.nombre) || "").trim();
  var empresa = String((datos && datos.empresa) || "").trim();
  var correoCliente = String((datos && datos.correoCliente) || "").trim();
  var nivelDora = String((datos && datos.nivelDora) || "").trim();
  var esProfundo = datos && datos.tipo === "profundo";

  if (!EMAIL_RE.test(correoCliente)) {
    throw new Error("Correo de destino inválido o vacío: " + (correoCliente || "(vacío)"));
  }

  var respuestas = normalizarRespuestas(datos && datos.respuestasDora);

  // El nombre de la empresa va en el asunto; sin él usamos un asunto genérico.
  var asuntoEmpresa = empresa || "Evaluación DORA";
  var asunto = esProfundo
    ? "Resultados Diagnóstico Profundo DORA - " + asuntoEmpresa
    : "Resultados Diagnóstico DORA - " + asuntoEmpresa;

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#202124;max-width:640px;">' +
    '<h2 style="color:#1a73e8;margin:0 0 16px;">Informe de Madurez DevOps (DORA)</h2>' +
    "<p>Hola <b>" + escapeHtml(nombre || "cliente") + "</b>,</p>" +
    "<p>Gracias por completar la evaluaci&oacute;n para <b>" + escapeHtml(empresa || "su organizaci&oacute;n") + "</b>.</p>" +
    '<div style="background-color:#e8f0fe;padding:15px;border-left:4px solid #1a73e8;margin:18px 0;">' +
    '<h3 style="margin:0 0 6px;color:#174ea6;font-size:15px;">Nivel DORA: ' + escapeHtml(nivelDora || "Evaluado") + "</h3>" +
    (datos.puntaje ? '<p style="margin:0;color:#174ea6;font-size:13px;">Puntaje: ' + escapeHtml(datos.puntaje) + "</p>" : "") +
    "</div>" +
    buildResultadosProfundosHtml(datos && datos.resultadosProfundos) +
    buildRespuestasHtml(respuestas) +
    "<p style=\"margin-top:28px;color:#5f6368;font-size:13px;\">El reporte ha sido registrado exitosamente en nuestro sistema.</p>" +
    "</div>";

  var emailParams = {
    Source: SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [correoCliente],
      CcAddresses: [SES_CC_EMAIL],
    },
    Message: {
      Subject: { Data: asunto, Charset: "UTF-8" },
      Body: {
        Text: { Data: buildPlainText(datos || {}, respuestas), Charset: "UTF-8" },
        Html: { Data: html, Charset: "UTF-8" },
      },
    },
  };

  if (SES_REPLY_TO) {
    emailParams.ReplyToAddresses = [SES_REPLY_TO];
  }

  await sesClient.send(new SendEmailCommand(emailParams));
}

// ─── HANDLER ───
exports.handler = async function (event) {
  if ((event.requestContext && event.requestContext.http && event.requestContext.http.method === "OPTIONS") || event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    var body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    if (!body || typeof body !== "object") {
      return respond(400, { error: "El body debe ser un objeto JSON" });
    }

    // ─── ACCIÓN: envío del informe por correo ───
    if (body.action === "SEND_EMAIL") {
      if (!body.userData || typeof body.userData !== "object") {
        return respond(400, { error: "SEND_EMAIL requiere userData con nombre, empresa, correoCliente y nivelDora" });
      }
      try {
        await sendReportEmail(body.userData);
        return respond(200, { message: "Correo enviado exitosamente" });
      } catch (emailErr) {
        // `detail` sólo se expone para errores de validación propios del servicio de correo,
        // no para fallos de SES/permisos, que podrían filtrar detalle de infraestructura.
        var esValidacion = emailErr instanceof Error && emailErr.message.indexOf("Falta configurar") === 0;
        console.error("Error al enviar email:", emailErr);
        return respond(502, {
          error: esValidacion ? emailErr.message : "No se pudo enviar el correo. Intenta más tarde.",
        });
      }
    }

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

    // ── DIAGNÓSTICO GENERAL: todas las preguntas SIN LLM ──
    if (!isDeepDiagnostic && respuestasCount < TOTAL) {
      var idx = respuestasCount;
      if (idx < PREGUNTAS.length) {
        var animo = idx > 0 ? "¡Ánimo! Vas muy bien.\n\n" : "";
        var preguntaDirecta = animo + "Pregunta " + (idx + 1) + " de " + TOTAL + ":\n\n" + PREGUNTAS[idx];
        return respond(200, { message: { role: "assistant", content: preguntaDirecta } });
      }
    }

    // ── DIAGNÓSTICO PROFUNDO: primera pregunta SIN LLM ──
    if (isDeepDiagnostic && respuestasCount === 0) {
      var deepPractices = {
        "Fundacional":  { CV: 1, BD: 2, EC: 3, AP: 5, IS: 6, IC: 2 },
        "Intermedio":   { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 },
        "Avanzado":     { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 }
      };
      var deepCats = deepPractices[deepLevel] || deepPractices["Intermedio"];
      var deepTotal = Object.values(deepCats).reduce(function (a, b) { return a + b; }, 0);
      var deepPreguntaDirecta = "[CV] Pregunta 1 de " + deepTotal + ":\n\nTema: Sistema de Control de Versiones\n\nUn sistema de control de versiones como Git es la base fundamental de cualquier práctica DevOps.\n\n¿La organización utiliza un sistema de control de versiones como Git para gestionar todos sus repositorios de código?";
      return respond(200, { message: { role: "assistant", content: deepPreguntaDirecta } });
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
