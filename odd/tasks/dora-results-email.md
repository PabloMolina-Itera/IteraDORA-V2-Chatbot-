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

- [x] **T4 — Configuración y documentación.**
  Route: inline. `.env.example` con las variables del backend (ya entregado en T2), sección de SES
  en `lambda/README.md` y actualización de `test-email.js` al contrato nuevo.
  Check: lectura de los archivos.

  **Correcciones que aparecieron al documentar** (eran documentación que iba a romper el
  deploy o el contrato):
  - el README empaquetaba `index.mjs`, pero el archivo es `index.js`;
  - el ZIP no incluía `node_modules`, y el handler usa `require`: la Lambda habría arrancado y
    fallado al invocar;
  - el "Paso 3" seguía instructing a poner la Function URL en `chat-diagnostico.ts`, que es
    justamente el antipatrón eliminado en T2 (Function URL expuesta al navegador);
  - `test-email.js` usaba el contrato viejo (sin `tipo`, sin `respuestasDora` como array, sin
    `resultadosProfundos`).

  Además, un defecto de contrato detectado al probar el script: un destinatario inválido
  devolvía `502 "intenta más tarde"`. Reintentar nunca lo arregla y manda al usuario a perder
  tiempo; ahora devuelve `400` con el detalle, y el `502` queda reservado para fallos de SES o de
  permisos.

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

- **T4 — done.** `test-email.js` reescrito al contrato nuevo: lee el destinatario y las variables
  desde el entorno (sin editar el archivo), manda los tres casos (inicial, profundo, rechazo) y
  sale con código distinto de 0 si algo falla. `lambda/README.md` actualizado con la arquitectura
  real, el contenido correcto del ZIP, las variables de SES, la tabla de errores de `SEND_EMAIL`, el
  contrato en JSON, cómo probarlo y el requisito de desplegar el backend SSR.
- **T4 — además**, `lambda/index.js` devuelve `400` (no `502`) cuando el destinatario es inválido.

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
- T4 — `node --check lambda/index.js` y `node --check test-email.js` → exit 0.
- T4 — `test-email.js` ejecutado con SES interceptado contra el handler real (todas PASS): el
  archivo manda 2 correos válidos y el inválido no llega a SES; asunto inicial y asunto profundo
  correctos; `To` = `TEST_RECIPIENT`; el cuerpo trae empresa, puntaje, preguntas y los porcentajes
  por categoría; el script sale con código 0.
- T4 — regresión sobre el harness de T1 tras cambiar la clasificación del error: sigue en verde.

### Pendiente de verificación (no se puede cerrar localmente)

- **Invocación real contra la Lambda publicada.** El check de T1 pide eso y sigue pendiente: faltan
  la Function URL y los valores `SES_FROM_EMAIL` / `SES_CC_EMAIL`, que sólo el usuario puede
  configurar. Todo lo anterior se verificó con la Lambda real invocada en proceso y SES
  interceptado, lo que cubre la lógica pero **no** la identidad, el rol de IAM ni la entrega real.
- **Despliegue del backend.** `amplify.yml` sigue subiendo sólo `dist/client` (fuera de alcance por
  decisión explícita). Sin un host que sirva `dist/server`, `/api/chat` no existe en producción.

## T5 — Firma SigV4 en el proxy (cierre de la exposición de la Function URL)

### Problema

Una sonda real contra la Function URL publicada (`POST {}` con cuerpo JSON válido) devolvió
`400 {"error":"El body debe incluir { messages: [...] }"}`, que es el mensaje de nuestra propia
Lambda. Eso prueba que **la Function URL tiene Auth=NONE y ejecuta código sin autenticación**.

Consecuencias, ambas alcanzables por cualquiera que conozca la URL:

- gasto de Bedrock ajeno, a costa del proyecto;
- **envío de correo desde la identidad SES verificada**, es decir suplantación de un remitente
  verificado con la reputación de IteraDORA detrás.

El comentario del propio proxy (líneas 8-10 de `src/pages/api/chat.ts`) ya anticipaba que sin
esta capa habría que exponer la Function URL con Auth=NONE. Faltaba activar el otro lado.

### Alcance

- Firmar con SigV4 la invocación del proxy a la Lambda, servicio `lambda`, región `AWS_REGION`
  (default `us-east-1`).
- Credenciales server-only: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
  opcional. Resolver por `fromEnv()` cuando estén presentes y por el provider por defecto en
  caso contrario, para permitir rol de instancia en deployments con IAM.
- **Fallar cerrado**: si no se pueden resolver credenciales, `503` con hint accionable. Nunca
  enviar una petición sin firmar; un fallback "sin firmar si no hay credenciales" reintroduciría
  exactamente la exposición que esta tarea cierra.
- Documentar las variables nuevas y el cambio de tipo de auth en `lambda/README.md`.

### Fuera de alcance

- Cambiar el tipo de auth de la Function URL en AWS: eso lo hace el usuario en la consola.
- IAM: la política que permite `lambda:InvokeFunctionUrl` la agrega el usuario.

### Criterios de aceptación

1. La petición saliente a la Lambda incluye `Authorization: AWS4-HMAC-SHA256 ...` con el scope de
   credencial correcto, y `x-amz-date`.
2. Sin credenciales resolubles, el proxy devuelve `503` y **no** emite ninguna petición.
3. El body firmado y el body enviado son el mismo string, byte a byte.
4. `npx tsc --noEmit` y `npm run build` siguen en verde.
5. El harness de proxy existente sigue verde: la ruta sin firmar no cambia.

### Verificación prevista

- Harness fuera del repo: `LAMBDA_FUNCTION_URL` real + credenciales ficticias. La Lambda pública
  responde `400` a una petición sin firmar (Auth=NONE) y `403 InvalidSignature` a la firmada con
  credenciales falsas. Esa diferencia es la prueba de que la firma se emite y de que AWS la valida.
- Estructura de la firma: prefijo `AWS4-HMAC-SHA256`, `Credential=.../us-east-1/lambda/aws4_request`
  y `SignedHeaders` incluyendo `content-type` y `host`.

### Evidencia de verificación — T5 (commit 3d4fd1e)

**Estado: cerrado del lado cliente. La exposición sigue abierta hasta cambiar el auth en AWS.**

- `npx tsc --noEmit -p tsconfig.json` → `EXIT=0`, sin salida.
- `npm run build` → `EXIT=0`, "Server built in 3.10s / Complete!".
- Harness propio del writer: 44 pass / 0 fail. Harness de proxy preexistente de T3/T4: 24/24 PASS.
- Firma emitida con estructura correcta:
  `AWS4-HMAC-SHA256 Credential=.../20261002/us-east-1/lambda/aws4_request`,
  `SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date[;x-amz-security-token]`,
  y `x-amz-content-sha256` igual al `sha256(body)` byte a byte.
- Fail closed verificado: sin credenciales resolubles devuelve `503` y emite **cero** peticiones
  upstream, en 426 ms (timeout de IMDS acotado a 1 s).

**La predicción anterior era incorrecta y quedó corregida.** Se esperaba `403 InvalidSignature` en
la petición firmada. No ocurre, y la causa no es que la firma falte: es que **`AuthType=NONE` no
valida SigV4 en absoluto**. Se comprobó con tres sondas independientes contra la URL real:

| Sonda | Respuesta |
| --- | --- |
| `POST {}` sin firmar | `400 {"error":"El body debe incluir { messages: [...] }"}` |
| `POST {}` firmado con credenciales falsas | `400`, respuesta idéntica |
| `POST {}` firmado con los 64 bytes de firma en cero | `400`, respuesta idéntica |

Una firma deliberadamente corrupta que AWS validara daría `403`. Que sea idéntica a la petición
sin firmar prueba que la verificación no ocurre: la Lambda se ejecuta siempre. El proxy emite la
firma correctamente, pero hoy nadie la verifica.

**Consecuencia operativa, y es lo que importa:** el trabajo de cliente está listo, pero **cambiar
el tipo de auth a `AWS_IAM` es lo que cierra el agujero**, y sigue pendiente. Mientras tanto la
Function URL continúa siendo invocable por cualquiera.

**Desvío del brief, aceptado con motivo:** `fromEnv()` no existe en
`@aws-sdk/credential-provider-node@3.972` (sólo exporta `defaultProvider`); se leen
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` de `process.env`
directamente. Confiar en el brief habría roto `tsc`.

**Desvío del patrón de lectura de env, aceptado con motivo:** credenciales y `AWS_REGION` se leen
sólo de `process.env`, no de `import.meta.env`. Vite congela `import.meta.env` dentro del bundle,
así que leer una clave por ahí la escribiría en el artefacto desplegado. `LAMBDA_FUNCTION_URL` y
`LAMBDA_TIMEOUT_MS` conservan el patrón dual.

**Pendiente detectado en revisión, no corregido:** `new URL(LAMBDA_FUNCTION_URL)` quedó fuera del
`try` en `forwardToLambda`, así que una URL malformada produciría una excepción no manejada en vez
de un error limpio. Es una regresión de robustez menor respecto de la versión anterior, que sí
tenía el `fetch` dentro del `try`.

### Modo TDD y checks

El proyecto no tiene runner de tests (`package.json` no define script `test`), así que TDD estricto
no está disponible. Los checks son los mismos del patrón ya usado en T1-T4: `node --check`,
`tsc --noEmit`, `npm run build` y harnesses de comportamiento en el directorio temporal.

### Route declaration

- **Delegated writer** (1 escritor). Dispara el writer trigger: toca `src/pages/api/chat.ts`,
  `package.json`, `package-lock.json` y `lambda/README.md` — 3 archivos no triviales más lockfile.
- API de firma verificada contra la documentación oficial de `@aws-sdk/signature-v4` antes de
  escribir: constructor `{ service, region, credentials, sha256 }` y `sign(toSign: HttpRequest)`.

## Next step

1. **Usuario, y es lo que cierra el agujero:** cambiar el tipo de auth de la Function URL a
   `AWS_IAM` en la consola. Hasta que eso pase, la firma que emite el proxy no la verifica nadie y
   la URL sigue siendo invocable por cualquiera.
2. **Usuario:** subir el ZIP con el código nuevo (la Lambda publicada corre el código viejo, sin
   soporte `SEND_EMAIL`) y setear `SES_FROM_EMAIL` y `SES_CC_EMAIL`. No setear `AWS_REGION`: la
   Lambda ya está en `us-east-1`.
3. Confirmar que el rol de la Lambda tenga `lambda:InvokeFunctionUrl`, necesario para que una
   Function URL con `AWS_IAM` pueda invocarse.
4. Decidir dónde se despliega el backend SSR para que `/api/chat` exista en producción
   (`amplify.yml` sigue subiendo sólo `dist/client`).
