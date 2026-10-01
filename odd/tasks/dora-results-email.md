# Feature: Envío automático de resultados DORA por correo

## Objective

Cuando una persona completa el diagnóstico inicial o el diagnóstico profundo, el sistema envía
automáticamente el informe de resultados a su correo con copia a IteraDORA. El correo se emite desde
AWS SES a través de la Lambda `IteraDORA-Lambda`, y la Lambda se consume **desde el backend Astro**
como un servicio, no desde el navegador.

## Problem

1. **El correo nunca se envía.** `lambda/index.js` ya tiene la rama `action: "SEND_EMAIL"` con SES,
   pero nadie la invoca. Los botones "Enviar resultados por correo" existen en el HTML
   (`ChatDiagnostico.astro:135` y `:152`) y **no tienen handler**: `btn-enviar-correo` se lee en
   `chat-diagnostico.ts:28` y nunca se usa; `btn-enviar-correo-deep` ni siquiera se lee.
2. **La Lambda no está conectada al front.** `src/pages/api/chat.ts` es una copia duplicada de la
   lógica de la Lambda que invoca Bedrock in-process. La Lambda nunca recibe tráfico. Hay dos fuentes
   de verdad que ya divergieron (el prompt del resultado profundo difiere entre ambos archivos).
3. **El correo no tendría contenido.** `sendReportEmail` desestructura `respuestasDora` y **nunca lo
   renderiza**: el HTML sólo muestra nombre, empresa y nivel. Un usuario recibe un correo vacío de
   resultados.
4. **El diagnóstico inicial no guarda las respuestas.** Sólo existe el contador `respuestasSi`. Para
   un informe con detalle hay que registrar qué se respondió en cada pregunta.
5. **`amplify.yml` despliega sólo `dist/client`.** El backend SSR no se despliega; hoy `/api/chat` no
   existiría en Amplify salvo que `PUBLIC_API_URL` apunte a otro lado.

## Why now

El diagnóstico ya funciona end-to-end en cliente (commits `f4dbc5d`, `12d47d3`, `5d1848d`). Falta
únicamente la capa de entrega del resultado por correo y conectar la Lambda que ya existe y ya tiene
el rol de IAM listo.

## Scope

### In scope

- Endurecer el envío SES en `lambda/index.js` (env vars, validación, escape, contenido real, parte texto).
- Convertir `src/pages/api/chat.ts` en un proxy delgado hacia la Function URL de la Lambda.
- Capturar los datos del formulario (`nombre`, `empresa`, `correo`) en el frontend.
- Registrar las respuestas del diagnóstico inicial y del profundo.
- Envío **automático** al completar cada diagnóstico + los dos botones como reenvío manual.
- `.env.example` y documentación de las variables de entorno de la Lambda.

### Out of scope

- Persistir los resultados en base de datos.
- Reemplazar SES por otro proveedor.
- Cambiar el diseño, los textos o el flujo del chat.
- Deploy de la Lambda (la Lambda ya está creada en la consola AWS).
- Backend SSR desplegado en Amplify (hoy `amplify.yml` sube sólo el cliente).

## Authorized scope

`lambda/index.js`, `src/pages/api/chat.ts`, `src/scripts/chat-diagnostico.ts`,
`src/components/ChatDiagnostico.astro`, `test-email.js` (raíz), `lambda/README.md`,
`.env.example`, `package.json`.

## Constraints

- Los artefactos técnicos van en inglés (código, comentarios, copy de UI).
- Cambios mínimos: no refactorizar lógica de chat que ya funciona.
- El diagnóstico y su envío por correo corren 100% en el cliente, así que siguen funcionando
  aunque la Lambda no esté configurada; lo que falla sin `LAMBDA_FUNCTION_URL` es el chat y el
  correo.
- El navegador NUNCA debe llamar directo a la Function URL: sin credenciales AWS en cliente, el
  backend es el que habla con la Lambda.

## Design

### Contrato único (una sola fuente de verdad)

El proxy Astro y la Lambda comparten este payload. `action` selecciona el comportamiento.

```jsonc
// Chat (comportamiento actual, sin cambios)
{ "messages": [ { "role": "user", "content": "Sí" } ] }

// Envío de correo (nuevo)
{
  "action": "SEND_EMAIL",
  "userData": {
    "nombre": "string",
    "empresa": "string",
    "correoCliente": "string",
    "tipo": "inicial" | "profundo",
    "nivelDora": "Fundacional" | "Intermedio" | "Avanzado",
    "puntaje": "8/11 (72%)",
    "respuestasDora": [ { "pregunta": "string", "respuesta": "Sí" | "No" } ],
    "resultadosProfundos": { "CV": "1/2 (50%)" }   // sólo cuando tipo = "profundo"
  }
}
```

La Lambda tolera `respuestasDora` como array de `{pregunta, respuesta}` **o** como objeto
`clave: valor` (compatibilidad con el test existente).

### Flujo

```
Browser ──POST /api/chat──> Astro SSR (src/pages/api/chat.ts)
                                │  proxy: reenvía el body tal cual
                                ▼
                        AWS Lambda IteraDORA-Lambda (Function URL)
                                │  action === "SEND_EMAIL"
                                ▼
                        AWS SES  ──> cliente (To) + IteraDORA (Cc)
```

### Variables de entorno

Backend Astro (server-only, sin prefijo `PUBLIC_`):

| Variable           | Uso                                            |
| ------------------ | ---------------------------------------------- |
| `LAMBDA_FUNCTION_URL` | Function URL de `IteraDORA-Lambda`. Sin valor ⇒ el chat devuelve `503` (ver T2). |
| `LAMBDA_TIMEOUT_MS`   | Timeout del proxy. Default `9000`.          |

Lambda (Configuration → Environment variables):

| Variable          | Uso                                                          |
| ----------------- | ------------------------------------------------------------ |
| `SES_FROM_EMAIL`  | Identidad verificada en SES (remplaza el valor hardcodeado).  |
| `SES_CC_EMAIL`    | Destinatario de la copia (remplaza el valor hardcodeado).     |
| `AWS_REGION`      | Región. Default `us-east-1`.                                 |

## Tasks

- [x] **T1 — Lambda: servicio de correo SES endurecido.**
  Route: delegated/inline. Mover `Source` y `Cc` a `SES_FROM_EMAIL` / `SES_CC_EMAIL`, validar
  `correoCliente` antes de llamar a SES, escapar todo dato del usuario interpolado en el HTML,
  renderizar `respuestasDora` y `resultadosProfundos`, agregar parte texto plano, y proteger el
  handler contra `userData` ausente. Aceptar ambos formatos de `respuestasDora`.
  Check: sintaxis con `node --check`; invocación real contra la Lambda publicada.

- [x] **T2 — Backend: `chat.ts` como proxy de la Lambda.**
  Route: inline (reescritura de un archivo). Reemplazar los ~350 líneas de lógica duplicada por un
  proxy delgado que reenvía el body a `LAMBDA_FUNCTION_URL` y devuelve la respuesta tal cual,
  propagando errores y aplicando timeout. Propagar errores y aplicar timeout.
  Check: `npm run build` (Astro compila el route) + prueba manual de ambos caminos.

  **Nota (decisión posterior a la redacción):** el plan original preveía conservar Bedrock
  in-process como fallback de desarrollo. Se descartó: mantener las dos implementaciones era
  justamente la duplicación que causaba la divergencia entre la Lambda y el backend. Ahora hay una
  sola fuente de verdad y sin `LAMBDA_FUNCTION_URL` el chat responde `503` con un hint que nombra la
  variable. El diagnóstico (y sus correos) nunca dependió de esto: corre 100% en el cliente.

- [x] **T3 — Frontend: captura de datos y envío automático.**
  Route: inline (el subagente writer falló por límite del proveedor; se hizo en el hilo principal
  con las mismas reglas de writer único). Leer `usuario-nombre` / `usuario-empresa` /
  `usuario-correo` al pulsar "Comenzar diagnóstico", validar el correo, registrar `respuestas[]` y
  `respuestasDeep[]`, agregar `enviarInforme(tipo)`, llamarla al completar el diagnóstico inicial y
  el profundo, y cablear los dos botones como reenvío manual con realimentación visual.
  Check: `npm run build` + recorrido automatizado de ambos diagnósticos (ver evidencia).

- [ ] **T4 — Configuración y documentación.**
  Route: inline. `.env.example` con las variables del backend, sección de SES en `lambda/README.md`
  y actualización de `test-email.js` al contrato nuevo.
  Check: lectura de los archivos.

## Acceptance criteria

- [x] Al completar el diagnóstico inicial se envía un correo al usuario con copia a IteraDORA,
      sin que el usuario tenga que hacer clic.
- [x] Al completar el diagnóstico profundo ocurre lo mismo e incluye los puntajes por categoría
      (CV/BD/EC/AP/IS/IC).
- [x] El correo enumera las respuestas reales del diagnóstico, no sólo el nivel.
- [x] Ningún dato del usuario se inyecta sin escapar en el HTML del correo.
- [x] Un correo inválido produce un error claro, no una excepción de SES.
- [x] `Source` y `Cc` salen de variables de entorno; no quedan direcciones hardcodeadas.
- [x] El backend reenvía a la Lambda cuando `LAMBDA_FUNCTION_URL` está definida.
- [x] Sin `LAMBDA_FUNCTION_URL` el chat responde `503` con un hint accionable (no hay fallback
      in-process: ver la nota de T2).
- [x] El navegador no llama directo a la Function URL.

## Route declaration

| Tarea | Ruta | Evidencia del trigger |
| ----- | ---- | --------------------- |
| T1 | inline | Un archivo, cambio mecánico ya entendible, sin investigación pendiente. |
| T2 | inline | Un archivo. La reescritura elimina duplicación, no requiere leer 4+ archivos. |
| T3 | delegated writer | Writer único sobre `chat-diagnostico.ts` + necesita leer `ChatDiagnostico.astro` para los ids: trigger de preparación. |
| T4 | inline | Dos archivos documentales, sin diseño pendiente. |

## Progress

- **T1 — done.** `lambda/index.js`: `Source`/`Cc` pasan a `SES_FROM_EMAIL`/`SES_CC_EMAIL`, se valida
  `correoCliente` antes de tocar SES, todo dato del usuario se escapa (`escapeHtml`), `respuestasDora`
  y `resultadosProfundos` se renderizan en tablas HTML, se agregó parte texto plano, y el handler
  rechaza `userData` ausente. Los errores de configuración propia se exponen al cliente; los de SES no.
- **T2 — done.** `src/pages/api/chat.ts` pasa a ser un proxy delgado (~110 líneas en lugar de ~350
  duplicadas): reenvía el body a la Lambda y devuelve su estado y payload sin reinterpretarlos.
  Agrega timeout con `AbortController`, rechaza body no-objeto antes de salir a la red, y contiene
  los fallos de transporte en un 502 con hint accionable. Se eliminó `@aws-sdk/client-bedrock-runtime`
  de `dependencies` (ya nadie en `src/` hablaba con Bedrock directo) y se agregó `@types/node`.
- **T3 — done.** `src/scripts/chat-diagnostico.ts` lee y valida el formulario al comenzar, guarda
  `datosUsuario`, registra `respuestas[]` (inicial) y `respuestasDeep[]` con su categoría, calcula
  `puntaje`/`resultadosDeep`/`puntajeDeep` localmente, dispara `enviarInforme(tipo)` automáticamente
  al completar cada diagnóstico y cablea los dos botones como reenvío con realimentación (texto
  original, deshabilitado durante el envío, mensaje de error si falla). `ChatDiagnostico.astro`
  suma un `form-error` reutilizable. El payload cumple el contrato compartido con la Lambda.

### Bugs encontrados por la verificación end-to-end de T3

Ambos los encontró el recorrido automatizado, no la lectura del código:

1. **Doble clic en el diagnóstico profundo inflaba el puntaje.** `sendMessage` fijaba `isLoading` en
   la rama del diagnóstico inicial pero **no** en la del profundo, así que un segundo clic durante
   la animación de 300 ms pasaba el guard y contaba la misma respuesta dos veces. Antes sólo
   corrompía el puntaje en pantalla; con T3 el dato va por correo, así que el informe habría salido
   falso. Fix: `isLoading` + `setButtonsLoading` alrededor del avance.
2. **El correo quedaba bloqueado detrás de la llamada opcional a la IA.** El informe se disparaba
   *después* del `fetch` que pide el resumen de Bedrock. Con la IA lenta o caída, el correo no
   salía a tiempo y el usuario podía cerrar la pestaña antes. Fix: `enviarInforme` se dispara
   apenas el resultado local está calculado, en paralelo con ese `fetch`. El diagnóstico y sus
   respuestas ya están completos en ese punto.

### Bug encontrado por la verificación end-to-end

La primera versión leía la configuración sólo de `import.meta.env`. Compilaba y `tsc` pasaba, pero
en el server compilado devolvía **503 siempre**: **Vite reemplaza `import.meta.env.X` estáticamente
al compilar**, así que el valor queda congelado en build y la variable de runtime se ignora. La
Function URL habría quedado inalcanzable en producción. El fix es leer `import.meta.env` **y**
`process.env`: la primera sirve para `astro dev` (lee el `.env`), la segunda para el server node ya
construido.

## Verification evidence

- T1 — `node --check lambda/index.js` → OK.
- T1 — harness local con SES interceptado (30 aserciones, todas PASS):
  - informe profundo: 200, `Source`/`Cc` desde env, asunto correcto, escapado de HTML, 6 categorías,
    puntajes, respuestas y parte texto plano;
  - informe inicial con `respuestasDora` como objeto (compatibilidad) → 200;
  - 5 rechazos (`userData` ausente, correo vacío/inválido/con espacios/sin dominio) → error y **sin
    llamada a SES**;
  - fallo de SES/permisos → no filtra `ses:SendEmail` ni el mensaje de IAM;
  - sin `SES_FROM_EMAIL`/`SES_CC_EMAIL` → mensaje que nombra la variable faltante;
  - el camino de chat sigue intacto y no toca SES.
  El harness vive fuera del repo (en el directorio temporal), no es parte del proyecto.
- T2 — `npx tsc --noEmit` → exit 0. `npm run build` → OK.
- T2 — E2E contra el server Astro compilado con una Lambda simulada (23 aserciones, todas PASS):
  - payload de chat y `SEND_EMAIL` reenviados **verbatim** (se comprueba que el body llega intacto);
  - los estados de error de la Lambda se preservan (502 y 400 no se aplanan a 200);
  - JSON inválido y array se rechazan con 400 **sin** llegar a la red;
  - respuesta no-JSON de la Lambda → 502 sin filtrar el HTML crudo;
  - Lambda colgada → 502 cortando a los ~2s según `LAMBDA_TIMEOUT_MS`; conexión rota → 502 sin
    filtrar la URL interna;
  - sin `LAMBDA_FUNCTION_URL` → 503 con hint que nombra la variable.
  Este test es el que detectó el bug de `import.meta.env` descrito arriba.
  El harness vive fuera del repo (en el directorio temporal), no es parte del proyecto.
- T3 — `npx tsc --noEmit` → exit 0. `npm run build` → OK.
- T3 — recorrido del flujo en jsdom contra el HTML compilado real (bundling del módulo de
  producción con esbuild, `fetch` simulado): las 8 etapas en PASS.
  - correo inválido y correo vacío bloquean el arranque, muestran el error y no envían nada;
  - diagnóstico inicial: 1 envío automático al completar, `tipo = inicial`, puntaje `X/11 (Y%)`,
    nivel heredado, las 11 respuestas en orden y con el texto real de cada pregunta;
  - reenvío manual: segundo correo, botón deshabilitado durante el envío, luego rehabilitado con
    su texto original;
  - diagnóstico profundo: 1 envío automático con los 6 puntajes por categoría, las respuestas
    profundas etiquetadas con su categoría, y reenvío propio;
  - envío fallido (502): reintenta, rehabilita el botón, no muestra éxito y deja el resultado en
    pantalla;
  - las preguntas del diagnóstico no van al backend.
- T3 — **cadena completa** (jsdom → server Astro compilado → `lambda/index.js` real con SES
  interceptado): todas las aserciones en PASS. Prueban el contrato de punta a punta:
  - `Source` desde `SES_FROM_EMAIL`, `To` = correo del usuario, `Cc` = `SES_CC_EMAIL`,
    `Reply-To` desde `SES_REPLY_TO`, asunto con la empresa;
  - la empresa `<S.A.` llega escapada y no aparece HTML crudo;
  - se renderizan las 11 respuestas y el puntaje; parte texto plano poblada;
  - el correo profundo lista las 6 categorías con `X/Y` y badge de porcentaje, y ninguno supera su
    total;
  - el reenvío manual también llega a SES.
  El harness vive fuera del repo (en el directorio temporal), no es parte del proyecto.

### Pendiente de verificación (no se puede cerrar localmente)

- **Invocación real contra la Lambda publicada.** El check de T1 pide eso y sigue pendiente: faltan
  la Function URL y los valores `SES_FROM_EMAIL` / `SES_CC_EMAIL`, que sólo el usuario puede
  configurar. Todo lo anterior se verificó con la Lambda real invocada en proceso y SES
  interceptado, lo que cubre la lógica pero **no** la identidad, el rol de IAM ni la entrega real.
- **Despliegue del backend.** `amplify.yml` sigue subiendo sólo `dist/client` (fuera de alcance por
  decisión explícita). Sin un host que sirva `dist/server`, `/api/chat` no existe en producción.

## Next step

T4: `.env.example`, sección de SES en `lambda/README.md` y `test-email.js` al contrato nuevo.
