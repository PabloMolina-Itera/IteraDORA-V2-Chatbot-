# Lambda Backend – IteraDORA

Lambda que atiende la lógica del chatbot: las respuestas del chat y el envío de los informes DORA
por correo. **Nunca se llama desde el navegador**: el backend Astro hace de proxy.

## Arquitectura

```
[Navegador]  ──POST /api/chat──>  [Astro SSR: src/pages/api/chat.ts]  ──>  [Lambda Function URL]
                                              (proxy, server-only)              (este código)
                                                                                    │
                                                                    ┌───────────────┼───────────────┐
                                                                    ▼               ▼               ▼
                                                              [Ollama en EC2]    [Bedrock]     [AWS SES]
                                                                                   (chat)     (informes)
```

El proxy Astro y la Lambda comparten un único contrato: el body se reenvía verbatim y `action`
selecciona el comportamiento (`SEND_EMAIL` para el correo, `messages` para el chat).

## Paso 1: Levantar Ollama en EC2

```bash
# 1. Lanzar una EC2 (recomendada: g4dn.xlarge con GPU, o t3.medium sin GPU)
#    Amazon Linux 2023, 30 GB disco

# 2. Conectarse por SSH e instalar Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 3. Bajar el modelo
ollama pull llama3.2:3b

# 4. Exponer Ollama en todas las interfaces
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama

# 5. Abrir puerto 11434 en el security group de la EC2
#    (solo para la IP de la Lambda o para testing)
```

Anotá la IP pública o DNS de la EC2: `http://ec2-XX-XX-XX-XX.compute.amazonaws.com:11434/api/chat`

## Paso 2: Crear la Lambda en AWS

### Opción A — Subir el ZIP manualmente

El handler es CommonJS y hace `require("@aws-sdk/client-ses")`, así que **el ZIP tiene que
incluir `node_modules`**. Con sólo `index.js` y `package.json` la Lambda arranca y falla al
invocar.

```powershell
# Desde la carpeta lambda/
Compress-Archive -Path index.js,node_modules -DestinationPath iteradora-lambda.zip -Force
```

1. Ir a **AWS Console → Lambda → Create function**
2. **Runtime:** Node.js 18.x o superior
3. **Architecture:** x86_64
4. Handler: `index.handler`
5. Subir `iteradora-lambda.zip`
6. En **Configuration → Environment variables:**

   | Variable         | Uso                                                                     |
   | ---------------- | ----------------------------------------------------------------------- |
   | `OLLAMA_URL`     | `http://ec2-XX-XX-XX-XX.compute.amazonaws.com:11434/api/chat`            |
   | `OLLAMA_MODEL`   | `llama3.2:3b`                                                            |
   | `CORS_ORIGIN`    | Origen del sitio (sólo informativo: el proxy es server-to-server)         |
   | `AWS_REGION`     | Región de SES. Default `us-east-1`.                                      |
   | `SES_FROM_EMAIL` | **Identidad verificada en SES** que envía los informes.                   |
   | `SES_CC_EMAIL`   | Destinatario de la copia de cada informe.                                |
   | `SES_REPLY_TO`   | Opcional. `Reply-To` de los correos.                                      |

   `SES_FROM_EMAIL` y `SES_CC_EMAIL` no tienen valor por defecto: sin ellos, `SEND_EMAIL`
   devuelve `400` nombrando la variable que falta. Ver la sección de SES más abajo.
7. En **Configuration → Function URL:**
   - Habilitar **Function URL**
   - Auth type: **NONE**
   - Guardar y copiar la URL generada

### Opción B — Con AWS CLI

```bash
# Crear rol de ejecución
aws iam create-role \
  --role-name iteradora-lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy \
  --role-name iteradora-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Esperar unos segundos a que el rol se propague
sleep 10

# Crear Lambda
aws lambda create-function \
  --function-name iteradora-chat \
  --runtime nodejs20.x \
  --handler index.handler \
  --role arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/iteradora-lambda-role \
  --zip-file fileb://iteradora-lambda.zip \
  --environment "Variables={OLLAMA_URL=http://IP_DE_TU_EC2:11434/api/chat,OLLAMA_MODEL=llama3.2:3b,CORS_ORIGIN=https://main.d2cw277bgz1az5.amplifyapp.com,SES_FROM_EMAIL=remitente@dominio.com,SES_CC_EMAIL=copia@dominio.com}"

# Habilitar Function URL
aws lambda create-function-url-config \
  --function-name iteradora-chat \
  --auth-type NONE

# Obtener la URL
aws lambda get-function-url-config --function-name iteradora-chat --query FunctionUrl --output text
```

## Paso 3: Conectar el backend

La Function URL se configura **en el servidor**, nunca en el frontend. En las variables de entorno
del backend Astro (ver [`.env.example`](../.env.example)):

| Variable             | Uso                                                          |
| -------------------- | ------------------------------------------------------------ |
| `LAMBDA_FUNCTION_URL` | La Function URL copiada en el paso 2. **Sin prefijo `PUBLIC_`.** |
| `LAMBDA_TIMEOUT_MS`   | Timeout del proxy. Default `9000`.                            |

Sin `LAMBDA_FUNCTION_URL`, `/api/chat` responde `503` con un hint que nombra la variable. No hay
fallback in-process a propósito: mantener una segunda copia de la lógica en el backend fue
justamente lo que hizo que backend y Lambda divergieran.

El diagnóstico DORA y el envío de sus informes **no dependen de la Lambda**: corren 100% en el
cliente, y sólo la llamada de correo sale a la red (por el proxy, a la Lambda, a SES).

> **Pendiente de despliegue:** `amplify.yml` hoy sube sólo `dist/client`, o sea el sitio estático.
> `/api/chat` es una ruta de Astro SSR y necesita un host que sirva `dist/server` (Amplify con
> renderizado SSR, o cualquier Node). Hasta que exista ese host, el frontend desplegado no tiene
> backend: el diagnóstico funciona, pero el chat y el envío de informes no.

> **Ojo con `import.meta.env`:** Vite lo reemplaza estáticamente al compilar, así que el valor
> queda congelado en build. El proxy lee `import.meta.env` **y** `process.env`; la primera sirve
> para `astro dev`, la segunda para el server node ya construido. Si sólo leés `import.meta.env`,
> en producción la Function URL va a quedar inalcanzable aunque la variable esté definida.

## Envío de informes DORA por correo (SES)

El contrato de `SEND_EMAIL` es el mismo que usa el frontend automáticamente al completar cada
diagnóstico:

```jsonc
{
  "action": "SEND_EMAIL",
  "userData": {
    "nombre": "Ana Pérez",
    "empresa": "Acme",
    "correoCliente": "ana@acme.com",
    "tipo": "inicial",              // o "profundo"
    "nivelDora": "Intermedio",
    "puntaje": "7/11 (64%)",
    "respuestasDora": [ { "pregunta": "…", "respuesta": "Sí" } ],
    "resultadosProfundos": { "CV": "1/2 (50%)" }   // sólo si tipo = "profundo"
  }
}
```

Requisitos:

1. **Identidad verificada en SES.** `SES_FROM_EMAIL` debe ser una identidad verificada en la misma
   región. En `us-east-1` se puede verificar una dirección; para producción conviene un dominio con
   los registros DKIM/SPF/MX.
2. **Permiso IAM** `ses:SendEmail` para el rol de ejecución de la Lambda
   (`IteraDORA-Lambda-role-ig9hkk7g` en esta cuenta).
3. Las variables `SES_FROM_EMAIL` y `SES_CC_EMAIL` configuradas en la Lambda.

Errores del servicio:

| Situación                                | Status | `error`                                       |
| ---------------------------------------- | ------ | --------------------------------------------- |
| Destinatario inválido o vacío            | `400`  | el detalle del campo inválido                 |
| Falta `SES_FROM_EMAIL` / `SES_CC_EMAIL`   | `400`  | nombra la variable faltante                   |
| SES rechaza o el rol no tiene permisos    | `502`  | genérico; nunca filtra detalle de IAM         |

## Probar el envío de correo

`test-email.js` (en la raíz del repo) invoca el handler en proceso y **sí llama a SES de verdad**.
No necesita desplegar la Lambda:

```bash
SES_FROM_EMAIL=remitente@dominio.com \
SES_CC_EMAIL=copia@dominio.com \
TEST_RECIPIENT=destino@ejemplo.com \
node test-email.js
```

Imprime los tres casos: informe inicial, informe profundo y el rechazo por correo inválido.

## Probar el chat

```bash
curl -X POST https://TU_LAMBDA_URL.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Sí"}]}'
```

Deberías recibir:

```json
{"message":{"role":"assistant","content":"Excelente, sigamos evaluando.\n\nPregunta 2 de 11:\n..."}}
```

## Costos estimados

| Recurso | Costo mensual |
|---------|--------------|
| Lambda (invocaciones + tiempo) | ~$1-5 |
| EC2 t3.medium (Ollama sin GPU) | ~$30 |
| EC2 g4dn.xlarge (Ollama con GPU) | ~$370 |
| Amplify (static hosting) | $0 (free tier) |
| **Total aprox. sin GPU** | **~$31-35/mes** |
| **Total aprox. con GPU** | **~$371-375/mes** |
