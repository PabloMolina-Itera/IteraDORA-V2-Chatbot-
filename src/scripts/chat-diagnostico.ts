function initChatDiagnostico() {
  // Backend: endpoint de Astro SSR con Bedrock Claude integrado
  const API_URL = "/api/chat";

  const messagesEl = document.getElementById("chat-messages")!;
  const btnContainer = document.getElementById("btn-container")!;
  const btnSi = document.getElementById("btn-si") as HTMLButtonElement;
  const btnNo = document.getElementById("btn-no") as HTMLButtonElement;
  const recContainer = document.getElementById("rec-container")!;
  const btnRec = document.getElementById("btn-rec") as HTMLButtonElement;
  const resultCard = document.getElementById("result-card")!;
  const resultContent = document.getElementById("result-content")!;
  const btnVolverChat = document.getElementById("btn-volver-chat")!;
  const btnSalir = document.getElementById("btn-salir")!;
  const chatDisclaimer = document.getElementById("chat-disclaimer")!;
  const deepContainer = document.getElementById("deep-container")!;
  const btnDeep = document.getElementById("btn-deep") as HTMLButtonElement;
  const deepResultCard = document.getElementById("deep-result-card")!;
  const deepResultContent = document.getElementById("deep-result-content")!;
  const btnVolverDeep = document.getElementById("btn-volver-deep")!;
  const btnSalirDeep = document.getElementById("btn-salir-deep")!;

  const TOTAL_PREGUNTAS = 11;
  const btnComenzar = document.getElementById("btn-comenzar") as HTMLButtonElement;
  const bubblePregunta1 = document.getElementById("bubble-pregunta-1")!;

  let messages: { role: string; content: string }[] = [];
  let isLoading = false;
  let diagnosticoFinalizado = false;
  let botonesVisibles = false;
  let resultadoMostrado = false;
  let chatTerminado = false;
  let respuestasSi = 0;

  // ─── DIAGNÓSTICO PROFUNDO ───
  let deepDiagnosticActive = false;
  let deepDiagnosticLevel = "";
  let deepUltimaCategoria = "";
  let deepRespuestasPorCategoria: Record<string, number> = {};
  const DEEP_PRACTICES: Record<string, Record<string, number>> = {
    Fundacional: { CV: 1, BD: 2, EC: 3, AP: 5, IS: 6, IC: 2 },
    Intermedio:  { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 },
    Avanzado:    { CV: 2, BD: 3, EC: 4, AP: 4, IS: 7, IC: 3 }
  };
  let deepCategoriasCompletadas = 0;
  let deepDiagnosticoFinalizado = false;

  // Los botones Sí/No y Pregunta 1 están ocultos hasta que se pulse "Comencemos"
  btnSi.disabled = true;
  btnNo.disabled = true;
  botonesVisibles = false;

  const comenzarContainer = document.getElementById("comenzar-container")!;

  btnComenzar.addEventListener("click", () => {
    btnComenzar.disabled = true;
    btnComenzar.textContent = "Comenzando...";
    setTimeout(() => {
      comenzarContainer.classList.add("hidden");
      bubblePregunta1.classList.remove("hidden");
      btnContainer.classList.remove("hidden");
      btnSi.disabled = false;
      btnNo.disabled = false;
      botonesVisibles = true;
      scrollToBottom();
    }, 400);
  });

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text: string) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function addMessage(role: "user" | "assistant", content: string) {
    const isUser = role === "user";
    const bubble = document.createElement("div");
    bubble.className = `flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"} animate-fade-in`;
    const avatarHtml = isUser
      ? ""
      : '<div class="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00A8D8] to-[#0095c2] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mb-1 shadow-md">IA</div>';
    const bg = isUser
      ? "bg-gradient-to-br from-[#00A8D8] to-[#0095c2] text-white"
      : "bg-white dark:bg-[#002633] text-[#00334E] dark:text-gray-100 border border-gray-100 dark:border-gray-700/50";
    const radius = isUser ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-bl-md";
    const widthClass = isUser ? "max-w-[75%]" : "max-w-[80%]";
    bubble.innerHTML = `${avatarHtml}<div class="${widthClass} px-4 py-2.5 ${radius} ${bg} text-sm leading-relaxed shadow-sm whitespace-pre-line">${escapeHtml(content)}</div>`;
    messagesEl.appendChild(bubble);
    scrollToBottom();
  }

  function addTypingIndicator() {
    const el = document.createElement("div");
    el.id = "typing-indicator";
    el.className = "flex items-end gap-2 justify-start animate-fade-in";
    el.innerHTML =
      '<div class="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00A8D8] to-[#0095c2] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mb-1 shadow-md">IA</div><div class="bg-white dark:bg-[#002633] border border-gray-100 dark:border-gray-700/50 px-4 py-3 rounded-2xl rounded-bl-md shadow-sm"><div class="flex gap-1"><span class="w-2 h-2 bg-[#00A8D8]/60 rounded-full animate-bounce" style="animation-delay:0s"></span><span class="w-2 h-2 bg-[#00A8D8]/60 rounded-full animate-bounce" style="animation-delay:0.15s"></span><span class="w-2 h-2 bg-[#00A8D8]/60 rounded-full animate-bounce" style="animation-delay:0.3s"></span></div></div>';
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function removeTypingIndicator() {
    const el = document.getElementById("typing-indicator");
    if (el) el.remove();
  }

  function showButtons(show: boolean) {
    if (show) {
      btnContainer.classList.remove("hidden");
      btnSi.disabled = false;
      btnNo.disabled = false;
      botonesVisibles = true;
    } else {
      btnContainer.classList.add("hidden");
      recContainer.classList.add("hidden");
      deepContainer.classList.add("hidden");
      btnSi.disabled = true;
      btnNo.disabled = true;
      btnRec.disabled = true;
      btnDeep.disabled = true;
      botonesVisibles = false;
    }
  }

  function showRecAndDeepButtons() {
    btnContainer.classList.add("hidden");
    recContainer.classList.remove("hidden");
    deepContainer.classList.remove("hidden");
    btnRec.disabled = false;
    btnDeep.disabled = false;
    botonesVisibles = true;
  }

  function showRecButton() {
    btnContainer.classList.add("hidden");
    recContainer.classList.remove("hidden");
    btnRec.disabled = false;
    botonesVisibles = true;
  }

  function setButtonsLoading(loading: boolean) {
    if (!botonesVisibles) return;
    btnSi.disabled = loading;
    btnNo.disabled = loading;
    btnRec.disabled = loading;
    btnDeep.disabled = loading;
  }

  function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function computeLevel(): string {
    const porcentaje = Math.round((respuestasSi / TOTAL_PREGUNTAS) * 100);
    if (porcentaje <= 33) return "Fundacional";
    else if (porcentaje <= 66) return "Intermedio";
    else return "Avanzado";
  }

  function showResultCard(_content: string) {
    const porcentaje = Math.round((respuestasSi / TOTAL_PREGUNTAS) * 100);
    const nivel = computeLevel();

    resultContent.innerHTML = `<div class="flex flex-col gap-2 text-sm"><div class="flex justify-between bg-[#F7FAFC] dark:bg-[#001C26] px-4 py-3 rounded-xl"><span class="text-gray-500 dark:text-gray-400">Nivel</span><span class="font-bold text-[#00A8D8]">${nivel}</span></div><div class="flex justify-between bg-[#F7FAFC] dark:bg-[#001C26] px-4 py-3 rounded-xl"><span class="text-gray-500 dark:text-gray-400">Puntaje</span><span class="font-bold text-[#00A8D8]">${respuestasSi}/${TOTAL_PREGUNTAS} (${porcentaje}%)</span></div></div>`;
    resultCard.classList.remove("hidden");
    chatDisclaimer.classList.add("hidden");
    resultCard.scrollIntoView({ behavior: "smooth" });
  }

  // ─── PARSERS DIAGNÓSTICO PROFUNDO ───
  function esPreguntaProfunda(content: string): boolean {
    return /\[(CV|BD|EC|AP|IS|IC)\]\s+Pregunta \d+ de \d+/im.test(content);
  }

  function extraerCategoria(content: string): string {
    const match = content.match(/^\[(CV|BD|EC|AP|IS|IC)\]/im);
    return match ? match[1].toUpperCase() : "";
  }

  // Quita el prefijo [CV] del texto mostrado al usuario
  function limpiarPrefijoCat(content: string): string {
    return content.replace(/^\[(CV|BD|EC|AP|IS|IC)\]\s*/, "");
  }

  function esResultadoProfundo(content: string): boolean {
    return content.includes("=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===");
  }

  function parsearResultadosProfundos(content: string): Record<string, string> {
    const resultados: Record<string, string> = {};
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^(CV|BD|EC|AP|IS|IC):\s*(\d+\/\d+\s*\(\d+%\))/i);
      if (match) {
        resultados[match[1].toUpperCase()] = match[2].trim();
      }
    }
    return resultados;
  }

  function showDeepResultCard(resultados: Record<string, string>) {
    const catNames: Record<string, string> = {
      CV: "Control de Versiones",
      BD: "Build & Deploy",
      EC: "Código y Estándares",
      AP: "Automatización de Pruebas",
      IS: "Seguridad",
      IC: "Integración Continua"
    };
    const categories = ["CV", "BD", "EC", "AP", "IS", "IC"];
    let html = '<div class="flex flex-col gap-2 text-sm">';
    for (const cat of categories) {
      const score = resultados[cat] || "0/0 (0%)";
      html += '<div class="flex justify-between bg-[#F7FAFC] dark:bg-[#001C26] px-4 py-3 rounded-xl"><span class="text-gray-500 dark:text-gray-400">' + escapeHtml(catNames[cat] || cat) + '</span><span class="font-bold text-[#3E7CB5]">' + escapeHtml(score) + '</span></div>';
    }
    html += '</div>';
    deepResultContent.innerHTML = html;
    deepResultCard.classList.remove("hidden");
    chatDisclaimer.classList.add("hidden");
    deepResultCard.scrollIntoView({ behavior: "smooth" });
  }

  function esPaso2(content: string): boolean {
    return content.includes("listo para comenzar") && content.includes("- ");
  }

  function splitPaso2(content: string): string[] {
    const lines = content.split("\n");
    const greeting: string[] = [],
      bullets: string[] = [],
      closing: string[] = [];
    let section: "greeting" | "bullets" | "closing" = "greeting";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("-")) {
        section = "bullets";
        bullets.push(trimmed);
      } else if (section === "bullets" && trimmed.startsWith("¿")) {
        section = "closing";
        closing.push(trimmed);
      } else if (section === "closing") {
        closing.push(trimmed);
      } else {
        greeting.push(trimmed);
      }
    }
    const parts: string[] = [];
    const g = greeting.join("\n");
    if (g) parts.push(g);
    const b = bullets.join("\n");
    if (b) parts.push(b);
    const c = closing.join("\n");
    if (c) parts.push(c);
    return parts.length >= 2 ? parts : [content];
  }

  function esPregunta(content: string): boolean {
    return /Pregunta \d+ de \d+:/i.test(content);
  }

  function splitPregunta(content: string): string[] {
    // Intenta separar en: [ánimo, "Pregunta X de Y:", contenido]
    const match = content.match(/^(.+?)(Pregunta \d+ de \d+:)\s*(.+)$/is);
    if (!match) return [content];
    const antes = match[1].trim();
    const header = match[2].trim();
    const pregunta = match[3].trim();
    if (antes) {
      return [antes, header, pregunta];
    }
    return [header, pregunta];
  }

  function esResultado(content: string): boolean {
    const upper = content.toUpperCase();
    return upper.includes("RESULTADO DEL DIAGN") && (upper.includes("NIVEL:") || upper.includes("NIVEL "));
  }

  function splitResultado(content: string): string[] {
    const parts: string[] = [];
    const introMatch = content.match(/^([\s\S]*?)RESULTADO DEL DIAGNÓSTICO:/i);
    if (introMatch && introMatch[1].trim()) parts.push(introMatch[1].trim());
    const bloqueMatch = content.match(/(RESULTADO DEL DIAGNÓSTICO:[\s\S]*?Rangos: [^\n]+)/i);
    if (bloqueMatch) {
      parts.push(bloqueMatch[1].trim());
      const restante = content
        .substring(content.indexOf(bloqueMatch[1]) + bloqueMatch[1].length)
        .trim();
      if (restante) parts.push(restante);
    }
    return parts.length >= 2 ? parts : [content];
  }

  /** Limpia instrucciones del sistema que el modelo pequeño pueda escupir sin querer */
  function sanitizarTextoIA(texto: string): string {
    return texto
      .replace(/Si crees que el usuario[\s\S]*?importante:[\s\S]*?puntaje\.?/gi, "")
      .replace(/IMPORTANTE:?\s*No inventes?[\s\S]*?puntaje\.?/gi, "")
      .replace(/Despu[eé]s de dar recomendaciones[\s\S]*?\./gi, "")
      .replace(/Si te piden recomendaciones[\s\S]*?\./gi, "")
      .replace(/PREGUNTAS\s*\(hazlas en orden[^)]*\):?\s*/gi, "")
      .replace(/REGLAS?:?[\s\S]*?(?=\.|\n|$)/gi, "")
      .replace(/FLUJO:?[\s\S]*?(?=\.|\n|$)/gi, "")
      .replace(/PASO \d[^:]*:[\s\S]*?(?=\n\n|\n\d|\n¿|$)/gi, "")
      .replace(/Off-topic:[\s\S]*?(?=\.|\n|$)/gi, "")
      // Limpiar "IA" suelto y otras firmas que el modelo pueda inventar
      .replace(/^IA\s*$/gim, "")
      .replace(/^Asistente:?\s*$/gim, "")
      .replace(/^Respuesta:?\s*$/gim, "")
      .trim();
  }

  async function sendMessage(respuesta: string) {
    const content = respuesta;
    if (!content || isLoading || chatTerminado) return;

    // ── Contar Sí ──
    if (deepDiagnosticActive) {
      if (content.includes(":Si") && deepUltimaCategoria) {
        deepRespuestasPorCategoria[deepUltimaCategoria] = (deepRespuestasPorCategoria[deepUltimaCategoria] || 0) + 1;
      }
    } else {
      if (content.toUpperCase() === "SÍ" || content.toUpperCase() === "SI") respuestasSi++;
    }

    // Mostrar mensaje limpio al usuario (sin prefijo técnico)
    const displayContent = content.replace(/^\[DEEP:[^\]]+\]:/, "").trim();
    const userDisplay = displayContent === "INICIAR" ? "Iniciar diagnóstico profundo" : displayContent || content;
    addMessage("user", userDisplay);
    messages.push({ role: "user", content });

    isLoading = true;
    setButtonsLoading(true);
    addTypingIndicator();

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      removeTypingIndicator();

      if (!res.ok) {
        const err = await res.json();
        addMessage("assistant", `Error: ${err.hint || err.error || "Error desconocido"}`);
        return;
      }

      const data = await res.json();
      let fullReply = data.message?.content || "";

      // Limpiar artefactos del modelo en todas las respuestas
      fullReply = sanitizarTextoIA(fullReply);

      // ── Diagnóstico Profundo ──
      if (deepDiagnosticActive) {
        if (esResultadoProfundo(fullReply)) {
          deepDiagnosticoFinalizado = true;
          deepDiagnosticActive = false;
          const resultados = parsearResultadosProfundos(fullReply);
          addMessage("assistant", "Diagnóstico profundo completado. Estos son tus resultados por categoría:");
          await delay(500);
          showDeepResultCard(resultados);
          chatTerminado = true;
          diagnosticoFinalizado = true;
          showButtons(false);
          messages.push({ role: "assistant", content: fullReply });
        } else if (esPreguntaProfunda(fullReply)) {
          deepUltimaCategoria = extraerCategoria(fullReply);
          showButtons(true);
          addMessage("assistant", limpiarPrefijoCat(fullReply));
          messages.push({ role: "assistant", content: fullReply });
        } else {
          addMessage("assistant", limpiarPrefijoCat(fullReply));
          messages.push({ role: "assistant", content: fullReply });
        }
      } else if (!fullReply) {
        const fallback = "Lo siento, no pude procesar tu respuesta.";
        addMessage("assistant", fallback);
        messages.push({ role: "assistant", content: fallback });
      } else if (esPaso2(fullReply)) {
        const partes = splitPaso2(fullReply);
        for (let i = 0; i < partes.length; i++) addMessage("assistant", partes[i]);
        messages.push({ role: "assistant", content: fullReply });
      } else if (esPregunta(fullReply)) {
        showButtons(true);
        const partes = splitPregunta(fullReply);
        for (let i = 0; i < partes.length; i++) addMessage("assistant", partes[i]);
        messages.push({ role: "assistant", content: fullReply });
      } else if (esResultado(fullReply)) {
        // Limpiar el texto de la IA: borrar numeros inventados y despedidas prematuras
        let textoLimpio = sanitizarTextoIA(fullReply);
        // Borrar "Puntaje: X%" o "Puntaje: X/11" que la IA invente
        textoLimpio = textoLimpio.replace(/\*?Puntaje:?\*?\s*\d+[^\n]*/gi, "");
        textoLimpio = textoLimpio.replace(/\d+%\s*\w+/g, "");
        // Borrar despedidas que aparezcan antes de tiempo
        textoLimpio = textoLimpio.replace(/Gracias por confiar[^]*$/gi, "").trim();

        if (textoLimpio) {
          addMessage("assistant", "Diagnostico completado. Estos son tus resultados:");
        }
        await delay(500);
        showResultCard(textoLimpio);
        resultadoMostrado = true;

        showRecAndDeepButtons();
        messages.push({ role: "assistant", content: fullReply });
      } else if (resultadoMostrado) {
        const goodbyeMatch = fullReply.match(/(Gracias por confiar[^]*)$/i);
        if (goodbyeMatch) {
          const recText = fullReply.substring(0, fullReply.indexOf(goodbyeMatch[1])).trim();
          const goodbyeText = goodbyeMatch[1].trim();
          if (recText) addMessage("assistant", recText);
          addMessage("assistant", goodbyeText);
        } else {
          addMessage("assistant", fullReply);
        }
        diagnosticoFinalizado = true;
        btnRec.disabled = false;
        btnDeep.disabled = false;
      } else {
        addMessage("assistant", fullReply);
        messages.push({ role: "assistant", content: fullReply });
      }
    } catch (err: any) {
      removeTypingIndicator();
      addMessage(
        "assistant",
        "No se pudo conectar con el asistente. Intenta de nuevo en unos segundos."
      );
    } finally {
      isLoading = false;
      if (!diagnosticoFinalizado) setButtonsLoading(false);
    }
  }

  btnSi.addEventListener("click", () => {
    if (deepDiagnosticActive) {
      sendMessage("[DEEP:" + deepDiagnosticLevel + "]:Si");
    } else {
      sendMessage("Sí");
    }
  });
  btnNo.addEventListener("click", () => {
    if (deepDiagnosticActive) {
      sendMessage("[DEEP:" + deepDiagnosticLevel + "]:No");
    } else {
      sendMessage("No");
    }
  });
  btnRec.addEventListener("click", () => sendMessage("Quiero recomendaciones"));

  btnDeep.addEventListener("click", () => {
    showButtons(false);
    recContainer.classList.add("hidden");
    deepContainer.classList.add("hidden");
    resultCard.classList.add("hidden");

    deepDiagnosticLevel = computeLevel();
    deepDiagnosticActive = true;
    deepRespuestasPorCategoria = {};
    deepUltimaCategoria = "";
    deepCategoriasCompletadas = 0;
    deepDiagnosticoFinalizado = false;

    // Limpiar historial para que la IA empiece fresca el diagnóstico profundo
    messages = [];
    chatTerminado = false;
    diagnosticoFinalizado = false;
    resultadoMostrado = false;

    addMessage("assistant", "Iniciando diagnóstico profundo nivel " + deepDiagnosticLevel + "...");
    sendMessage("[DEEP:" + deepDiagnosticLevel + "]:INICIAR");
  });

  btnVolverChat.addEventListener("click", () => {
    if (chatTerminado) return;
    resultCard.classList.add("hidden");
    deepResultCard.classList.add("hidden");
    chatDisclaimer.classList.remove("hidden");
    messagesEl.scrollIntoView({ behavior: "smooth" });
  });

  btnSalir.addEventListener("click", () => {
    window.location.href = "/";
  });

  btnVolverDeep.addEventListener("click", () => {
    if (chatTerminado) return;
    deepResultCard.classList.add("hidden");
    chatDisclaimer.classList.remove("hidden");
    messagesEl.scrollIntoView({ behavior: "smooth" });
  });

  btnSalirDeep.addEventListener("click", () => {
    window.location.href = "/";
  });

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChatDiagnostico);
} else {
  initChatDiagnostico();
}
