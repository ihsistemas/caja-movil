// ============================================================================
// Capa de datos LOCAL de Caja Movil - productos y ventas viven enteramente en
// este celular (IndexedDB), sin ningun servidor. Mismo patron de helpers que
// ya se probo funcionando bien en el Indexer.
//
// v2: agrega categoria, presentaciones (venta por caja), precio_lista,
// fecha_vencimiento, aplica_iva, y activo/pausado - para igualar el modelo
// de datos que ya tiene Minimarket Pro (Grupo A del plan de union).
// ============================================================================

let dbCaja = null;

function abrirDBCaja() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('caja_movil_db', 8);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('productos')) {
        const s = d.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('codigo', 'codigo', { unique: false });
      }
      if (!d.objectStoreNames.contains('ventas')) {
        d.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('presentaciones')) {
        const s2 = d.createObjectStore('presentaciones', { keyPath: 'id', autoIncrement: true });
        s2.createIndex('producto_id', 'producto_id', { unique: false });
      }
      if (!d.objectStoreNames.contains('turnos')) {
        d.createObjectStore('turnos', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('historial_precios')) {
        const s3 = d.createObjectStore('historial_precios', { keyPath: 'id', autoIncrement: true });
        s3.createIndex('producto_id', 'producto_id', { unique: false });
      }
      if (!d.objectStoreNames.contains('caja_chica')) {
        d.createObjectStore('caja_chica', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('promociones')) {
        const s4 = d.createObjectStore('promociones', { keyPath: 'id', autoIncrement: true });
        s4.createIndex('producto_id', 'producto_id', { unique: false });
      }
      if (!d.objectStoreNames.contains('combos')) {
        d.createObjectStore('combos', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('facturas')) {
        d.createObjectStore('facturas', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('usuarios')) {
        d.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => { dbCaja = req.result; resolve(dbCaja); };
    req.onerror = () => reject(req.error);
  });
}

function idbCajaGetAll(store, indexName, val) {
  return new Promise((resolve, reject) => {
    const tx = dbCaja.transaction(store, 'readonly');
    const s = indexName ? tx.objectStore(store).index(indexName) : tx.objectStore(store);
    const req = val !== undefined ? s.getAll(val) : s.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbCajaGet(store, key) {
  return new Promise((resolve, reject) => {
    const req = dbCaja.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbCajaPut(store, obj) {
  return new Promise((resolve, reject) => {
    const req = dbCaja.transaction(store, 'readwrite').objectStore(store).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbCajaAdd(store, obj) {
  return new Promise((resolve, reject) => {
    const req = dbCaja.transaction(store, 'readwrite').objectStore(store).add(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbCajaDelete(store, key) {
  return new Promise((resolve, reject) => {
    const req = dbCaja.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---- Productos ----
// Por defecto excluye los pausados (activo=false) - igual que Minimarket Pro,
// para pedir tambien los pausados hay que pasar incluirPausados=true.
async function listarProductos(incluirPausados) {
  const todos = await idbCajaGetAll('productos');
  return incluirPausados ? todos : todos.filter((p) => p.activo !== false);
}
async function crearProducto(datos) {
  return await idbCajaAdd('productos', {
    codigo: datos.codigo || null, nombre: datos.nombre,
    categoria: datos.categoria || null,
    precio_venta: Number(datos.precio_venta) || 0,
    precio_costo: Number(datos.precio_costo) || 0,
    precio_lista: datos.precio_lista ? Number(datos.precio_lista) : null,
    stock: Number(datos.stock) || 0,
    unidad_medida: datos.unidad_medida || 'unidad',
    imagen_data: datos.imagen_data || null,
    fecha_vencimiento: datos.fecha_vencimiento || null,
    aplica_iva: datos.aplica_iva !== false,
    activo: true,
  });
}
async function editarProducto(id, cambios, nombreQuienModifica) {
  const p = await idbCajaGet('productos', id);
  if (!p) return;
  if (cambios.precio_venta !== undefined && Number(cambios.precio_venta) !== Number(p.precio_venta)) {
    await idbCajaAdd('historial_precios', {
      producto_id: id, precio_anterior: p.precio_venta, precio_nuevo: Number(cambios.precio_venta),
      fecha: new Date().toISOString(), modificado_por: nombreQuienModifica || null,
    });
  }
  await idbCajaPut('productos', { ...p, ...cambios });
}
async function historialDePrecios(productoId) {
  const historial = await idbCajaGetAll('historial_precios', 'producto_id', productoId);
  return historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
async function ajustarStock(id, diferencia) {
  const p = await idbCajaGet('productos', id);
  if (!p) return;
  p.stock = Math.max(0, (Number(p.stock) || 0) + diferencia);
  await idbCajaPut('productos', p);
}
async function pausarProducto(id) {
  await editarProducto(id, { activo: false });
}
async function reactivarProducto(id) {
  await editarProducto(id, { activo: true });
}
async function listarCategorias() {
  const productos = await listarProductos(true);
  const set = new Set(productos.map((p) => p.categoria).filter(Boolean));
  return Array.from(set).sort();
}

// ---- Turno de caja (apertura/cierre) ----
// Igual que en Minimarket Pro: no se puede vender sin caja abierta, y al
// cerrar se compara el efectivo esperado (lo que deberia haber, segun las
// ventas en efectivo de este turno) contra lo contado fisicamente.
async function turnoActual() {
  const turnos = await idbCajaGetAll('turnos');
  return turnos.find((t) => t.estado === 'abierto') || null;
}
async function abrirTurno(montoApertura) {
  const existente = await turnoActual();
  if (existente) throw new Error('Ya hay una caja abierta');
  return await idbCajaAdd('turnos', {
    estado: 'abierto', fecha_apertura: new Date().toISOString(),
    monto_apertura: Number(montoApertura) || 0,
  });
}
async function calcularEfectivoEsperado(turno) {
  const ventas = await listarVentas();
  const ventasDelTurno = ventas.filter((v) => v.turno_id === turno.id);
  let efectivo = Number(turno.monto_apertura) || 0;
  for (const v of ventasDelTurno) {
    if (v.medio_pago === 'efectivo') efectivo += v.total;
    if (v.devoluciones) {
      for (const d of v.devoluciones) {
        if (v.medio_pago === 'efectivo') {
          const totalDevuelto = d.items.reduce((s, it) => s + (it.precio_venta * it.cantidad), 0);
          efectivo -= totalDevuelto;
        }
      }
    }
  }
  // Los ingresos/gastos de caja chica tambien mueven el efectivo fisico -
  // se suman/restan igual que las ventas, solo se cuentan los de ESTE turno.
  const movimientos = await listarMovimientosCajaChica();
  for (const m of movimientos.filter((m) => m.turno_id === turno.id)) {
    efectivo += m.monto; // ya viene con signo (positivo ingreso, negativo gasto)
  }
  return efectivo;
}
async function cerrarTurno(efectivoContado, nota) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta para cerrar');
  const efectivoEsperado = await calcularEfectivoEsperado(turno);
  const diferencia = Math.round((Number(efectivoContado) - efectivoEsperado) * 100) / 100;
  if (diferencia !== 0 && !(nota || '').trim()) {
    throw new Error('Hay una diferencia entre lo esperado y lo contado — escribe un motivo antes de cerrar.');
  }
  await idbCajaPut('turnos', {
    ...turno, estado: 'cerrado', fecha_cierre: new Date().toISOString(),
    efectivo_esperado: efectivoEsperado, efectivo_contado: Number(efectivoContado), diferencia, nota: nota || '',
  });
}

// ---- Caja chica: ingresos, gastos y prestamos, aparte de las ventas ----
async function listarMovimientosCajaChica() {
  const movs = await idbCajaGetAll('caja_chica');
  return movs.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
async function registrarIngresoCaja(monto, descripcion) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta.');
  if (!descripcion || !descripcion.trim()) throw new Error('El motivo es obligatorio.');
  await idbCajaAdd('caja_chica', {
    tipo: 'ingreso', monto: Math.abs(Number(monto)), descripcion: descripcion.trim(),
    fecha: new Date().toISOString(), turno_id: turno.id,
  });
}
async function registrarGastoCaja(monto, descripcion) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta.');
  if (!descripcion || !descripcion.trim()) throw new Error('El motivo es obligatorio.');
  const saldo = await saldoCajaChica();
  if (Number(monto) > saldo) throw new Error(`Saldo insuficiente en caja chica (disponible: ${saldo}).`);
  await idbCajaAdd('caja_chica', {
    tipo: 'gasto', monto: -Math.abs(Number(monto)), descripcion: descripcion.trim(),
    fecha: new Date().toISOString(), turno_id: turno.id,
  });
}
async function saldoCajaChica() {
  const movs = await listarMovimientosCajaChica();
  return movs.reduce((s, m) => s + m.monto, 0);
}

async function listarPresentacionesDeProducto(productoId) {
  return await idbCajaGetAll('presentaciones', 'producto_id', productoId);
}
async function crearPresentacion(productoId, datos) {
  return await idbCajaAdd('presentaciones', {
    producto_id: productoId, nombre: datos.nombre, codigo: datos.codigo || null,
    cantidad_base: Number(datos.cantidad_base) || 1, precio_venta: Number(datos.precio_venta) || 0,
  });
}

// ---- Ventas ----
async function registrarVenta({ items, total, medio_pago }) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No se puede vender sin abrir la caja primero.');
  const venta = {
    fecha: new Date().toISOString(), items, total, medio_pago, turno_id: turno.id,
  };
  const id = await idbCajaAdd('ventas', venta);
  // Descontar stock de cada item vendido - si el item se vendio por
  // presentacion (ej: una caja), se descuenta la cantidad BASE real, no 1.
  for (const it of items) {
    if (it.producto_id) {
      const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
      await ajustarStock(it.producto_id, -cantidadReal);
    }
  }
  return id;
}
async function listarVentas() {
  const ventas = await idbCajaGetAll('ventas');
  return ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
async function obtenerVenta(id) {
  return await idbCajaGet('ventas', id);
}
async function registrarDevolucion(ventaId, itemsDevueltos) {
  const venta = await obtenerVenta(ventaId);
  if (!venta) return;
  for (const it of itemsDevueltos) {
    if (it.producto_id) {
      const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
      await ajustarStock(it.producto_id, cantidadReal);
    }
  }
  venta.devoluciones = venta.devoluciones || [];
  venta.devoluciones.push({ fecha: new Date().toISOString(), items: itemsDevueltos });
  await idbCajaPut('ventas', venta);
}

// ---- Promociones (descuento sobre un producto especifico) ----
async function crearPromocion(productoId, datos) {
  return await idbCajaAdd('promociones', {
    producto_id: productoId, tipo: datos.tipo, valor: Number(datos.valor),
    activa: true, fecha_inicio: datos.fecha_inicio || null, fecha_fin: datos.fecha_fin || null,
  });
}
async function listarPromocionesDeProducto(productoId) {
  const todas = await idbCajaGetAll('promociones', 'producto_id', productoId);
  const hoy = new Date().toISOString().slice(0, 10);
  return todas.filter((p) => {
    if (!p.activa) return false;
    if (p.fecha_inicio && hoy < p.fecha_inicio) return false;
    if (p.fecha_fin && hoy > p.fecha_fin) return false;
    return true;
  });
}
function precioConPromocion(precioOriginal, promocion) {
  if (promocion.tipo === 'porcentaje') return Math.round(precioOriginal * (1 - promocion.valor / 100));
  if (promocion.tipo === 'monto_fijo') return Math.max(0, precioOriginal - promocion.valor);
  if (promocion.tipo === 'precio_fijo') return promocion.valor;
  return precioOriginal;
}

// ---- Combos (varios productos juntos a un precio especial) ----
async function crearCombo(datos) {
  return await idbCajaAdd('combos', {
    nombre: datos.nombre, productos_ids: datos.productos_ids, precio_combo: Number(datos.precio_combo), activo: true,
  });
}
async function listarCombos() {
  const todos = await idbCajaGetAll('combos');
  return todos.filter((c) => c.activo);
}

// Revisa si el carrito actual (agrupado por producto_id) contiene TODOS los
// productos de algun combo activo, al menos 1 de cada uno - si es asi, lo
// ofrece (no lo aplica solo, para que la persona confirme).
async function combosAplicablesAlCarrito(carrito) {
  const combos = await listarCombos();
  const idsEnCarrito = new Set(carrito.map((it) => it.producto_id));
  return combos.filter((c) => c.productos_ids.every((id) => idsEnCarrito.has(id)));
}

// ---- Facturas de compra (a proveedor) - igual formula de costo promedio ponderado que Minimarket Pro ----
function costoPromedioPonderado(stockActual, costoActual, cantidadQueEntra, costoQueEntra) {
  if (cantidadQueEntra > 0 && stockActual > 0) {
    return Math.round(((stockActual * costoActual + cantidadQueEntra * costoQueEntra) / (stockActual + cantidadQueEntra)) * 100) / 100;
  }
  return costoQueEntra;
}
async function crearFactura({ proveedor, numero_factura, nota, items }) {
  let totalCosto = 0;
  for (const it of items) {
    const p = await idbCajaGet('productos', it.producto_id);
    if (!p) continue;
    const costoNuevo = costoPromedioPonderado(p.stock, p.precio_costo, it.cantidad, it.precio_costo_unitario);
    await idbCajaPut('productos', { ...p, stock: (Number(p.stock) || 0) + Number(it.cantidad), precio_costo: costoNuevo });
    totalCosto += it.cantidad * it.precio_costo_unitario;
  }
  return await idbCajaAdd('facturas', {
    proveedor: proveedor || '(Sin nombre)', numero_factura: numero_factura || null, nota: nota || null,
    fecha: new Date().toISOString(), items, total_costo: totalCosto,
  });
}
async function listarFacturas() {
  const facturas = await idbCajaGetAll('facturas');
  return facturas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
async function listarProveedores() {
  const facturas = await listarFacturas();
  const grupos = {};
  for (const f of facturas) {
    const nombre = f.proveedor || '(Sin nombre)';
    if (!grupos[nombre]) grupos[nombre] = { proveedor: nombre, n_facturas: 0, total_comprado: 0, ultima_visita: f.fecha };
    grupos[nombre].n_facturas += 1;
    grupos[nombre].total_comprado += f.total_costo;
    if (f.fecha > grupos[nombre].ultima_visita) grupos[nombre].ultima_visita = f.fecha;
  }
  return Object.values(grupos).sort((a, b) => new Date(b.ultima_visita) - new Date(a.ultima_visita));
}

// ---- Usuarios (roles y permisos) ----
// PBKDF2 con sal, no un solo SHA-256 - asi un empleado que le saca el hash del
// jefe desde el IndexedDB del celular (algo que SI puede hacer con solo abrir
// las herramientas de desarrollador del navegador) no lo puede crackear rapido
// con fuerza bruta ni con tablas precalculadas. 100.000 iteraciones es el piso
// recomendado hoy para PBKDF2-SHA256.
const PBKDF2_ITERACIONES = 100000;

function saltAleatoria() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexABytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return new Uint8Array(bytes);
}
async function hashClave(clave, saltHex) {
  const salt = saltHex || saltAleatoria();
  const claveKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const derivado = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexABytes(salt), iterations: PBKDF2_ITERACIONES, hash: 'SHA-256' },
    claveKey, 256
  );
  const hash = Array.from(new Uint8Array(derivado)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash, salt };
}
async function listarUsuarios() {
  return listarUsuariosRemoto();
}
function hayUsuarios() {
  return listarUsuariosRemoto().length > 0;
}
// Clave de respaldo: se genera una sola vez, al crear el usuario, y se
// muestra en pantalla UNA vez nada mas - despues de eso solo se guarda su
// hash (igual de segura que la clave normal), nunca en texto plano. Sirve
// para poder entrar si se olvida la clave normal, sin depender de nadie mas.
function generarClaveRespaldo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const grupo = (offset) => Array.from({ length: 4 }, (_, i) => chars[bytes[offset + i] % chars.length]).join('');
  return `${grupo(0)}-${grupo(4)}-${grupo(8)}`;
}
async function crearUsuario(clienteId, { nombre, rol, clave, puede_cambiar_precio, modo_carrito, modo_caja, puede_gestionar_usuarios }) {
  const { hash, salt } = await hashClave(clave);
  const claveRespaldo = generarClaveRespaldo();
  const respaldo = await hashClave(claveRespaldo);
  const id = await crearUsuarioRemoto(clienteId, {
    nombre, rol: rol === 'jefe' ? 'jefe' : 'empleado', clave_hash: hash, clave_salt: salt,
    clave_respaldo_hash: respaldo.hash, clave_respaldo_salt: respaldo.salt,
    puede_cambiar_precio: rol === 'jefe' ? true : !!puede_cambiar_precio,
    modo_carrito: !!modo_carrito,
    modo_caja: !!modo_caja,
    puede_gestionar_usuarios: rol === 'jefe' ? true : !!puede_gestionar_usuarios,
  });
  return { id, claveRespaldo };
}
// Con sal no se puede calcular UN hash y buscarlo en la lista (cada usuario
// tiene su propia sal) - hay que probar contra cada usuario, uno por uno.
async function verificarClaveUsuario(clave) {
  if (!clave) return null;
  const usuarios = listarUsuariosRemoto();
  for (const u of usuarios) {
    const { hash } = await hashClave(clave, u.clave_salt);
    if (hash === u.clave_hash) return u;
  }
  return null;
}
// Para el login normal - busca SOLO a ese usuario (1 lectura), no escucha
// la lista completa del negocio. Mas barato en Firestore que
// verificarClaveUsuario, que necesita tener ya toda la lista cargada.
async function verificarClaveUsuarioPorNombre(clienteId, nombre, clave) {
  if (!nombre || !clave) return null;
  const usuario = await buscarUsuarioPorNombre(clienteId, nombre);
  if (!usuario) return null;
  const { hash } = await hashClave(clave, usuario.clave_salt);
  return hash === usuario.clave_hash ? usuario : null;
}
async function verificarClaveRespaldo(claveRespaldo) {
  if (!claveRespaldo) return null;
  const usuarios = listarUsuariosRemoto();
  for (const u of usuarios) {
    if (!u.clave_respaldo_hash) continue;
    const { hash } = await hashClave(claveRespaldo, u.clave_respaldo_salt);
    if (hash === u.clave_respaldo_hash) return u;
  }
  return null;
}
// Cambia la clave normal usando la de respaldo, y genera una clave de
// respaldo NUEVA de paso (la vieja queda invalida, practica de seguridad
// estandar - una clave de respaldo usada no deberia servir dos veces).
async function restablecerClaveConRespaldo(clienteId, usuarioId, claveNueva) {
  const { hash, salt } = await hashClave(claveNueva);
  const claveRespaldoNueva = generarClaveRespaldo();
  const respaldo = await hashClave(claveRespaldoNueva);
  await editarUsuarioRemoto(clienteId, usuarioId, {
    clave_hash: hash, clave_salt: salt,
    clave_respaldo_hash: respaldo.hash, clave_respaldo_salt: respaldo.salt,
  });
  return claveRespaldoNueva;
}
async function editarUsuario(clienteId, id, cambios) {
  if (cambios.clave) {
    const { hash, salt } = await hashClave(cambios.clave);
    cambios = { ...cambios, clave_hash: hash, clave_salt: salt };
    delete cambios.clave;
  }
  await editarUsuarioRemoto(clienteId, id, cambios);
}
async function eliminarUsuario(clienteId, id) {
  await editarUsuario(clienteId, id, { activo: false });
}

// ---- Respaldo completo (exportar/restaurar) ----
// Todo lo que vive SOLO en este celular (productos, ventas, etc.) - los
// usuarios y los carritos a caja NO se incluyen aca porque esos ya viven en
// el servidor (Firestore), Google se encarga de que esos no se pierdan.
const ALMACENES_RESPALDO = [
  'productos', 'ventas', 'presentaciones', 'turnos',
  'historial_precios', 'caja_chica', 'promociones', 'combos', 'facturas',
];

async function exportarRespaldoCompleto() {
  const respaldo = { version: 1, fecha_respaldo: new Date().toISOString(), datos: {} };
  for (const almacen of ALMACENES_RESPALDO) {
    respaldo.datos[almacen] = await idbCajaGetAll(almacen);
  }
  return respaldo;
}

// Restaura un respaldo COMPLETO - borra lo que hay en cada almacen y pone lo
// del archivo en su lugar (no mezcla con lo que ya hubiera, para evitar
// duplicados o inconsistencias raras). Pensado para el caso de "se me perdio
// el celular, tengo uno nuevo, quiero seguir donde estaba".
async function restaurarRespaldoCompleto(respaldo) {
  if (!respaldo || !respaldo.datos) throw new Error('Archivo de respaldo invalido.');
  for (const almacen of ALMACENES_RESPALDO) {
    const filas = respaldo.datos[almacen];
    if (!Array.isArray(filas)) continue;
    // Vaciar el almacen actual
    const existentes = await idbCajaGetAll(almacen);
    for (const fila of existentes) await idbCajaDelete(almacen, fila.id);
    // Poner las filas del respaldo, respetando sus ids originales
    for (const fila of filas) await idbCajaPut(almacen, fila);
  }
}
