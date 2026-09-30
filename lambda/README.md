# Lambda Backend – IteraDORA

Lambda que reemplaza el endpoint `/api/chat` para producción en AWS Amplify.

## Arquitectura

```
[Amplify Static Site]  →  [Lambda Function URL]  →  [Ollama en EC2]
   (frontend)               (este código)            (modelo llama3.2)
```

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

```powershell
# Desde la carpeta lambda/
Compress-Archive -Path index.mjs,package.json -DestinationPath iteradora-lambda.zip -Force
```

1. Ir a **AWS Console → Lambda → Create function**
2. **Runtime:** Node.js 18.x o superior
3. **Architecture:** x86_64
4. Subir `iteradora-lambda.zip`
5. En **Configuration → Environment variables:**
   - `OLLAMA_URL` = `http://ec2-XX-XX-XX-XX.compute.amazonaws.com:11434/api/chat`
   - `OLLAMA_MODEL` = `llama3.2:3b`
   - `CORS_ORIGIN` = `https://main.d2cw277bgz1az5.amplifyapp.com`
6. En **Configuration → Function URL:**
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
  --environment "Variables={OLLAMA_URL=http://IP_DE_TU_EC2:11434/api/chat,OLLAMA_MODEL=llama3.2:3b,CORS_ORIGIN=https://main.d2cw277bgz1az5.amplifyapp.com}"

# Habilitar Function URL
aws lambda create-function-url-config \
  --function-name iteradora-chat \
  --auth-type NONE

# Obtener la URL
aws lambda get-function-url-config --function-name iteradora-chat --query FunctionUrl --output text
```

## Paso 3: Conectar el frontend

En [src/scripts/chat-diagnostico.ts](../src/scripts/chat-diagnostico.ts), cambiar la línea:

```ts
const API_URL = "https://TU_LAMBDA_URL.lambda-url.us-east-1.on.aws/";
```

por la URL real de tu Lambda Function URL.

Luego hacer deploy en Amplify (automático al pushear a main).

## Probar el endpoint

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
