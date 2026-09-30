// Importar la función handler usando sintaxis ES Modules
import { handler } from './lambda/index.js';

async function probarEnvio() {
  console.log("Iniciando prueba de envío de correo...");

  const fakeEvent = {
    httpMethod: "POST",
    body: JSON.stringify({
      action: "SEND_EMAIL",
      userData: {
        nombre: "Usuario de Prueba",
        empresa: "Empresa Demo",
        correoCliente: "TU_CORREO_DE_PRUEBA@dominio.com", // <-- Tu correo para recibir la prueba
        nivelDora: "Avanzado",
        respuestasDora: {
          frecuenciaDespliegue: "Múltiples veces al día",
          leadTime: "Menos de una hora",
          mttr: "Menos de una hora",
          tasaFallos: "0-15%"
        }
      }
    })
  };

  try {
    const respuesta = await handler(fakeEvent);
    console.log("Respuesta recibida de la Lambda:");
    console.log(respuesta);
  } catch (error) {
    console.error("Error al ejecutar el test:", error);
  }
}

probarEnvio();