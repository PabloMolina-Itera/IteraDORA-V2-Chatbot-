// Prueba manual del envío de correo (invoca el handler en proceso, sin desplegar la Lambda).
//
//   node test-email.js
//
// Requiere las variables de entorno de SES. El destinatario se puede sobreescribir desde el
// propio entorno, sin tocar este archivo:
//
//   SES_FROM_EMAIL=remitente@iteraprocess.com
//   SES_CC_EMAIL=copia@iteraprocess.com
//   SES_REPLY_TO=respuestas@iteraprocess.com
//   TEST_RECIPIENT=destino@ejemplo.com
//
// Este script SÍ llama a AWS SES de verdad. Para probar la lógica sin red, interceptá el módulo
// @aws-sdk/client-ses (ver los harness de verificación en el documento de la feature).
import { handler } from './lambda/index.js';

const CORREO_PRUEBA = process.env.TEST_RECIPIENT || process.env.SES_CC_EMAIL;

if (!CORREO_PRUEBA) {
  console.error('Falta definir a quién enviar la prueba. Configurá TEST_RECIPIENT o SES_CC_EMAIL.');
  process.exit(1);
}

for (const [variable, descripcion] of [
  ['SES_FROM_EMAIL', 'identidad verificada en SES (remitente)'],
  ['SES_CC_EMAIL', 'destinatario de la copia'],
]) {
  if (!process.env[variable]) {
    console.error(`Falta ${variable} — ${descripcion}.`);
    process.exit(1);
  }
}

const PREGUNTAS_INICIAL = [
  '¿Usan control de versiones para el código fuente?',
  '¿Cuánto tarda el cambio crítico en llegar a producción?',
  '¿Cuánto tarda restaurar un servicio caído?',
  '¿Con qué frecuencia cambian el software o la configuración?',
  '¿Cuánto tiempo tarda un cambio en esperar su aprobación?',
  '¿Tienen procesos documentados de gestión de cambios?',
  '¿Existe una forma de conocer el estado de los servicios en producción?',
  '¿Cuánto rápido detectan un problema?',
  '¿Tienen una forma probada de revertir un cambio?',
  '¿Se prueban los cambios antes de llegar a producción?',
  '¿Tienen información de eventos para responding rápido?',
];

async function invocar(userData, titulo) {
  console.log(`\n=== ${titulo} ===`);
  const respuesta = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'SEND_EMAIL', userData }),
  });
  console.log('status:', respuesta.statusCode);
  console.log('body:  ', respuesta.body);
  return respuesta.statusCode === 200;
}

const comun = {
  nombre: 'Usuario de Prueba',
  empresa: 'Empresa Demo',
  correoCliente: CORREO_PRUEBA,
  nivelDora: 'Intermedio',
};

let ok = true;

// Informe inicial: puntaje + las 11 respuestas que el frontend registra.
ok &= await invocar(
  {
    ...comun,
    tipo: 'inicial',
    puntaje: '7/11 (64%)',
    respuestasDora: PREGUNTAS_INICIAL.map((pregunta, i) => ({
      pregunta,
      respuesta: i % 3 === 0 ? 'No' : 'Sí',
    })),
  },
  'Informe del diagnóstico inicial'
);

// Informe profundo: agrega los puntajes por categoría.
ok &= await invocar(
  {
    ...comun,
    tipo: 'profundo',
    puntaje: '14/23 (61%)',
    respuestasDora: PREGUNTAS_INICIAL.map((pregunta, i) => ({
      pregunta,
      respuesta: i % 3 === 0 ? 'No' : 'Sí',
    })),
    resultadosProfundos: {
      CV: '1/2 (50%)',
      BD: '2/3 (67%)',
      EC: '3/4 (75%)',
      AP: '3/4 (75%)',
      IS: '5/7 (71%)',
      IC: '0/3 (0%)',
    },
  },
  'Informe del diagnóstico profundo'
);

// Camino de rechazo: debe fallar con 400 y NO llamar a SES.
console.log('\n=== Rechazo por correo inválido (se espera 400) ===');
const rechazo = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ action: 'SEND_EMAIL', userData: { ...comun, correoCliente: 'no-es-un-correo' } }),
});
console.log('status:', rechazo.statusCode);
console.log('body:  ', rechazo.body);

ok &= rechazo.statusCode === 400 && /inválido/i.test(rechazo.body);

console.log(ok ? '\nTodo OK.' : '\nAlguna invocación falló. Revisá el error de arriba.');
process.exit(ok ? 0 : 1);
