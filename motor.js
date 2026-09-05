// SYNC: esta logica debe ser IDENTICA en las 3 copias de este motor —
// caja_movil/motor.js, app_soporte/motor.js, y minimarket_pro/frontend/src/lib/motorEquipos.js.
// Para confirmar que no se desincronizaron, comparalas con diff (ignorando este
// encabezado y, en la copia de minimarket_pro, el bloque final de "export {...}",
// que solo existe ahi porque esa copia es un modulo ES).
//
// NOTA (4-sep-2026): la copia de Caja Movil dejo de estar sincronizada a
// proposito en la seccion de equipos/invitaciones - esa parte se movio a
// carrito_compartido.js porque ahora usa Firestore directo (ver
// DISENO_MULTIDISPOSITIVO.md). Las copias de app_soporte y minimarket_pro
// todavia tienen el sistema viejo firmado con HMAC, pendiente de unificar
// cuando se retome la Fase 5 (backend Python del PC).
// ============================================================================
// App Maestra IH Sistemas - motor de clientes y equipos.
// ============================================================================

// ---- Identidad de ESTE dispositivo (celular/PC) - random, generado una vez,
// persistido localmente. ----
function getDeviceId() {
  let id = localStorage.getItem("ih_device_id");
  if (!id) {
    id = "EQ-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    localStorage.setItem("ih_device_id", id);
  }
  return id;
}

// ---- Estado local: a que cliente pertenece ESTE equipo, y con que rol ----
function cargarEstadoEquipo() {
  try { return JSON.parse(localStorage.getItem("ih_estado_equipo") || "null"); }
  catch (e) { return null; }
}
function guardarEstadoEquipo(estado) {
  localStorage.setItem("ih_estado_equipo", JSON.stringify(estado));
}

// Se llama cada vez que se ABRE la app (no solo al activar) - asi una prueba
// que vence MIENTRAS el programa esta cerrado tambien se bloquea la proxima
// vez que se abra, sin depender de que nadie este mirando en el momento
// exacto del vencimiento.
// Chequeo LOCAL rapido (sin red) usado solo para la primera pintada de
// pantalla, antes de que la revision contra el servidor (mas lenta, de
// verdad confiable) termine. No es la fuente de verdad - esa es
// obtenerClienteRemoto en carrito_compartido.js.
function licenciaVencida(cliente) {
  if (!cliente || cliente.tipo_licencia !== "trial") return false;
  if (!cliente.vence) return false;
  const hoy = new Date().toISOString().slice(0, 10);
  return hoy > cliente.vence;
}

function estadoEquipoVigente() {
  const estado = cargarEstadoEquipo();
  if (!estado) return { vigente: false, motivo: "sin_activar" };
  if (licenciaVencida(estado)) return { vigente: false, motivo: "vencida", estado };
  return { vigente: true, estado };
}
