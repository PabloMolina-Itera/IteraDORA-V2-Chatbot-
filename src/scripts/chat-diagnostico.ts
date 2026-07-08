import { marked } from "marked";

function initChatDiagnostico() {
  // Backend: endpoint de Astro SSR con Bedrock Claude integrado
  const API_URL = "/api/chat";

  // ─── Preguntas del diagnóstico (sin IA, lógica 100% frontend) ───
  const PREGUNTAS = [
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
  const btnSalirDeep = document.getElementById("btn-salir-deep")!;

  const TOTAL_PREGUNTAS = 11;
  const btnComenzar = document.getElementById("btn-comenzar") as HTMLButtonElement;

  type DiagnosticState = "idle" | "inProgress" | "completed";
  let state: DiagnosticState = "idle";
  let messages: { role: string; content: string }[] = [];
  let isLoading = false;
  let resultadoMostrado = false;
  let respuestasSi = 0;
  let preguntaActual = 0; // contador de preguntas (0 = no iniciado)

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

  // Los botones Sí/No están ocultos hasta que se pulse "Comencemos"
  btnSi.disabled = true;
  btnNo.disabled = true;

  const comenzarContainer = document.getElementById("comenzar-container")!;

  function mostrarSiguientePregunta() {
    if (preguntaActual >= TOTAL_PREGUNTAS) return;
    const idx = preguntaActual;
    const animo = idx > 0 ? "¡Ánimo! Vas muy bien.\n\n" : "";
    const texto = `${animo}Pregunta ${idx + 1} de ${TOTAL_PREGUNTAS}:\n\n${PREGUNTAS[idx]}`;
    addMessage("assistant", texto);
    messages.push({ role: "assistant", content: texto });
    btnSi.disabled = false;
    btnNo.disabled = false;
    state = "inProgress";
    scrollToBottom();
  }

  btnComenzar.addEventListener("click", () => {
    btnComenzar.disabled = true;
    btnComenzar.textContent = "Comenzando...";
    setTimeout(() => {
      comenzarContainer.classList.add("hidden");
      btnContainer.classList.remove("hidden");
      mostrarSiguientePregunta();
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

  function renderDashboard(markdown: string): HTMLElement {
    const container = document.createElement("div");
    container.className = "dashboard-recomendaciones";

    // Parsear secciones: FORTALEZAS, OPORTUNIDADES, CONCLUSIÓN
    const sections = parseSecciones(markdown);

    // Encabezado del dashboard
    const header = document.createElement("div");
    header.className = "dashboard-header";
    header.innerHTML = '<div class="dashboard-icon">📊</div><div><h3>Informe de Diagnóstico</h3><p>Análisis detallado de madurez DevOps</p></div>';
    container.appendChild(header);

    // Fortalezas
    if (sections.fortalezas) {
      const sec = document.createElement("div");
      sec.className = "dashboard-section";
      sec.innerHTML = '<h4 class="section-title fortalezas"><span class="section-icon">✓</span> Fortalezas Identificadas</h4>';
      const body = document.createElement("div");
      body.className = "section-body";
      body.innerHTML = marked.parse(sections.fortalezas) as string;
      // Convertir cada <li> en una card
      body.querySelectorAll("li").forEach((li) => {
        li.className = "dashboard-card card-fortaleza";
      });
      sec.appendChild(body);
      container.appendChild(sec);
    }

    // Oportunidades
    if (sections.oportunidades) {
      const sec = document.createElement("div");
      sec.className = "dashboard-section";
      sec.innerHTML = '<h4 class="section-title oportunidades"><span class="section-icon">⚡</span> Oportunidades de Mejora</h4>';
      const body = document.createElement("div");
      body.className = "section-body";
      body.innerHTML = marked.parse(sections.oportunidades) as string;
      body.querySelectorAll("li").forEach((li, i) => {
        li.className = "dashboard-card card-oportunidad";
        // Prioridad según orden
      });
      sec.appendChild(body);
      container.appendChild(sec);
    }

    // Conclusión
    if (sections.conclusion) {
      const sec = document.createElement("div");
      sec.className = "dashboard-section conclusion-section";
      sec.innerHTML = '<h4 class="section-title conclusion"><span class="section-icon">💡</span> Conclusión y Próximos Pasos</h4>';
      const body = document.createElement("div");
      body.className = "section-body conclusion-body";
      body.innerHTML = marked.parse(sections.conclusion) as string;
      sec.appendChild(body);
      container.appendChild(sec);
    }

    return container;
  }

  function parseSecciones(md: string): { fortalezas: string; oportunidades: string; conclusion: string } {
    let fortalezas = "";
    let oportunidades = "";
    let conclusion = "";

    // Normalizar: quitar ** de encabezados
    let text = md.replace(/\*\*(FORTALEZAS?|OPORTUNIDADES?\s*(DE\s*MEJORA)?|CONCLUSI[ÓO]N|RECOMENDACIONES?)\*\*/gi, "### $1");
    text = text.replace(/^#+\s*(FORTALEZAS?|OPORTUNIDADES?\s*(DE\s*MEJORA)?|CONCLUSI[ÓO]N|RECOMENDACIONES?)/gim, "### $1");

    // Separar por ### encabezados
    const parts = text.split(/^###\s+/gim);
    let currentSection = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      const lines = part.split("\n");
      const firstLine = lines[0].toUpperCase().trim();

      if (firstLine.includes("FORTALEZA")) {
        currentSection = "fortalezas";
        fortalezas = lines.slice(1).join("\n").trim();
      } else if (firstLine.includes("OPORTUNIDAD") || firstLine.includes("MEJORA")) {
        currentSection = "oportunidades";
        oportunidades = lines.slice(1).join("\n").trim();
      } else if (firstLine.includes("CONCLUSI")) {
        currentSection = "conclusion";
        conclusion = lines.slice(1).join("\n").trim();
      } else if (currentSection === "fortalezas") {
        fortalezas += "\n" + part;
      } else if (currentSection === "oportunidades") {
        oportunidades += "\n" + part;
      } else if (currentSection === "conclusion") {
        conclusion += "\n" + part;
      }
    }

    // Si no se detectaron secciones, dividir por patrones alternativos
    if (!fortalezas && !oportunidades) {
      // Intentar split por líneas ALL CAPS
      const altParts = text.split(/^([A-ZÁÉÍÓÚÑ\s]{5,})$/gim);
      let altSection = "";
      for (let i = 0; i < altParts.length; i++) {
        const p = altParts[i].trim();
        if (!p) continue;
        if (/^[A-ZÁÉÍÓÚÑ\s]{5,}$/.test(p)) {
          const upper = p.toUpperCase();
          if (upper.includes("FORTALEZA")) altSection = "fortalezas";
          else if (upper.includes("OPORTUNIDAD") || upper.includes("MEJORA")) altSection = "oportunidades";
          else if (upper.includes("CONCLUSI")) altSection = "conclusion";
          else altSection = "";
        } else if (altSection === "fortalezas") fortalezas += p + "\n";
        else if (altSection === "oportunidades") oportunidades += p + "\n";
        else if (altSection === "conclusion") conclusion += p + "\n";
      }
    }

    // Si sigue sin detectar, usar todo como conclusión
    if (!fortalezas && !oportunidades && !conclusion) {
      conclusion = md;
    }

    return {
      fortalezas: fortalezas.trim(),
      oportunidades: oportunidades.trim(),
      conclusion: conclusion.trim(),
    };
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
    } else {
      btnContainer.classList.add("hidden");
      recContainer.classList.add("hidden");
      deepContainer.classList.add("hidden");
      btnSi.disabled = true;
      btnNo.disabled = true;
      btnRec.disabled = true;
      btnDeep.disabled = true;
    }
  }

  function showRecAndDeepButtons() {
    btnContainer.classList.add("hidden");
    recContainer.classList.remove("hidden");
    deepContainer.classList.remove("hidden");
    btnRec.disabled = false;
    btnDeep.disabled = false;
  }

  function showRecButton() {
    btnContainer.classList.add("hidden");
    recContainer.classList.remove("hidden");
    deepContainer.classList.remove("hidden");
    btnRec.disabled = false;
    btnDeep.disabled = false;
  }

  function setButtonsLoading(loading: boolean) {
    if (state === "completed") return;
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

  function showResultCard() {
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
    const upper = content.toUpperCase();
    // Detectar bloque de métricas en cualquier formato (estricto o markdown)
    if (upper.includes("=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===")) return true;
    if (upper.includes("**RESULTADOS DEL DIAGNÓSTICO") || upper.includes("RESULTADOS DEL DIAGNÓSTICO")) {
      // Verificar que contenga al menos 2 categorías DORA con puntuaciones
      const catMatches = content.match(/(?:^|\n)\s*(?:\*{1,2}\s*)?(CV|BD|EC|AP|IS|IC)\s*(?:\([^)]+\))?\*{0,2}\s*:\s*\d+\/\d+/gim);
      if (catMatches && catMatches.length >= 2) return true;
    }
    // Detectar por patrones de puntuación DORA (mínimo 2 categorías con score)
    const scorePattern = /(?:^|\n)\s*(?:\*{0,2}\s*)?(CV|BD|EC|AP|IS|IC)\s*(?:\([^)]+\))?\*{0,2}\s*:\s*\d+\/\d+\s*\(\d+(?:\.\d+)?%\)/gim;
    const scoreMatches = content.match(scorePattern);
    if (scoreMatches && scoreMatches.length >= 2) return true;
    // Fallback: reseña + conclusión
    if (upper.includes("RESEÑA") && upper.includes("CONCLUSI")) return true;
    // Fallback: recomendaciones con categorías
    if (upper.includes("RECOMENDACIONES") && scoreMatches && scoreMatches.length >= 1) return true;
    return false;
  }

  function parsearResultadosProfundos(content: string): Record<string, string> {
    const resultados: Record<string, string> = {};
    const lines = content.split("\n");
    for (const line of lines) {
      // Formato estricto: CV: 0/1 (0%)
      let match = line.match(/^(CV|BD|EC|AP|IS|IC):\s*(\d+\/\d+\s*\(\d+(?:\.\d+)?%\))/i);
      if (!match) {
        // Formato markdown con bullet: * **CV (Control de Versiones)**: 0/1 (0%)
        match = line.match(/^[\s\*\-+]*\*{0,2}(CV|BD|EC|AP|IS|IC)\s*(?:\([^)]+\))?\*{0,2}\s*:\s*(\d+\/\d+\s*\(\d+(?:\.\d+)?%\))/i);
      }
      if (match) {
        resultados[match[1].toUpperCase()] = match[2].trim();
      }
    }
    return resultados;
  }

  function renderDeepDashboard(markdown: string) {
    const resultados = parsearResultadosProfundos(markdown);
    const dashboard = document.createElement("div");
    dashboard.className = "deep-dashboard";

    // ─── Encabezado ───
    const header = document.createElement("div");
    header.className = "deep-header";
    header.innerHTML = '<div class="deep-header-icon">◆</div><div><h3>Resultados del Diagnóstico Profundo</h3><p>Análisis detallado por categoría DORA</p></div>';
    dashboard.appendChild(header);

    // ─── Métricas ───
    const metricsGrid = document.createElement("div");
    metricsGrid.className = "deep-metrics-grid";

    const catConfig: Record<string, { name: string; icon: string }> = {
      CV: { name: "Control de Versiones", icon: "🔀" },
      BD: { name: "Build & Deployment", icon: "⚙️" },
      EC: { name: "Estándares de Código", icon: "📋" },
      AP: { name: "Automatización de Pruebas", icon: "🧪" },
      IS: { name: "Ingeniería de Seguridad", icon: "🔒" },
      IC: { name: "Integración Continua", icon: "🔄" },
    };
    const categories = ["CV", "BD", "EC", "AP", "IS", "IC"];

    for (const cat of categories) {
      const scoreStr = resultados[cat] || "0/0 (0%)";
      const match = scoreStr.match(/(\d+)\/(\d+)\s*\((\d+(?:\.\d+)?)%\)/);
      const correct = match ? parseInt(match[1]) : 0;
      const total = match ? parseInt(match[2]) : 1;
      const pct = match ? parseFloat(match[3]) : 0;
      const cfg = catConfig[cat] || { name: cat, icon: "📊" };

      let colorClass = "deep-red";
      if (pct >= 70) colorClass = "deep-green";
      else if (pct >= 40) colorClass = "deep-amber";

      const card = document.createElement("div");
      card.className = "deep-metric-card";
      card.innerHTML = `
        <div class="deep-metric-top">
          <span class="deep-metric-icon">${cfg.icon}</span>
          <div class="deep-metric-info">
            <span class="deep-metric-name">${escapeHtml(cfg.name)}</span>
            <span class="deep-metric-tag">${cat}</span>
          </div>
          <span class="deep-metric-pct ${colorClass}">${pct.toFixed(0)}%</span>
        </div>
        <div class="deep-progress-bar">
          <div class="deep-progress-fill ${colorClass}" style="width:${Math.min(100, pct)}%"></div>
        </div>
        <div class="deep-metric-score">${correct} de ${total} prácticas</div>`;
      metricsGrid.appendChild(card);
    }
    dashboard.appendChild(metricsGrid);

    // ─── Extraer texto post-métricas: reseña, conclusión, recomendaciones ───
    const postMetrics = markdown.split(/=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===/i)[1] || markdown;
    const allLines = postMetrics.split("\n");
    const scoreLines: string[] = [];
    const otherLines: string[] = [];
    let scoresSection = true;
    for (const line of allLines) {
      const t = line.trim();
      if (!t) continue;
      if (/^(CV|BD|EC|AP|IS|IC):\s*\d+\/\d+/.test(t)) {
        scoreLines.push(t);
      } else if (scoresSection && /^\w{2}:\s*\d+\/\d+/.test(t)) {
        scoreLines.push(t);
      } else {
        scoresSection = false;
        otherLines.push(t);
      }
    }

    if (otherLines.length > 0) {
      const fullText = otherLines.join("\n");
      const sections = parseSecciones(fullText);

      // Reseña / Análisis
      if (sections.fortalezas || sections.oportunidades) {
        if (sections.fortalezas) {
          const sec = document.createElement("div");
          sec.className = "deep-analysis";
          sec.innerHTML = '<h4>📊 Reseña de Resultados</h4><div class="deep-analysis-body">' + (marked.parse(sections.fortalezas) as string) + '</div>';
          dashboard.appendChild(sec);
        }
        if (sections.oportunidades) {
          const sec = document.createElement("div");
          sec.className = "deep-analysis";
          sec.innerHTML = '<h4>💡 Recomendaciones</h4><div class="deep-analysis-body">' + (marked.parse(sections.oportunidades) as string) + '</div>';
          dashboard.appendChild(sec);
        }
      } else {
        // Sin secciones claras: mostrar todo junto como análisis
        const sec = document.createElement("div");
        sec.className = "deep-analysis";
        sec.innerHTML = '<h4>📊 Análisis y Recomendaciones</h4><div class="deep-analysis-body">' + (marked.parse(fullText) as string) + '</div>';
        dashboard.appendChild(sec);
      }

      // Conclusión
      if (sections.conclusion) {
        const sec = document.createElement("div");
        sec.className = "deep-analysis conclusion-section";
        sec.innerHTML = '<h4>🎯 Conclusión</h4><div class="conclusion-body">' + (marked.parse(sections.conclusion) as string) + '</div>';
        dashboard.appendChild(sec);
      }
    }

    return dashboard;
  }

  function showDeepResultCard(content: string) {
    const dashboard = renderDeepDashboard(content);
    deepResultContent.innerHTML = "";
    deepResultContent.appendChild(dashboard);
    deepResultCard.classList.remove("hidden");
    chatDisclaimer.classList.add("hidden");
    deepResultCard.scrollIntoView({ behavior: "smooth" });
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

  /** Limpia artefactos del modelo (firmas sueltas, instrucciones filtradas) */
  function sanitizarTextoIA(texto: string): string {
    return texto
      .replace(/^IA\s*$/gim, "")
      .replace(/^(Asistente|Respuesta):?\s*$/gim, "")
      .trim();
  }

  async function sendMessage(respuesta: string) {
    const content = respuesta;
    if (!content || isLoading || state === "completed") return;

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

    // ── DIAGNÓSTICO GENERAL: preguntas SIN llamada a la API ──
    if (!deepDiagnosticActive && state === "inProgress") {
      preguntaActual++;
      if (preguntaActual < TOTAL_PREGUNTAS) {
        // Mostrar siguiente pregunta directamente (sin API)
        await delay(400);
        mostrarSiguientePregunta();
        return;
      }
      // Si llegamos a la última pregunta, calcular resultado localmente
      if (preguntaActual === TOTAL_PREGUNTAS) {
        isLoading = true;
        setButtonsLoading(true);
        addTypingIndicator();
        await delay(600);
        removeTypingIndicator();

        const porcentaje = Math.round((respuestasSi / TOTAL_PREGUNTAS) * 100);
        let nivel = "Fundacional";
        if (porcentaje > 66) nivel = "Avanzado";
        else if (porcentaje > 33) nivel = "Intermedio";

        // Intentar obtener resumen personalizado de la IA
        try {
          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
          });
          if (res.ok) {
            const data = await res.json();
            let fullReply = data.message?.content || "";
            fullReply = sanitizarTextoIA(fullReply);

            if (fullReply && esResultado(fullReply)) {
              let textoLimpio = sanitizarTextoIA(fullReply);
              textoLimpio = textoLimpio.replace(/\*?Puntaje:?\*?\s*\d+[^\n]*/gi, "");
              textoLimpio = textoLimpio.replace(/\d+%\s*\w+/g, "");
              textoLimpio = textoLimpio.replace(/Gracias por confiar[^]*$/gi, "").trim();
              if (textoLimpio) {
                addMessage("assistant", "Diagnóstico completado. Estos son tus resultados:");
              }
            }
          }
        } catch (_) {
          // Si la IA no responde, usamos resultado local
        }

        await delay(400);
        showResultCard();
        resultadoMostrado = true;
        showRecButton();
        state = "completed";
        showButtons(false);
        isLoading = false;
        return;
      }
    }

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
          deepDiagnosticActive = false;
          addMessage("assistant", "✅ Diagnóstico profundo completado.");
          await delay(500);
          showDeepResultCard(fullReply);
          state = "completed";
          showButtons(false);
          recContainer.classList.add("hidden");
          deepContainer.classList.add("hidden");
          btnContainer.classList.add("hidden");
          messages.push({ role: "assistant", content: fullReply });
        } else if (esPreguntaProfunda(fullReply)) {
          deepUltimaCategoria = extraerCategoria(fullReply);
          showButtons(true);
          addMessage("assistant", limpiarPrefijoCat(fullReply));
          messages.push({ role: "assistant", content: fullReply });
        } else {
          // No es pregunta ni resultado: ocultar botones (análisis o contenido final)
          showButtons(false);
          addMessage("assistant", limpiarPrefijoCat(fullReply));
          messages.push({ role: "assistant", content: fullReply });
        }
      } else if (!fullReply) {
        const fallback = "Lo siento, no pude procesar tu respuesta.";
        addMessage("assistant", fallback);
        messages.push({ role: "assistant", content: fallback });
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
        showResultCard();
        resultadoMostrado = true;

        showRecButton();
        messages.push({ role: "assistant", content: fullReply });
      } else if (resultadoMostrado) {
        // Renderizar recomendaciones como dashboard profesional
        const dashboard = renderDashboard(fullReply);
        messagesEl.appendChild(dashboard);
        scrollToBottom();
        state = "completed";
        // Ocultar "Regresar al chat", solo "Volver al inicio" + Deep
        document.getElementById("btn-volver-chat")!.classList.add("hidden");
        recContainer.classList.add("hidden");
        btnRec.disabled = true;
        deepContainer.classList.remove("hidden");
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
      if (state !== "completed") setButtonsLoading(false);
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

    // Limpiar historial para que la IA empiece fresca el diagnóstico profundo
    messages = [];
    state = "inProgress";
    resultadoMostrado = false;

    addMessage("assistant", "Iniciando diagnóstico profundo nivel " + deepDiagnosticLevel + "...");
    sendMessage("[DEEP:" + deepDiagnosticLevel + "]:INICIAR");
  });

  btnVolverChat.addEventListener("click", () => {
    if (state === "completed") return;
    resultCard.classList.add("hidden");
    deepResultCard.classList.add("hidden");
    chatDisclaimer.classList.remove("hidden");
    messagesEl.scrollIntoView({ behavior: "smooth" });
  });

  btnSalir.addEventListener("click", () => {
    window.location.href = "/";
  });

  btnSalirDeep.addEventListener("click", () => {
    window.location.href = "/";
  });

  // ─── PREVIEW: ?preview en la URL muestra el dashboard con datos de ejemplo ───
  if (window.location.search.includes("preview")) {
    const previewData = `=== RESULTADOS DEL DIAGNÓSTICO PROFUNDO ===
CV: 1/2 (50%)
BD: 8/11 (72.73%)
EC: 7/10 (70%)
AP: 12/19 (63.16%)
IS: 9/12 (75%)
IC: 5/11 (45.45%)

**Fortalezas**
- Excelente desempeño en Ingeniería de Seguridad (IS) con un 75% de adopción de prácticas como SAST, escaneo de dependencias y secrets management.
- Build & Deployment (BD) muestra madurez con pipelines automatizados y despliegues consistentes.
- Estándares de Código (EC) bien establecidos con linters y revisiones de pares.

**Oportunidades**
- Integración Continua (IC) es el área más débil con solo 45% — se recomienda implementar CI/CD con pruebas automáticas en cada commit.
- Control de Versiones (CV) necesita atención inmediata: solo 1 de 2 prácticas adoptadas. Estrategia de branching y code review formal pendientes.
- Automatización de Pruebas (AP) en 63% — aumentar cobertura de tests unitarios y de integración.

**Conclusión**
El nivel de madurez DevOps general es intermedio (62%). Las áreas de seguridad y despliegue están sólidas, pero se requiere un plan de acción urgente en control de versiones e integración continua para alcanzar un nivel avanzado en los próximos 6 meses.`;

    setTimeout(() => {
      state = "inProgress";
      deepDiagnosticActive = true;
      showDeepResultCard(previewData);
      state = "completed";
      showButtons(false);
      recContainer.classList.add("hidden");
      (document.getElementById("deep-container") as HTMLElement).classList.add("hidden");
      (document.getElementById("btn-container") as HTMLElement).classList.add("hidden");
    }, 300);
  }

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChatDiagnostico);
} else {
  initChatDiagnostico();
}
