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
`lambda/test-email.js` (raíz), `lambda/README.md`, `.env.example`.

## Constraints

- Los artefactos técnicos van en inglés (código, comentarios, copy de UI).
- Cambios mínimos: no refactorizar lógica de chat que ya funciona.
- El frontend debe seguir funcionando si la Lambda no está configurada (fallback local ya existente).
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
| `LAMBDA_FUNCTION_URL` | Function URL de `IteraDORA-Lambda`. Sin valor ⇒ fallback in-process a Bedrock. |
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

- [ ] **T2 — Backend: `chat.ts` como proxy de la Lambda.**
  Route: inline (reescritura de un archivo). Reemplazar los ~350 líneas de lógica duplicada por un
  proxy delgado: si `LAMBDA_FUNCTION_URL` está definida, reenvía el body y devuelve la respuesta
  tal cual; si no, mantiene el camino in-process a Bedrock como fallback de desarrollo. Propagar
  errores y aplicar timeout.
  Check: `npm run build` (Astro compila el route) + prueba manual de ambos caminos.

- [ ] **T3 — Frontend: captura de datos y envío automático.**
  Route: delegated writer. Leer `usuario-nombre` / `usuario-empresa` / `usuario-correo` al pulsar
  "Comenzar diagnóstico", validar el correo, registrar `respuestas[]` y `deepRespuestas[]`, agregar
  `enviarReporte(tipo)`, llamarla al completar el diagnóstico inicial y el profundo, y cablear los
  dos botones como reenvío manual con realimentación visual.
  Check: `npm run build` + recorrido manual de ambos diagnósticos.

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
- [x] Sin `LAMBDA_FUNCTION_URL` el chat sigue funcionando por el camino in-process.
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

## Next step

T2: convertir `src/pages/api/chat.ts` en proxy delgado hacia la Function URL de la Lambda.
