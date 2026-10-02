# Lambda Backend – IteraDORA

Lambda que atiende la lógica del chatbot: las respuestas del chat y el envío de los informes DORA
por correo. **Nunca se llama desde el navegador**: el backend Astro hace de proxy.

## Arquitectura

```
[Navegador]  ──POST /api/chat──>  [Astro SSR: src/pages/api/chat.ts]  ──>  [Lambda Function URL]
                                              (proxy, server-only)              (este código)
                                              + firma SigV4 (service=lambda)             │
                                                                     ┌───────────────┼───────────────┐
                                                                     ▼               ▼               ▼
                                                               [Ollama en EC2]    [Bedrock]     [AWS SES]
                                                                                    (chat)     (informes)
```

El proxy Astro y la Lambda comparten un único contrato: el body se reenvía verbatim y `action`
selecciona el comportamiento (`SEND_EMAIL` para el correo, `messages` para el chat).

El proxy además **firma cada invocación con SigV4** (`service: "lambda"`), porque la Function URL
debe quedar en `Auth type: AWS_IAM`. Sin esa firma AWS rechaza la invocación con `403`; con ella,
la Function URL deja de ser un endpoint público. Ver
[Autenticación de la Function URL](#autenticación-de-la-function-url-obligatorio).

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
   - Auth type: **AWS_IAM** (obligatorio: ver
     [Autenticación de la Function URL](#autenticación-de-la-function-url-obligatorio))
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

# Habilitar Function URL (AWS_IAM: la URL sólo acepta invocaciones firmadas)
aws lambda create-function-url-config \
  --function-name iteradora-chat \
  --auth-type AWS_IAM

# Permiso que necesita la identidad que firma las invocaciones (el backend Astro).
aws lambda add-permission \
  --function-name iteradora-chat \
  --statement-id iteradora-proxy-invoke-url \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --source-arn arn:aws:iam::<cuenta-del-backend>:role/<rol-del-backend>

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
| `AWS_REGION`          | Región de la Function URL. Default `us-east-1`.              |
| `AWS_ACCESS_KEY_ID`   | Credencial para firmar. Opcional si hay rol IAM.              |
| `AWS_SECRET_ACCESS_KEY` | Credencial para firmar. Opcional si hay rol IAM.            |
| `AWS_SESSION_TOKEN`   | Sólo para credenciales temporales.                            |

Sin `LAMBDA_FUNCTION_URL`, `/api/chat` responde `503` con un hint que nombra la variable. No hay
fallback in-process a propósito: mantener una segunda copia de la lógica en el backend fue
justamente lo que hizo que backend y Lambda divergieran.

Las variables de firma son **server-only y sin prefijo `PUBLIC_`**. Si `AWS_ACCESS_KEY_ID` y
`AWS_SECRET_ACCESS_KEY` están definidas, se usan directamente. Si no, el proxy recurre a la cadena
de proveedores por defecto de AWS (variables de entorno → SSO → web identity → `~/.aws/*.ini` →
ECS/EC2 Instance Metadata), que es lo que hace que funcione un backend en contenedor con un rol IAM
de instancia y sin claves en el entorno.

Si no se pueden resolver credenciales, `/api/chat` responde `503` y **no envía ninguna petición** a
la Lambda. No hay fallback sin firma a propósito: exactamente eso es lo que expondría de nuevo el
presupuesto de Bedrock y la identidad de SES.

> **Las credenciales se leen sólo de `process.env`**, a diferencia de `LAMBDA_FUNCTION_URL` y
> `LAMBDA_TIMEOUT_MS`. Es deliberado: Vite congela `import.meta.env` dentro del bundle de build, así
> que leer una clave de AWS por ahí la escribiría en el artefacto desplegado. Para `AWS_REGION` la
> diferencia es inocua (tiene default); para las credenciales no.

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

## Autenticación de la Function URL (obligatorio)

El proxy firma cada invocación con SigV4 (`service: "lambda"`, `region: AWS_REGION`). Eso sólo
sirve si la Function URL está configurada para **verificar** la firma. Con `Auth type: NONE` AWS
**ignora** el header `Authorization`: la URL sigue siendo pública, cualquiera con el enlace puede
consumir Bedrock y enviar correo desde la identidad de SES, y el código de la Lambda se ejecuta
igual.

Hay que cambiar el Auth type a **AWS_IAM**:

```bash
aws lambda update-function-url-config \
  --function-name <NOMBRE_DE_TU_LAMBDA> \
  --auth-type AWS_IAM
```

o en la consola: **Lambda → tu función → Configuration → Function URL → Auth type: AWS_IAM**.

Con `AWS_IAM`:

| Request                                   | Resultado                                        |
| ----------------------------------------- | ------------------------------------------------ |
| Sin `Authorization`                       | `403` `Missing AuthenticationToken` / `ForbiddenMessage` |
| Firma con credenciales sin permiso IAM    | `403` `AccessDeniedException`                    |
| Firma con credenciales con permiso IAM    | ejecuta la Lambda                                |

El permiso que necesita la identidad que firma es `lambda:InvokeFunctionUrl` sobre esa función. Si
el backend corre en un rol de instancia/ECR, se agrega como política del rol:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "arn:aws:lambda:<region>:<cuenta>:function:<NOMBRE_DE_TU_LAMBDA>"
    }
  ]
}
```

Verificación después del cambio: un `curl` sin firma tiene que devolver `403`. Si devuelve `400` o
`200`, el Auth type todavía está en `NONE`.

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

Con la Function URL en `AWS_IAM` ya no se puede probar con `curl` pelado: sin firma devuelve `403`.
Hay que ir por el proxy, que es quien firma:

```bash
curl -X POST http://localhost:4321/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Sí"}]}'
```

Si se necesita probar la Lambda directamente, hay que firmarla:

```bash
aws lambda invoke \
  --function-name <NOMBRE_DE_TU_LAMBDA> \
  --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload fileb://<(printf '{"messages":[{"role":"user","content":"Sí"}]}') \
  out.json && cat out.json
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
