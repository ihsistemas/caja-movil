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

// ============================================================================
// PRODUCTOS Y STOCK SIMULADOS
// ============================================================================

let _cacheProductosSim = null;
let _contadorProductoId = 0;
let _listenersProductos = [];

function _leerProductosNegocio(clienteId) {
  const raw = localStorage.getItem('productos_sim_' + clienteId);
  return raw ? JSON.parse(raw) : [];
}
function _escribirProductosNegocio(clienteId, productos) {
  localStorage.setItem('productos_sim_' + clienteId, JSON.stringify(productos));
  _cacheProductosSim = productos;
  _listenersProductos.forEach((cb) => cb());
}

function iniciarEscuchaProductos(clienteId, alActualizar) {
  _cacheProductosSim = _leerProductosNegocio(clienteId);
  if (alActualizar) _listenersProductos.push(alActualizar);
  const handler = (evento) => {
    if (evento.data.productosDeCliente === clienteId) {
      _cacheProductosSim = _leerProductosNegocio(clienteId);
      if (alActualizar) alActualizar();
    }
  };
  _canalSimulado.addEventListener('message', handler);
  if (alActualizar) alActualizar();
}
function listarProductosRemoto(incluirPausados) {
  if (_cacheProductosSim === null) return [];
  return incluirPausados ? _cacheProductosSim : _cacheProductosSim.filter((p) => p.activo !== false);
}
function escuchaProductosActiva() {
  return _cacheProductosSim !== null;
}

async function crearProductoRemoto(clienteId, datos) {
  const productos = _leerProductosNegocio(clienteId);
  const id = 'prod-sim-' + (_contadorProductoId++);
  productos.push({ id, ...datos });
  _escribirProductosNegocio(clienteId, productos);
  _canalSimulado.postMessage({ productosDeCliente: clienteId });
  return id;
}

async function editarProductoRemoto(clienteId, productoId, cambios) {
  const productos = _leerProductosNegocio(clienteId);
  const actualizado = productos.map((p) => p.id === productoId ? { ...p, ...cambios } : p);
  _escribirProductosNegocio(clienteId, actualizado);
  _canalSimulado.postMessage({ productosDeCliente: clienteId });
}

// Simula la misma logica de "todo o nada" que la transaccion real - no
// simula la concurrencia real entre 2 dispositivos (eso Firestore ya lo
// resuelve, es codigo probado de Google) pero SI prueba que el chequeo de
// stock insuficiente funcione como corresponde.
async function venderConTransaccionSegura(clienteId, itemsVendidos) {
  const productos = _leerProductosNegocio(clienteId);
  for (const it of itemsVendidos) {
    if (!it.producto_id) continue;
    const p = productos.find((prod) => prod.id === it.producto_id);
    const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
    if (!p) throw new Error(`El producto "${it.nombre}" ya no existe.`);
    if ((Number(p.stock) || 0) < cantidadReal) {
      throw new Error(`No hay suficiente stock de "${it.nombre}" — quedan ${p.stock}, se intentaron vender ${cantidadReal}.`);
    }
  }
  const actualizados = productos.map((p) => {
    const it = itemsVendidos.find((i) => i.producto_id === p.id);
    if (!it) return p;
    const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
    return { ...p, stock: (Number(p.stock) || 0) - cantidadReal };
  });
  _escribirProductosNegocio(clienteId, actualizados);
  _canalSimulado.postMessage({ productosDeCliente: clienteId });
}

async function devolverStockSeguro(clienteId, itemsDevueltos) {
  const productos = _leerProductosNegocio(clienteId);
  const actualizados = productos.map((p) => {
    const it = itemsDevueltos.find((i) => i.producto_id === p.id);
    if (!it) return p;
    const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
    return { ...p, stock: (Number(p.stock) || 0) + cantidadReal };
  });
  _escribirProductosNegocio(clienteId, actualizados);
  _canalSimulado.postMessage({ productosDeCliente: clienteId });
}

// ============================================================================
// FASE 2 SIMULADA - presentaciones, promociones, combos, historial de precios
// ============================================================================

function _crearColeccionEnVivoSim(nombreColeccion) {
  let cache = null;
  let contador = 0;
  let clienteEscuchado = null;
  const escribir = (clienteId, items) => {
    localStorage.setItem(nombreColeccion + '_sim_' + clienteId, JSON.stringify(items));
    cache = items;
    _canalSimulado.postMessage({ coleccionSim: nombreColeccion, clienteId });
  };
  const leer = (clienteId) => JSON.parse(localStorage.getItem(nombreColeccion + '_sim_' + clienteId) || '[]');

  return {
    iniciar(clienteId, alActualizar) {
      clienteEscuchado = clienteId;
      cache = leer(clienteId);
      if (alActualizar) alActualizar();
      _canalSimulado.addEventListener('message', (evento) => {
        if (evento.data.coleccionSim === nombreColeccion && evento.data.clienteId === clienteId) {
          cache = leer(clienteId);
          if (alActualizar) alActualizar();
        }
      });
    },
    activa: () => cache !== null,
    listar: () => cache || [],
    async crear(clienteId, datos) {
      const items = leer(clienteId);
      const id = nombreColeccion + '-sim-' + (contador++);
      items.push({ id, ...datos });
      escribir(clienteId, items);
      return id;
    },
    async editar(clienteId, id, cambios) {
      const items = leer(clienteId);
      escribir(clienteId, items.map((it) => it.id === id ? { ...it, ...cambios } : it));
    },
  };
}

const _presentacionesSim = _crearColeccionEnVivoSim('presentaciones');
const _promocionesSim = _crearColeccionEnVivoSim('promociones');
const _combosSim = _crearColeccionEnVivoSim('combos');
const _historialPreciosSim = _crearColeccionEnVivoSim('historial_precios');

function iniciarEscuchaPresentaciones(clienteId, alActualizar) { return _presentacionesSim.iniciar(clienteId, alActualizar); }
function listarPresentacionesRemoto() { return _presentacionesSim.listar(); }
async function crearPresentacionRemota(clienteId, datos) { return await _presentacionesSim.crear(clienteId, datos); }

function iniciarEscuchaPromociones(clienteId, alActualizar) { return _promocionesSim.iniciar(clienteId, alActualizar); }
function listarPromocionesRemoto() { return _promocionesSim.listar(); }
async function crearPromocionRemota(clienteId, datos) { return await _promocionesSim.crear(clienteId, datos); }

function iniciarEscuchaCombos(clienteId, alActualizar) { return _combosSim.iniciar(clienteId, alActualizar); }
function listarCombosRemoto() { return _combosSim.listar(); }
async function crearComboRemoto(clienteId, datos) { return await _combosSim.crear(clienteId, datos); }

function iniciarEscuchaHistorialPrecios(clienteId, alActualizar) { return _historialPreciosSim.iniciar(clienteId, alActualizar); }
function listarHistorialPreciosRemoto() { return _historialPreciosSim.listar(); }
async function crearHistorialPrecioRemoto(clienteId, datos) { return await _historialPreciosSim.crear(clienteId, datos); }

// ============================================================================
// FASE 3 SIMULADA - ventas centralizadas (sin escucha permanente, por
// consulta, igual que la version real)
// ============================================================================

let _contadorVentaId = 0;

function _leerVentasNegocio(clienteId) {
  return JSON.parse(localStorage.getItem('ventas_sim_' + clienteId) || '[]');
}
function _escribirVentasNegocio(clienteId, ventas) {
  localStorage.setItem('ventas_sim_' + clienteId, JSON.stringify(ventas));
}

async function crearVentaRemota(clienteId, venta) {
  const ventas = _leerVentasNegocio(clienteId);
  const id = 'venta-sim-' + (_contadorVentaId++);
  ventas.push({ id, ...venta });
  _escribirVentasNegocio(clienteId, ventas);
  return id;
}

async function listarVentasRemoto(clienteId, desde, hasta) {
  let ventas = _leerVentasNegocio(clienteId);
  if (desde && hasta) {
    ventas = ventas.filter((v) => {
      const f = v.fecha.slice(0, 10);
      return f >= desde && f <= hasta;
    });
  }
  return ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function obtenerVentaRemota(clienteId, ventaId) {
  return _leerVentasNegocio(clienteId).find((v) => v.id === ventaId) || null;
}

async function agregarDevolucionAVenta(clienteId, ventaId, devolucion) {
  const ventas = _leerVentasNegocio(clienteId);
  const actualizadas = ventas.map((v) => {
    if (v.id !== ventaId) return v;
    return { ...v, devoluciones: [...(v.devoluciones || []), devolucion] };
  });
  _escribirVentasNegocio(clienteId, actualizadas);
}

// ============================================================================
// EQUIPOS VINCULADOS SIMULADOS
// ============================================================================

function _leerEquiposPendientes(clienteId) {
  return JSON.parse(localStorage.getItem('equipos_pendientes_sim_' + clienteId) || '{}');
}
function _escribirEquiposPendientes(clienteId, obj) {
  localStorage.setItem('equipos_pendientes_sim_' + clienteId, JSON.stringify(obj));
}
function _leerEquipos(clienteId) {
  return JSON.parse(localStorage.getItem('equipos_sim_' + clienteId) || '{}');
}
function _escribirEquipos(clienteId, obj) {
  localStorage.setItem('equipos_sim_' + clienteId, JSON.stringify(obj));
}

async function generarInvitacionRemota(clienteId, fechaGeneradoSimulada) {
  const codigo = `IHINV-${clienteId}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const pendientes = _leerEquiposPendientes(clienteId);
  pendientes[codigo] = { fecha_generado: fechaGeneradoSimulada || Date.now() };
  _escribirEquiposPendientes(clienteId, pendientes);
  return codigo;
}

async function validarInvitacionRemota(codigo) {
  const raw = (codigo || '').trim().toUpperCase().replace(/\s/g, '');
  const partes = raw.split('-');
  if (partes[0] !== 'IHINV' || partes.length < 3) return [null, 'Formato inválido'];
  const clienteId = partes.slice(1, -1).join('-');
  const pendientes = _leerEquiposPendientes(clienteId);
  if (!pendientes[raw]) return [null, 'Invitación inválida, ya usada, o expirada'];
  const minutosPasados = (Date.now() - pendientes[raw].fecha_generado) / 60000;
  if (minutosPasados > 15) {
    return [null, 'Este código ya venció (dura 15 minutos) — pide uno nuevo al equipo principal.'];
  }
  return [{ cliente_id: clienteId, codigo_invitacion: raw }, 'OK'];
}

async function confirmarEquipoRemoto(clienteId, deviceId, nombreEquipo, codigoInvitacion) {
  const equipos = _leerEquipos(clienteId);
  equipos[deviceId] = { nombre_equipo: nombreEquipo, fecha_confirmado: Date.now() };
  _escribirEquipos(clienteId, equipos);
  if (codigoInvitacion) {
    const pendientes = _leerEquiposPendientes(clienteId);
    delete pendientes[codigoInvitacion];
    _escribirEquiposPendientes(clienteId, pendientes);
  }
}

async function listarEquiposRemoto(clienteId) {
  const equipos = _leerEquipos(clienteId);
  return Object.entries(equipos).map(([device_id, datos]) => ({ device_id, ...datos }));
}

async function soltarEquipoRemoto(clienteId, deviceId) {
  const equipos = _leerEquipos(clienteId);
  delete equipos[deviceId];
  _escribirEquipos(clienteId, equipos);
}

async function registrarEsteEquipo(clienteId, deviceId, nombreEquipo) {
  const equipos = _leerEquipos(clienteId);
  equipos[deviceId] = { nombre_equipo: nombreEquipo, fecha_confirmado: Date.now() };
  _escribirEquipos(clienteId, equipos);
}

function hayCupoDisponibleRemoto(cliente, equiposActuales) {
  return equiposActuales.length < (cliente.capacidad || 2);
}
