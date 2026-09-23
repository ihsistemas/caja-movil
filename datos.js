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
function listarProductos(incluirPausados) {
  return listarProductosRemoto(incluirPausados);
}
async function crearProducto(clienteId, datos) {
  return await crearProductoRemoto(clienteId, estado.negocio_id, {
    codigo: datos.codigo || null, nombre: datos.nombre,
    categoria: datos.categoria || null,
    precio_venta: Number(datos.precio_venta) || 0,
    precio_costo: Number(datos.precio_costo) || 0,
    precio_lista: datos.precio_lista ? Number(datos.precio_lista) : null,
    stock: Number(datos.stock) || 0,
    stock_minimo: Number(datos.stock_minimo) || 5,
    unidad_medida: datos.unidad_medida || 'unidad',
    imagen_data: datos.imagen_data || null,
    fecha_vencimiento: datos.fecha_vencimiento || null,
    aplica_iva: datos.aplica_iva !== false,
    activo: true,
  });
}
// El historial de precios sigue local por ahora (Fase 2 lo centraliza
// tambien) - por eso todavia usa idbCaja, mientras que el producto en si
// ya vive en Firestore. Igual que en Minimarket Pro (el exe), se audita
// precio de VENTA y de COSTO por separado (tipo) - un costo que sube sin
// que se ajuste el precio de venta es justo lo que este historial deberia
// dejar ver.
async function editarProducto(clienteId, id, cambios, nombreQuienModifica) {
  const p = listarProductosRemoto(true).find((prod) => prod.id === id);
  if (!p) return;
  if (cambios.precio_venta !== undefined && Number(cambios.precio_venta) !== Number(p.precio_venta)) {
    await crearHistorialPrecioRemoto(clienteId, estado.negocio_id, {
      producto_id: id, tipo: 'venta', precio_anterior: p.precio_venta, precio_nuevo: Number(cambios.precio_venta),
      fecha: new Date().toISOString(), modificado_por: nombreQuienModifica || null,
    });
  }
  if (cambios.precio_costo !== undefined && Number(cambios.precio_costo) !== Number(p.precio_costo)) {
    await crearHistorialPrecioRemoto(clienteId, estado.negocio_id, {
      producto_id: id, tipo: 'costo', precio_anterior: p.precio_costo, precio_nuevo: Number(cambios.precio_costo),
      fecha: new Date().toISOString(), modificado_por: nombreQuienModifica || null,
    });
  }
  await editarProductoRemoto(clienteId, estado.negocio_id, id, cambios);
}
function historialDePrecios(productoId) {
  const historial = listarHistorialPreciosRemoto().filter((h) => h.producto_id === productoId);
  return historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
async function pausarProducto(clienteId, id) {
  await editarProducto(clienteId, id, { activo: false });
}
async function reactivarProducto(clienteId, id) {
  await editarProducto(clienteId, id, { activo: true });
}
async function listarCategorias() {
  const productos = await listarProductos(true);
  const set = new Set(productos.map((p) => p.categoria).filter(Boolean));
  return Array.from(set).sort();
}

// ---- Ajuste de stock (merma, rotura, diferencia de conteo, etc.) ----
// Igual concepto que "/api/inventario/ajuste" en Minimarket Pro (el exe): el
// stock de un producto YA EXISTENTE no se toca libremente desde "editar
// producto" - solo se mueve vendiendo, devolviendo, o por esta via, que
// SIEMPRE exige un motivo y queda registrada en movimientos_inventario.
const TIPOS_AJUSTE_STOCK = ['merma', 'rotura', 'consumo_interno', 'diferencia_conteo', 'otro'];
async function ajustarStockProducto(clienteId, productoId, { diferencia, motivo, motivoTipo, hechoPor }) {
  diferencia = Number(diferencia);
  if (!diferencia) throw new Error('La diferencia no puede ser 0.');
  if (!(motivo || '').trim()) throw new Error('El motivo es obligatorio.');
  if (!TIPOS_AJUSTE_STOCK.includes(motivoTipo)) motivoTipo = 'otro';
  const p = listarProductosRemoto(true).find((prod) => prod.id === productoId);
  if (!p) throw new Error('Producto no encontrado.');
  const nuevoStock = (Number(p.stock) || 0) + diferencia;
  if (nuevoStock < 0) throw new Error(`El ajuste dejaría el stock en negativo (actual: ${p.stock}).`);
  await editarProductoRemoto(clienteId, estado.negocio_id, productoId, { stock: nuevoStock });
  await crearMovimientoInventarioRemoto(clienteId, estado.negocio_id, {
    producto_id: productoId, producto_nombre: p.nombre, tipo: 'ajuste',
    cantidad: diferencia, stock_resultante: nuevoStock, motivo: motivo.trim(),
    motivo_tipo: motivoTipo, hecho_por: hechoPor || null, fecha: new Date().toISOString(),
  });
}
async function listarMovimientosInventario(clienteId, desde, hasta) {
  return await listarMovimientosInventarioRemoto(clienteId, estado.negocio_id, desde, hasta);
}
async function historialDeAjustesStock(clienteId, productoId) {
  const todos = await listarMovimientosInventario(clienteId);
  return todos.filter((m) => m.producto_id === productoId);
}

// ---- Turno de caja (apertura/cierre) ----
// Igual que en Minimarket Pro: no se puede vender sin caja abierta, y al
// cerrar se compara el efectivo esperado (lo que deberia haber, segun las
// ventas en efectivo de este turno) contra lo contado fisicamente.
// Viven en negocios/{clienteId}/turnos (Firestore), no en el celular - asi
// hay historial real y Manager IH podria mostrarlo. Cada turno queda atado
// al device_id del equipo que lo abrio, para que 2+ cajas del mismo negocio
// puedan operar al mismo tiempo sin pisarse (cada una abre/cierra la suya).
function turnosDeEsteEquipo() {
  return listarTurnosRemoto().filter((t) => t.device_id === getDeviceId());
}
async function turnoActual() {
  return turnosDeEsteEquipo().find((t) => t.estado === 'abierto') || null;
}
async function abrirTurno(clienteId, montoApertura) {
  const existente = await turnoActual();
  if (existente) throw new Error('Ya hay una caja abierta');
  return await crearTurnoRemoto(clienteId, estado.negocio_id, {
    estado: 'abierto', fecha_apertura: new Date().toISOString(),
    monto_apertura: Number(montoApertura) || 0,
    device_id: getDeviceId(), nombre_equipo: estado.nombre_equipo || null,
    usuario_apertura: (sesionActual && sesionActual.nombre) || null,
  });
}
// Historial de cajas CERRADAS de TODO el negocio (todos los equipos, no
// solo este) - a diferencia de turnoActual/abrirTurno, aca si interesa ver
// las de todas las cajas juntas, para que el jefe pueda revisar cualquiera.
function listarTurnosCerrados() {
  return listarTurnosRemoto()
    .filter((t) => t.estado === 'cerrado')
    .sort((a, b) => new Date(b.fecha_cierre) - new Date(a.fecha_cierre));
}
async function calcularEfectivoEsperado(clienteId, turno) {
  const ventas = await listarVentas(clienteId);
  const ventasDelTurno = ventas.filter((v) => v.turno_id === turno.id);
  let efectivo = Number(turno.monto_apertura) || 0;
  for (const v of ventasDelTurno) {
    // Una venta anulada nunca cuenta como efectivo esperado - es como si no
    // hubiera pasado (a diferencia de una devolucion parcial, que sigue
    // restando aparte mas abajo si la venta no esta anulada).
    if (v.anulado) continue;
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
async function cerrarTurno(clienteId, efectivoContado, nota) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta para cerrar');
  const efectivoEsperado = await calcularEfectivoEsperado(clienteId, turno);
  const diferencia = Math.round((Number(efectivoContado) - efectivoEsperado) * 100) / 100;
  if (diferencia !== 0 && !(nota || '').trim()) {
    throw new Error('Hay una diferencia entre lo esperado y lo contado — escribe un motivo antes de cerrar.');
  }
  await editarTurnoRemoto(clienteId, estado.negocio_id, turno.id, {
    estado: 'cerrado', fecha_cierre: new Date().toISOString(),
    efectivo_esperado: efectivoEsperado, efectivo_contado: Number(efectivoContado), diferencia, nota: nota || '',
    usuario_cierre: (sesionActual && sesionActual.nombre) || null,
  });
}

// ---- Caja chica: ingresos, gastos y prestamos, aparte de las ventas ----
// Bug real encontrado en QA: esto vivia en IndexedDB local del celular
// (idbCajaGetAll/idbCajaAdd) - un ingreso registrado en una caja no lo veia
// la otra caja del mismo local (cada equipo tiene su propio IndexedDB,
// aislado), y se perdia para siempre si se reinstalaba la app o se
// limpiaba el cache. Ahora en Firestore, como todo lo demas.
async function listarMovimientosCajaChica() {
  return await listarMovimientosCajaChicaRemoto(estado.cliente_id, estado.negocio_id);
}
async function registrarIngresoCaja(monto, descripcion) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta.');
  if (!descripcion || !descripcion.trim()) throw new Error('El motivo es obligatorio.');
  await crearMovimientoCajaChicaRemoto(estado.cliente_id, estado.negocio_id, {
    tipo: 'ingreso', monto: Math.abs(Number(monto)), descripcion: descripcion.trim(),
    fecha: new Date().toISOString(), turno_id: turno.id,
    usuario_nombre: (sesionActual && sesionActual.nombre) || null,
  });
}
async function registrarGastoCaja(monto, descripcion) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No hay una caja abierta.');
  if (!descripcion || !descripcion.trim()) throw new Error('El motivo es obligatorio.');
  const saldo = await saldoCajaChica();
  if (Number(monto) > saldo) throw new Error(`Saldo insuficiente en caja chica (disponible: ${saldo}).`);
  await crearMovimientoCajaChicaRemoto(estado.cliente_id, estado.negocio_id, {
    tipo: 'gasto', monto: -Math.abs(Number(monto)), descripcion: descripcion.trim(),
    fecha: new Date().toISOString(), turno_id: turno.id,
    usuario_nombre: (sesionActual && sesionActual.nombre) || null,
  });
}
async function saldoCajaChica() {
  const movs = await listarMovimientosCajaChica();
  return movs.reduce((s, m) => s + m.monto, 0);
}

function listarPresentacionesDeProducto(productoId) {
  return listarPresentacionesRemoto().filter((p) => p.producto_id === productoId);
}
async function crearPresentacion(clienteId, productoId, datos) {
  return await crearPresentacionRemota(clienteId, estado.negocio_id, {
    producto_id: productoId, nombre: datos.nombre, codigo: datos.codigo || null,
    cantidad_base: Number(datos.cantidad_base) || 1, precio_venta: Number(datos.precio_venta) || 0,
  });
}

// ---- Ventas ----
async function registrarVenta(clienteId, { items, total, medio_pago }) {
  const turno = await turnoActual();
  if (!turno) throw new Error('No se puede vender sin abrir la caja primero.');
  // Primero se verifica y descuenta el stock de forma segura (todo o nada) -
  // si falla (alguien mas se llevo el stock justo antes), la venta ni
  // siquiera se crea, para no quedar con un registro de una venta que en
  // los hechos no se pudo completar.
  await venderConTransaccionSegura(clienteId, estado.negocio_id, items);
  const venta = {
    fecha: new Date().toISOString(), items, total, medio_pago,
    turno_id: turno.id, nombre_equipo: estado.nombre_equipo,
  };
  return await crearVentaRemota(clienteId, estado.negocio_id, venta);
}
async function listarVentas(clienteId, desde, hasta) {
  return await listarVentasRemoto(clienteId, estado.negocio_id, desde, hasta);
}
async function obtenerVenta(clienteId, id) {
  return await obtenerVentaRemota(clienteId, estado.negocio_id, id);
}
async function registrarDevolucion(clienteId, ventaId, itemsDevueltos, motivo, hechoPor) {
  if (!(motivo || '').trim()) throw new Error('El motivo es obligatorio.');
  const venta = await obtenerVenta(clienteId, ventaId);
  if (!venta) return;
  await devolverStockSeguro(clienteId, estado.negocio_id, itemsDevueltos);
  await agregarDevolucionAVenta(clienteId, estado.negocio_id, ventaId, {
    fecha: new Date().toISOString(), items: itemsDevueltos,
    motivo: motivo.trim(), hecho_por: hechoPor || null,
  });
}

// Anula una venta COMPLETA (no solo algunos items) - igual concepto que
// ventas.estado='anulada' en Minimarket Pro (el exe), que Caja Movil nunca
// tuvo: hasta ahora la unica forma de "deshacer" una venta era devolver
// item por item. Restaura el stock de todo lo que no se hubiera devuelto
// ya antes, y deja la venta marcada (no se borra, para no perder el rastro).
async function anularVentaCompleta(clienteId, ventaId, motivo, hechoPor) {
  if (!(motivo || '').trim()) throw new Error('El motivo es obligatorio.');
  const venta = await obtenerVenta(clienteId, ventaId);
  if (!venta) throw new Error('Venta no encontrada.');
  if (venta.anulado) throw new Error('Esta venta ya está anulada.');
  const yaDevuelto = {};
  for (const d of (venta.devoluciones || [])) {
    for (const it of d.items) {
      const clave = it.clave || it.producto_id;
      yaDevuelto[clave] = (yaDevuelto[clave] || 0) + it.cantidad;
    }
  }
  const itemsARestaurar = venta.items
    .map((it) => ({ ...it, cantidad: it.cantidad - (yaDevuelto[it.clave || it.producto_id] || 0) }))
    .filter((it) => it.cantidad > 0);
  if (itemsARestaurar.length > 0) await devolverStockSeguro(clienteId, estado.negocio_id, itemsARestaurar);
  await editarVentaRemota(clienteId, estado.negocio_id, ventaId, {
    anulado: true, motivo_anulacion: motivo.trim(), anulado_por: hechoPor || null,
    fecha_anulacion: new Date().toISOString(),
  });
}

// ---- Promociones (descuento sobre un producto especifico) ----
async function crearPromocion(clienteId, productoId, datos) {
  return await crearPromocionRemota(clienteId, estado.negocio_id, {
    producto_id: productoId, tipo: datos.tipo, valor: Number(datos.valor),
    activa: true, fecha_inicio: datos.fecha_inicio || null, fecha_fin: datos.fecha_fin || null,
  });
}
function listarPromocionesDeProducto(productoId) {
  const todas = listarPromocionesRemoto().filter((p) => p.producto_id === productoId);
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
async function crearCombo(clienteId, datos) {
  return await crearComboRemoto(clienteId, estado.negocio_id, {
    nombre: datos.nombre, productos_ids: datos.productos_ids, precio_combo: Number(datos.precio_combo), activo: true,
  });
}
function listarCombos() {
  return listarCombosRemoto().filter((c) => c.activo);
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
// Bug real encontrado en QA: esto usaba idbCajaGet/idbCajaPut (IndexedDB
// local, capa vieja de antes de que la app migrara a Firestore) mientras
// el producto real vive en Firestore - el id de producto (string de
// Firestore) ni siquiera es una clave valida para IndexedDB, asi que
// "Guardar factura" tiraba un error silencioso y no guardaba nada, nunca.
// Ahora usa las mismas funciones Remoto que el resto de la app (mismo
// patron que ajustarStockProducto).
async function crearFactura({ proveedor, numero_factura, nota, items }) {
  let totalCosto = 0;
  for (const it of items) {
    const p = listarProductosRemoto(true).find((prod) => prod.id === it.producto_id);
    if (!p) continue;
    const costoNuevo = costoPromedioPonderado(p.stock, p.precio_costo, it.cantidad, it.precio_costo_unitario);
    const nuevoStock = (Number(p.stock) || 0) + Number(it.cantidad);
    await editarProductoRemoto(estado.cliente_id, estado.negocio_id, it.producto_id, { stock: nuevoStock, precio_costo: costoNuevo });
    totalCosto += it.cantidad * it.precio_costo_unitario;
  }
  return await crearFacturaRemota(estado.cliente_id, estado.negocio_id, {
    proveedor: proveedor || '(Sin nombre)', numero_factura: numero_factura || null, nota: nota || null,
    fecha: new Date().toISOString(), items, total_costo: totalCosto,
  });
}
async function listarFacturas() {
  const facturas = await listarFacturasRemoto(estado.cliente_id, estado.negocio_id);
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
async function crearUsuario(clienteId, { nombre, rol, clave, puede_cambiar_precio, modo_carrito, modo_caja, puede_gestionar_usuarios, clave_temporal }) {
  const { hash, salt } = await hashClave(clave);
  const claveRespaldo = generarClaveRespaldo();
  const respaldo = await hashClave(claveRespaldo);
  const esJefe = rol === 'jefe';
  const id = await crearUsuarioRemoto(clienteId, {
    nombre, rol: esJefe ? 'jefe' : 'empleado', clave_hash: hash, clave_salt: salt,
    clave_respaldo_hash: respaldo.hash, clave_respaldo_salt: respaldo.salt,
    puede_cambiar_precio: esJefe ? true : !!puede_cambiar_precio,
    modo_carrito: !!modo_carrito,
    modo_caja: !!modo_caja,
    puede_gestionar_usuarios: esJefe ? true : !!puede_gestionar_usuarios,
    clave_temporal: !!clave_temporal,
    // Local "de origen" (donde se lo creó) + en cuáles puede trabajar - por
    // defecto solo el de origen. El jefe no usa este campo (ve/opera
    // cualquier local del cliente, igual que en Parking).
    negocio_id: estado.negocio_id,
    locales_permitidos: esJefe ? [] : [estado.negocio_id],
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
    clave_temporal: false,
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
// Todo lo que vive SOLO en este celular - los usuarios, carritos a caja y
// turnos NO se incluyen aca porque esos ya viven en el servidor (Firestore),
// Google se encarga de que esos no se pierdan.
const ALMACENES_RESPALDO = [
  'productos', 'ventas', 'presentaciones',
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
