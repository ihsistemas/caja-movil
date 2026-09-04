// ============================================================================
// SOLO PARA PRUEBAS - version simulada de carrito_compartido.js, usando
// localStorage + BroadcastChannel en vez de Firestore real.
// ============================================================================

const _canalSimulado = new BroadcastChannel('carrito_compartido_simulado_v3');
const _listeners = {};
let _contadorId = 0;

function inicializarFirebase() {}
function conectarAEmulador() {}

function _leerCarritos(clienteId) {
  const raw = localStorage.getItem('caja_sim_' + clienteId);
  return raw ? JSON.parse(raw) : [];
}
function _escribirCarritos(clienteId, carritos) {
  localStorage.setItem('caja_sim_' + clienteId, JSON.stringify(carritos));
  _canalSimulado.postMessage({ clienteId });
}

async function asegurarCajaDelNegocio(clienteId) {
  if (localStorage.getItem('caja_meta_sim_' + clienteId) === null) {
    localStorage.setItem('caja_meta_sim_' + clienteId, JSON.stringify({ cliente_id: clienteId }));
    _escribirCarritos(clienteId, []);
  }
}

function escucharCarritosEntrantes(clienteId, callback, errorCallback) {
  dejarDeEscuchar();
  const emitir = () => {
    const pendientes = _leerCarritos(clienteId).filter((c) => c.estado === 'pendiente');
    pendientes.sort((a, b) => b.fecha_envio - a.fecha_envio);
    callback(pendientes);
  };
  emitir();
  const handler = (evento) => { if (evento.data.clienteId === clienteId) emitir(); };
  _canalSimulado.addEventListener('message', handler);
  _listeners.actual = handler;
  _listeners.clienteEscuchado = clienteId;
  _listeners.emitir = emitir;
  return handler;
}

async function marcarCarritoProcesado(clienteId, idCarrito) {
  const carritos = _leerCarritos(clienteId);
  const actualizado = carritos.map((c) => c.id === idCarrito ? { ...c, estado: 'procesado' } : c);
  _escribirCarritos(clienteId, actualizado);
  if (_listeners.clienteEscuchado === clienteId) _listeners.emitir();
}

function dejarDeEscuchar() {
  if (_listeners.actual) {
    _canalSimulado.removeEventListener('message', _listeners.actual);
    _listeners.actual = null;
  }
}

async function enviarCarritoACaja(clienteId, items, total, nombreEquipo) {
  await asegurarCajaDelNegocio(clienteId);
  const carritos = _leerCarritos(clienteId);
  carritos.push({
    id: 'carrito-' + (_contadorId++) + '-' + Date.now(),
    items, total, enviado_por: nombreEquipo, fecha_envio: Date.now(), estado: 'pendiente',
  });
  _escribirCarritos(clienteId, carritos);
  if (_listeners.clienteEscuchado === clienteId) _listeners.emitir();
}

// ============================================================================
// USUARIOS SIMULADOS - misma logica: viven en un "servidor" simulado
// (localStorage), un canal simulado avisa a otras pestañas de los cambios.
// ============================================================================

let _cacheUsuariosSim = null;
let _contadorUsuarioId = 0;

function _leerUsuariosNegocio(clienteId) {
  const raw = localStorage.getItem('usuarios_negocio_sim_' + clienteId);
  return raw ? JSON.parse(raw) : [];
}
function _escribirUsuariosNegocio(clienteId, usuarios) {
  localStorage.setItem('usuarios_negocio_sim_' + clienteId, JSON.stringify(usuarios));
  _canalSimulado.postMessage({ usuariosDeCliente: clienteId });
}

function iniciarEscuchaUsuarios(clienteId, alListo) {
  _cacheUsuariosSim = _leerUsuariosNegocio(clienteId);
  const handler = (evento) => {
    if (evento.data.usuariosDeCliente === clienteId) _cacheUsuariosSim = _leerUsuariosNegocio(clienteId);
  };
  _canalSimulado.addEventListener('message', handler);
  if (alListo) alListo();
}

function listarUsuariosRemoto() {
  if (_cacheUsuariosSim === null) return [];
  return _cacheUsuariosSim.filter((u) => u.activo !== false);
}
function escuchaUsuariosActiva() {
  return _cacheUsuariosSim !== null;
}

async function buscarUsuarioPorNombre(clienteId, nombre) {
  const usuarios = _leerUsuariosNegocio(clienteId);
  const encontrado = usuarios.find((u) => u.nombre === nombre && u.activo !== false);
  return encontrado || null;
}

async function crearUsuarioRemoto(clienteId, datos) {
  const usuarios = _leerUsuariosNegocio(clienteId);
  const id = 'usuario-sim-' + (_contadorUsuarioId++);
  usuarios.push({ id, ...datos, activo: true });
  _escribirUsuariosNegocio(clienteId, usuarios);
  _cacheUsuariosSim = usuarios; // se actualiza sola de inmediato, no solo por el canal
  return id;
}

async function editarUsuarioRemoto(clienteId, usuarioId, cambios) {
  const usuarios = _leerUsuariosNegocio(clienteId);
  const actualizado = usuarios.map((u) => u.id === usuarioId ? { ...u, ...cambios } : u);
  _escribirUsuariosNegocio(clienteId, actualizado);
  _cacheUsuariosSim = actualizado;
}

// ============================================================================
// SEÑAL DE CIERRE DEL MAESTRO - version simulada
// ============================================================================

let _listenerCierreMaestro = null;

async function avisarCierreDeSesionMaestro(clienteId) {
  localStorage.setItem('cierre_maestro_sim_' + clienteId, String(Date.now()));
  _canalSimulado.postMessage({ cierreMaestroDeCliente: clienteId });
}

function escucharCierreDeSesionMaestro(clienteId, callback) {
  dejarDeEscucharCierreMaestro();
  const handler = (evento) => {
    if (evento.data.cierreMaestroDeCliente === clienteId) callback();
  };
  _canalSimulado.addEventListener('message', handler);
  _listenerCierreMaestro = handler;
}
function dejarDeEscucharCierreMaestro() {
  if (_listenerCierreMaestro) {
    _canalSimulado.removeEventListener('message', _listenerCierreMaestro);
    _listenerCierreMaestro = null;
  }
}

// ============================================================================
// LICENCIA REAL SIMULADA - misma interfaz que la version real, para probar
// el flujo basico. OJO: aca "hora del servidor" es solo Date.now() (no hay
// forma de simular de verdad la resistencia a atrasar el reloj del
// dispositivo sin un servidor real de por medio - eso solo se puede
// confirmar con Firebase real).
// ============================================================================

async function horaServidorActual() {
  return new Date();
}

function generarClienteId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = 'CLI-';
  for (let i = 0; i < 10; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}

async function crearClienteRemoto({ nombre, capacidad, capacidadUsuarios, tipoLicencia, diasPrueba }) {
  const clienteId = generarClienteId();
  const tipo = tipoLicencia === 'trial' ? 'trial' : 'permanente';
  let vence = null;
  if (tipo === 'trial') {
    const fechaVence = new Date();
    fechaVence.setDate(fechaVence.getDate() + (Number(diasPrueba) || 15));
    vence = fechaVence.toISOString().slice(0, 10);
  }
  const cliente = {
    cliente_id: clienteId, nombre, capacidad: capacidad || 2, capacidad_usuarios: capacidadUsuarios || 6,
    tipo_licencia: tipo, vence,
  };
  localStorage.setItem('cliente_sim_' + clienteId, JSON.stringify(cliente));
  return cliente;
}

async function obtenerClienteRemoto(clienteId) {
  const raw = localStorage.getItem('cliente_sim_' + (clienteId || '').trim().toUpperCase());
  if (!raw) return [null, 'Ese código de cliente no existe.'];
  const cliente = JSON.parse(raw);
  if (cliente.tipo_licencia === 'trial' && cliente.vence) {
    const hoy = (await horaServidorActual()).toISOString().slice(0, 10);
    if (hoy > cliente.vence) return [null, `La prueba venció el ${cliente.vence}`];
  }
  return [cliente, 'OK'];
}

async function editarClienteRemoto(clienteId, cambios) {
  const raw = localStorage.getItem('cliente_sim_' + clienteId);
  const actual = raw ? JSON.parse(raw) : {};
  localStorage.setItem('cliente_sim_' + clienteId, JSON.stringify({ ...actual, ...cambios }));
}

// ============================================================================
// USO DIARIO SIMULADO
// ============================================================================

function incrementarUsoDiario(clienteId, tipo) {
  const fecha = new Date().toISOString().slice(0, 10);
  const clave = 'uso_sim_' + clienteId + '_' + fecha;
  const actual = JSON.parse(localStorage.getItem(clave) || '{"operaciones":0,"por_tipo":{}}');
  actual.operaciones = (actual.operaciones || 0) + 1;
  actual.por_tipo[tipo] = (actual.por_tipo[tipo] || 0) + 1;
  localStorage.setItem(clave, JSON.stringify(actual));
}

async function obtenerUsoDeHoy(clienteId) {
  const fecha = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem('uso_sim_' + clienteId + '_' + fecha);
  return raw ? JSON.parse(raw) : { operaciones: 0 };
}

async function obtenerUsoUltimosDias(clienteId, nDias) {
  const dias = [];
  for (let i = 0; i < nDias; i++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    const fechaTexto = fecha.toISOString().slice(0, 10);
    const raw = localStorage.getItem('uso_sim_' + clienteId + '_' + fechaTexto);
    dias.push({ fecha: fechaTexto, operaciones: raw ? (JSON.parse(raw).operaciones || 0) : 0 });
  }
  return dias;
}

// ============================================================================
// LOGIN DE NACHO SIMULADO - para probar el flujo (mostrar/ocultar pantalla,
// validaciones), no reemplaza confirmar el login real con Firebase.
// ============================================================================

let _sesionNachoSimulada = null;
let _listenersSesionNacho = [];

async function iniciarSesionNacho(correo, clave) {
  if (clave.length < 4) return [false, 'Correo o clave incorrectos.'];
  _sesionNachoSimulada = { email: correo };
  _listenersSesionNacho.forEach((cb) => cb(_sesionNachoSimulada));
  return [true, 'OK'];
}
async function cerrarSesionNacho() {
  _sesionNachoSimulada = null;
  _listenersSesionNacho.forEach((cb) => cb(null));
}
function escucharSesionNacho(callback) {
  _listenersSesionNacho.push(callback);
  callback(_sesionNachoSimulada);
}

// ============================================================================
// BIBLIOTECA DE PRODUCTOS SIMULADA
// ============================================================================

async function buscarEnBiblioteca(codigoBarra) {
  if (!codigoBarra) return null;
  const raw = localStorage.getItem('biblioteca_sim_' + codigoBarra);
  return raw ? { codigo_barra: codigoBarra, ...JSON.parse(raw) } : null;
}

async function proponerProductoNuevo(clienteId, { codigoBarra, nombre, imagenData }) {
  const clave = 'biblioteca_pendiente_sim_' + clienteId;
  const lista = JSON.parse(localStorage.getItem(clave) || '[]');
  lista.push({
    id: 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    codigo_barra: codigoBarra, nombre, imagen_data: imagenData || null,
    fecha_propuesto: Date.now(), estado: 'pendiente',
  });
  localStorage.setItem(clave, JSON.stringify(lista));
}
