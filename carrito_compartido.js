// ============================================================================
// Envio de carritos a caja - CADA dispositivo arma su propio carrito, y lo
// manda al dispositivo/dispositivos en modo Caja de SU MISMO NEGOCIO (sin
// tener que escribir ningun codigo - se encuentra solo usando el cliente_id
// que ya existe en el sistema de equipos/licencias).
//
// CONFIGURACION: reemplazar CONFIG_FIREBASE con las credenciales reales del
// proyecto de Firebase antes de usar esto en serio.
// ============================================================================

const CONFIG_FIREBASE = {
  apiKey: "AIzaSyCvJF95IEvA_3KhX0aX90vIxP-R3dfJaqg",
  authDomain: "ih-sistemas.firebaseapp.com",
  projectId: "ih-sistemas",
  storageBucket: "ih-sistemas.firebasestorage.app",
  messagingSenderId: "967603772155",
  appId: "1:967603772155:web:ea47a58448851ede872e5e",
};

// REEMPLAZAR con la clave real de reCAPTCHA v3 una vez que Nacho la genere
// (ver instrucciones en DISENO_MULTIDISPOSITIVO.md) - hasta entonces, App
// Check no se activa y todo sigue funcionando igual que antes (sin esta
// capa extra), no rompe nada mientras tanto.
const RECAPTCHA_SITE_KEY = "6LeLwactAAAAAF2nD88ZzMDM9icR49c6V1Js80GL";

let firebaseApp = null;
let db = null;
let unsubscribeActual = null;

function inicializarFirebase(configPersonalizada) {
  const config = configPersonalizada || CONFIG_FIREBASE;
  firebaseApp = FirebaseSync.initializeApp(config);
  db = FirebaseSync.getFirestore(firebaseApp);
  // Deja que seguir funcionando con la ultima copia conocida si se corta el
  // internet. Si falla (ej: 2 pestañas abiertas a la vez), no es grave -
  // simplemente no habria cache offline en esa pestaña, el resto sigue igual.
  FirebaseSync.enableIndexedDbPersistence(db).catch(() => {});
  // App Check - confirma que los pedidos vienen de verdad desde esta app
  // (no desde alguien con la consola del navegador abierta a mano). Solo
  // se activa si ya se configuro la clave real de reCAPTCHA - mientras
  // diga el marcador, sigue funcionando todo igual, sin esta capa extra.
  if (!RECAPTCHA_SITE_KEY.startsWith('REEMPLAZAR') && FirebaseSync.initializeAppCheck) {
    FirebaseSync.initializeAppCheck(firebaseApp, {
      provider: new FirebaseSync.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

function conectarAEmulador(host, puerto) {
  FirebaseSync.connectFirestoreEmulator(db, host, puerto);
}

// El documento de la caja usa el mismo cliente_id de siempre como su ID -
// asi cualquier equipo del mismo negocio la encuentra sola, sin codigo.
// Se puede llamar de los 2 lados (carrito o caja) sin problema - crea el
// documento si no existe, no hace nada si ya existia (idempotente).
async function asegurarCajaDelNegocio(clienteId) {
  const ref = FirebaseSync.doc(db, 'cajas', clienteId);
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) {
    await FirebaseSync.setDoc(ref, { cliente_id: clienteId, creada: FirebaseSync.serverTimestamp() });
  }
}

// callback(listaCarritos) cada vez que cambia algo - solo carritos
// pendientes, mas recientes primero.
function escucharCarritosEntrantes(clienteId, callback, errorCallback) {
  dejarDeEscuchar();
  const col = FirebaseSync.collection(db, 'cajas', clienteId, 'carritos_recibidos');
  const consulta = FirebaseSync.query(col, FirebaseSync.where('estado', '==', 'pendiente'));
  unsubscribeActual = FirebaseSync.onSnapshot(consulta,
    (snap) => {
      const carritos = [];
      snap.forEach((doc) => carritos.push({ id: doc.id, ...doc.data() }));
      carritos.sort((a, b) => (b.fecha_envio?.toMillis?.() || 0) - (a.fecha_envio?.toMillis?.() || 0));
      callback(carritos);
    },
    (error) => { if (errorCallback) errorCallback(error); }
  );
  return unsubscribeActual;
}

async function marcarCarritoProcesado(clienteId, idCarrito) {
  const ref = FirebaseSync.doc(db, 'cajas', clienteId, 'carritos_recibidos', idCarrito);
  await FirebaseSync.updateDoc(ref, { estado: 'procesado' });
  incrementarUsoDiario(clienteId, 'carrito_procesado');
}

function dejarDeEscuchar() {
  if (unsubscribeActual) { unsubscribeActual(); unsubscribeActual = null; }
}

async function enviarCarritoACaja(clienteId, items, total, nombreEquipo) {
  await asegurarCajaDelNegocio(clienteId);
  const col = FirebaseSync.collection(db, 'cajas', clienteId, 'carritos_recibidos');
  await FirebaseSync.addDoc(col, {
    items, total, enviado_por: nombreEquipo,
    fecha_envio: FirebaseSync.serverTimestamp(),
    estado: 'pendiente',
  });
  incrementarUsoDiario(clienteId, 'carrito_enviado');
}

// ============================================================================
// USUARIOS - viven en el servidor (Firestore), no en cada celular por
// separado. Un listener continuo mantiene una copia en memoria siempre al
// dia (tanto online como offline, gracias al cache local que Firestore
// maneja solo) - listarUsuarios/verificarClave leen de esa copia, sin tener
// que esperar una consulta nueva cada vez.
// ============================================================================

let unsubscribeUsuarios = null;
let _cacheUsuarios = null; // null = todavia no llego el primer valor

// Hay que llamar esto UNA vez, apenas se conoce el cliente_id (antes de
// intentar loguear a nadie) - deja _cacheUsuarios lista para consultar.
function iniciarEscuchaUsuarios(clienteId, alListo) {
  if (unsubscribeUsuarios) unsubscribeUsuarios();
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'usuarios');
  let esPrimeraVez = true;
  unsubscribeUsuarios = FirebaseSync.onSnapshot(col, (snap) => {
    const usuarios = [];
    snap.forEach((doc) => usuarios.push({ id: doc.id, ...doc.data() }));
    _cacheUsuarios = usuarios;
    if (esPrimeraVez) { esPrimeraVez = false; if (alListo) alListo(); }
  });
}

function listarUsuariosRemoto() {
  if (_cacheUsuarios === null) return [];
  return _cacheUsuarios.filter((u) => u.activo !== false);
}
function escuchaUsuariosActiva() {
  return _cacheUsuarios !== null;
}

// Busqueda PUNTUAL por nombre - cuesta 1 lectura (la que efectivamente
// existe), no N lecturas como escuchar la coleccion completa. Se usa para
// el login normal (entrar con nombre + clave) - "Gestionar usuarios" (que
// es jefe/delegado, no se usa en cada apertura de la app) sigue usando la
// lista completa via iniciarEscuchaUsuarios, ahi si hace falta verla entera.
async function buscarUsuarioPorNombre(clienteId, nombre) {
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'usuarios');
  const consulta = FirebaseSync.query(col, FirebaseSync.where('nombre', '==', nombre), FirebaseSync.where('activo', '==', true));
  const snap = await FirebaseSync.getDocs(consulta);
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function crearUsuarioRemoto(clienteId, datos) {
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'usuarios');
  const ref = await FirebaseSync.addDoc(col, { ...datos, activo: true });
  incrementarUsoDiario(clienteId, 'usuario_creado');
  return ref.id;
}

async function editarUsuarioRemoto(clienteId, usuarioId, cambios) {
  const ref = FirebaseSync.doc(db, 'negocios', clienteId, 'usuarios', usuarioId);
  await FirebaseSync.updateDoc(ref, cambios);
  incrementarUsoDiario(clienteId, 'usuario_editado');
}

// ============================================================================
// SEÑAL DE CIERRE DEL MAESTRO - si el equipo maestro cierra sesion, los
// equipos sub se enteran y cierran la suya tambien, solos. Simple a
// proposito: un campo con la hora del ultimo cierre, todos escuchando.
// ============================================================================

let unsubscribeCierreMaestro = null;

async function avisarCierreDeSesionMaestro(clienteId) {
  const ref = FirebaseSync.doc(db, 'negocios', clienteId);
  await FirebaseSync.setDoc(ref, { ultimo_cierre_maestro: FirebaseSync.serverTimestamp() }, { merge: true });
}

// callback() se llama SOLO cuando aparece un cierre NUEVO (no en el primer
// valor que ya hubiera de antes) - asi un equipo que recien se conecta no se
// cierra solo por un aviso viejo de la ultima vez que el maestro cerro.
function escucharCierreDeSesionMaestro(clienteId, callback) {
  if (unsubscribeCierreMaestro) unsubscribeCierreMaestro();
  const ref = FirebaseSync.doc(db, 'negocios', clienteId);
  let esPrimeraVez = true;
  unsubscribeCierreMaestro = FirebaseSync.onSnapshot(ref, (snap) => {
    if (esPrimeraVez) { esPrimeraVez = false; return; }
    if (snap.exists() && snap.data().ultimo_cierre_maestro) callback();
  });
  return unsubscribeCierreMaestro;
}
function dejarDeEscucharCierreMaestro() {
  if (unsubscribeCierreMaestro) { unsubscribeCierreMaestro(); unsubscribeCierreMaestro = null; }
}

// ============================================================================
// LICENCIA REAL, CONTRA EL SERVIDOR - reemplaza el token auto-firmado que
// cualquiera con el codigo fuente podia falsificar (HMAC con secreto
// embebido en el JS = no es un secreto de verdad una vez que el cliente
// final tiene el codigo). Ahora el cliente VIVE en Firestore - el codigo
// que se comparte es solo el ID para encontrarlo, no un certificado que se
// pueda armar a mano. El vencimiento se compara contra la HORA DEL
// SERVIDOR, no la del dispositivo - asi atrasar el reloj del celular ya no
// sirve para estirar una prueba vencida.
// ============================================================================

// Escribe una marca con la hora real del servidor y la vuelve a leer -
// asi se obtiene la hora verdadera de Firebase, no la del dispositivo
// (que el dueño del celular podria atrasar a mano). Cuesta 1 escritura +
// 1 lectura cada vez que se llama - se usa solo al activar y al revisar
// vencimiento, no en cada accion.
async function horaServidorActual() {
  const ref = FirebaseSync.doc(db, '_verificacion_hora', 'ahora');
  await FirebaseSync.setDoc(ref, { t: FirebaseSync.serverTimestamp() });
  const snap = await FirebaseSync.getDoc(ref);
  return snap.data().t.toDate();
}

// Impredecible de verdad (no Math.random, que no es criptografico) - esto
// es la credencial de acceso principal a todo un negocio, tiene que ser
// dificil de adivinar en serio.
function caracterAleatorioSeguro(alfabeto) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return alfabeto[bytes[0] % alfabeto.length];
}

function generarClienteId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = 'CLI-';
  for (let i = 0; i < 10; i++) codigo += caracterAleatorioSeguro(chars);
  return codigo;
}

// Lo usa App Soporte para crear un cliente nuevo. El "codigo" que se
// comparte con el cliente final es simplemente este ID - no hay nada que
// firmar ni que falsificar, porque la unica fuente de verdad es el
// documento en Firestore, no lo que el dispositivo pueda calcular solo.
async function crearClienteRemoto({ nombre, capacidad, capacidadUsuarios, tipoLicencia, diasPrueba }) {
  const clienteId = generarClienteId();
  const tipo = tipoLicencia === 'trial' ? 'trial' : 'permanente';
  let vence = null;
  if (tipo === 'trial') {
    const horaServidor = await horaServidorActual();
    const fechaVence = new Date(horaServidor);
    fechaVence.setDate(fechaVence.getDate() + (Number(diasPrueba) || 15));
    vence = fechaVence.toISOString().slice(0, 10);
  }
  const ref = FirebaseSync.doc(db, 'clientes', clienteId);
  await FirebaseSync.setDoc(ref, {
    nombre, capacidad: capacidad || 2, capacidad_usuarios: capacidadUsuarios || 6,
    tipo_licencia: tipo, vence,
    fecha_creado: FirebaseSync.serverTimestamp(),
  });
  return { cliente_id: clienteId, nombre, capacidad: capacidad || 2, tipo_licencia: tipo, vence };
}

// Lo usa cualquier dispositivo al activarse (o al revisar si sigue vigente
// despues). Consulta DIRECTO al servidor - no hay forma de que el
// dispositivo "calcule" una respuesta valida el solo, tiene que
// preguntarle a Firestore de verdad.
async function obtenerClienteRemoto(clienteId) {
  const ref = FirebaseSync.doc(db, 'clientes', (clienteId || '').trim().toUpperCase());
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) return [null, 'Ese código de cliente no existe.'];
  const cliente = { cliente_id: snap.id, ...snap.data() };
  if (cliente.tipo_licencia === 'trial' && cliente.vence) {
    const horaServidor = await horaServidorActual();
    const hoyServidor = horaServidor.toISOString().slice(0, 10);
    if (hoyServidor > cliente.vence) return [null, `La prueba venció el ${cliente.vence}`];
  }
  return [cliente, 'OK'];
}

// ============================================================================
// USO DIARIO POR CLIENTE - para poder avisarle a Nacho si un negocio se
// esta acercando al cupo gratis de Firebase, sin depender de que revise la
// consola de Firebase el mismo. Solo cuenta operaciones que TOCAN el
// servidor (enviar carrito, procesar carrito, usuarios) - "Cobrar aqui
// mismo" y el resto de la Venta normal NO gastan nada, no se cuentan.
// ============================================================================

function fechaHoyParaContador() {
  return new Date().toISOString().slice(0, 10);
}

// No espera a que termine (no queremos que una venta se sienta mas lenta
// por esto) - si falla, no pasa nada grave, es solo un contador informativo.
function incrementarUsoDiario(clienteId, tipo) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'uso_diario', fechaHoyParaContador());
  FirebaseSync.setDoc(ref, {
    operaciones: FirebaseSync.increment(1),
    [`por_tipo.${tipo}`]: FirebaseSync.increment(1),
  }, { merge: true }).catch(() => {});
}

async function obtenerUsoDeHoy(clienteId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'uso_diario', fechaHoyParaContador());
  const snap = await FirebaseSync.getDoc(ref);
  return snap.exists() ? snap.data() : { operaciones: 0 };
}

// Trae los ultimos N dias de uso para ver una tendencia, no solo hoy.
async function obtenerUsoUltimosDias(clienteId, nDias) {
  const dias = [];
  for (let i = 0; i < nDias; i++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    const fechaTexto = fecha.toISOString().slice(0, 10);
    const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'uso_diario', fechaTexto);
    const snap = await FirebaseSync.getDoc(ref);
    dias.push({ fecha: fechaTexto, operaciones: snap.exists() ? (snap.data().operaciones || 0) : 0 });
  }
  return dias;
}

// ============================================================================
// BIBLIOTECA DE PRODUCTOS - base compartida de codigo de barra -> nombre/foto,
// alimentada por Nacho (Indexer) y por cualquier cliente que escanee algo
// nuevo. Los clientes SOLO pueden crear entradas que no existan - nunca
// modificar una que ya existe (eso lo protegen las reglas de Firestore, no
// esta funcion). Lo que un cliente aporta de nuevo no entra directo a la
// biblioteca - queda pendiente de que Nacho lo revise y apruebe.
// ============================================================================

// Busqueda puntual por codigo de barra - 1 lectura, no hace falta escuchar
// toda la biblioteca (que puede crecer mucho con el tiempo).
async function buscarEnBiblioteca(codigoBarra) {
  if (!codigoBarra) return null;
  const ref = FirebaseSync.doc(db, 'biblioteca_productos', codigoBarra);
  const snap = await FirebaseSync.getDoc(ref);
  return snap.exists() ? { codigo_barra: snap.id, ...snap.data() } : null;
}

// El cliente propone un producto nuevo (codigo que la biblioteca no conoce)
// - NO se sube directo a la biblioteca general, queda pendiente de revision
// de Nacho, bajo el cliente que lo mando.
async function proponerProductoNuevo(clienteId, { codigoBarra, nombre, imagenData }) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'biblioteca_pendiente');
  await FirebaseSync.addDoc(col, {
    codigo_barra: codigoBarra, nombre, imagen_data: imagenData || null,
    fecha_propuesto: FirebaseSync.serverTimestamp(),
    estado: 'pendiente',
  });
}

// ============================================================================
// PRODUCTOS Y STOCK - FASE 1 del rediseño de datos compartidos. Viven en
// negocios/{clienteId}/productos, en vivo para todos los equipos del mismo
// negocio (a diferencia de usuarios, aca SI hace falta escuchar la lista
// completa siempre - Venta necesita ver el catalogo entero para navegarlo).
// ============================================================================

let unsubscribeProductos = null;
let _cacheProductos = null; // null = todavia no llego el primer valor

function iniciarEscuchaProductos(clienteId, alActualizar) {
  if (unsubscribeProductos) unsubscribeProductos();
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'productos');
  unsubscribeProductos = FirebaseSync.onSnapshot(col, (snap) => {
    const productos = [];
    snap.forEach((doc) => productos.push({ id: doc.id, ...doc.data() }));
    _cacheProductos = productos;
    if (alActualizar) alActualizar();
  }, (error) => {
    console.warn('Error escuchando productos:', error.message);
  });
  return unsubscribeProductos;
}
function dejarDeEscucharProductos() {
  if (unsubscribeProductos) { unsubscribeProductos(); unsubscribeProductos = null; }
}
function listarProductosRemoto(incluirPausados) {
  if (_cacheProductos === null) return [];
  return incluirPausados ? _cacheProductos : _cacheProductos.filter((p) => p.activo !== false);
}
function escuchaProductosActiva() {
  return _cacheProductos !== null;
}

async function crearProductoRemoto(clienteId, datos) {
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'productos');
  const ref = await FirebaseSync.addDoc(col, datos);
  return ref.id;
}

async function editarProductoRemoto(clienteId, productoId, cambios) {
  const ref = FirebaseSync.doc(db, 'negocios', clienteId, 'productos', productoId);
  await FirebaseSync.updateDoc(ref, cambios);
}

// La pieza clave de seguridad: descuenta stock de VARIOS productos a la vez,
// de forma atomica - si CUALQUIERA de los items no tiene stock suficiente en
// el momento exacto de confirmar (alguien mas se lo llevo mientras tanto),
// TODA la venta se cancela junta, no se descuenta ninguno a medias. Firestore
// reintenta esta funcion sola si otro dispositivo escribio el mismo producto
// justo al mismo tiempo (eso es lo que hace que sea "atomico" de verdad).
async function venderConTransaccionSegura(clienteId, itemsVendidos) {
  await FirebaseSync.runTransaction(db, async (transaccion) => {
    const refs = itemsVendidos
      .filter((it) => it.producto_id)
      .map((it) => ({ item: it, ref: FirebaseSync.doc(db, 'negocios', clienteId, 'productos', it.producto_id) }));

    // TODAS las lecturas de una transaccion tienen que pasar antes que
    // cualquier escritura - regla de Firestore, no se pueden mezclar.
    const snapshots = await Promise.all(refs.map((r) => transaccion.get(r.ref)));

    for (let i = 0; i < refs.length; i++) {
      const snap = snapshots[i];
      const it = refs[i].item;
      const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
      if (!snap.exists()) throw new Error(`El producto "${it.nombre}" ya no existe.`);
      const stockActual = Number(snap.data().stock) || 0;
      if (stockActual < cantidadReal) {
        throw new Error(`No hay suficiente stock de "${it.nombre}" — quedan ${stockActual}, se intentaron vender ${cantidadReal}.`);
      }
    }
    for (let i = 0; i < refs.length; i++) {
      const it = refs[i].item;
      const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
      transaccion.update(refs[i].ref, { stock: FirebaseSync.increment(-cantidadReal) });
    }
  });
}

// Para devoluciones - sumar stock de vuelta nunca "se queda sin stock", asi
// que no hace falta la misma verificacion, pero se usa increment() igual
// para que sea seguro si 2 devoluciones del mismo producto pasan a la vez.
async function devolverStockSeguro(clienteId, itemsDevueltos) {
  for (const it of itemsDevueltos) {
    if (!it.producto_id) continue;
    const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
    const ref = FirebaseSync.doc(db, 'negocios', clienteId, 'productos', it.producto_id);
    await FirebaseSync.updateDoc(ref, { stock: FirebaseSync.increment(cantidadReal) });
  }
}

// ============================================================================
// FASE 2 - Presentaciones, promociones, combos, historial de precios. Mismo
// patron que productos: escucha en vivo + cache en memoria, filtrado del
// lado del cliente cuando hace falta (por producto_id, etc.) en vez de
// hacer una consulta nueva a Firestore cada vez.
// ============================================================================

function _crearColeccionEnVivo(nombreColeccion) {
  let unsubscribe = null;
  let cache = null;
  return {
    iniciar(clienteId, alActualizar) {
      if (unsubscribe) unsubscribe();
      const col = FirebaseSync.collection(db, 'negocios', clienteId, nombreColeccion);
      unsubscribe = FirebaseSync.onSnapshot(col, (snap) => {
        const items = [];
        snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
        cache = items;
        if (alActualizar) alActualizar();
      }, (error) => console.warn(`Error escuchando ${nombreColeccion}:`, error.message));
      return unsubscribe;
    },
    activa: () => cache !== null,
    listar: () => cache || [],
    async crear(clienteId, datos) {
      const col = FirebaseSync.collection(db, 'negocios', clienteId, nombreColeccion);
      const ref = await FirebaseSync.addDoc(col, datos);
      return ref.id;
    },
    async editar(clienteId, id, cambios) {
      const ref = FirebaseSync.doc(db, 'negocios', clienteId, nombreColeccion, id);
      await FirebaseSync.updateDoc(ref, cambios);
    },
  };
}

const _presentaciones = _crearColeccionEnVivo('presentaciones');
const _promociones = _crearColeccionEnVivo('promociones');
const _combos = _crearColeccionEnVivo('combos');
const _historialPrecios = _crearColeccionEnVivo('historial_precios');

function iniciarEscuchaPresentaciones(clienteId, alActualizar) { return _presentaciones.iniciar(clienteId, alActualizar); }
function listarPresentacionesRemoto() { return _presentaciones.listar(); }
async function crearPresentacionRemota(clienteId, datos) { return await _presentaciones.crear(clienteId, datos); }

function iniciarEscuchaPromociones(clienteId, alActualizar) { return _promociones.iniciar(clienteId, alActualizar); }
function listarPromocionesRemoto() { return _promociones.listar(); }
async function crearPromocionRemota(clienteId, datos) { return await _promociones.crear(clienteId, datos); }

function iniciarEscuchaCombos(clienteId, alActualizar) { return _combos.iniciar(clienteId, alActualizar); }
function listarCombosRemoto() { return _combos.listar(); }
async function crearComboRemoto(clienteId, datos) { return await _combos.crear(clienteId, datos); }

function iniciarEscuchaHistorialPrecios(clienteId, alActualizar) { return _historialPrecios.iniciar(clienteId, alActualizar); }
function listarHistorialPreciosRemoto() { return _historialPrecios.listar(); }
async function crearHistorialPrecioRemoto(clienteId, datos) { return await _historialPrecios.crear(clienteId, datos); }

// ============================================================================
// FASE 3 - Ventas centralizadas. A diferencia de productos, NO usa una
// escucha en vivo permanente - las ventas crecen sin parar con el tiempo,
// asi que "escuchar todas para siempre" saldria caro con el tiempo. En vez
// de eso, se consulta por rango de fechas cada vez que se abre Historial o
// se necesita un reporte - igual que ya funciona el filtro de periodo hoy,
// solo que ahora la consulta la hace Firestore, no un filtro local.
// ============================================================================

async function crearVentaRemota(clienteId, venta) {
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'ventas');
  const ref = await FirebaseSync.addDoc(col, venta);
  return ref.id;
}

// desde/hasta en formato YYYY-MM-DD, o null para "todo" (sin acotar - se
// usa poco, solo cuando alguien elige explicitamente "Todo" el historial).
async function listarVentasRemoto(clienteId, desde, hasta) {
  const col = FirebaseSync.collection(db, 'negocios', clienteId, 'ventas');
  let consulta = col;
  if (desde && hasta) {
    consulta = FirebaseSync.query(col,
      FirebaseSync.where('fecha', '>=', desde + 'T00:00:00'),
      FirebaseSync.where('fecha', '<=', hasta + 'T23:59:59'));
  }
  const snap = await FirebaseSync.getDocs(consulta);
  const ventas = [];
  snap.forEach((doc) => ventas.push({ id: doc.id, ...doc.data() }));
  return ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function obtenerVentaRemota(clienteId, ventaId) {
  const ref = FirebaseSync.doc(db, 'negocios', clienteId, 'ventas', ventaId);
  const snap = await FirebaseSync.getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function agregarDevolucionAVenta(clienteId, ventaId, devolucion) {
  const ref = FirebaseSync.doc(db, 'negocios', clienteId, 'ventas', ventaId);
  await FirebaseSync.updateDoc(ref, { devoluciones: FirebaseSync.arrayUnion(devolucion) });
}

// ============================================================================
// EQUIPOS VINCULADOS - reemplaza el viejo sistema de invitaciones/
// confirmaciones firmadas con HMAC (que se diseño antes de tener Firestore
// como fuente de verdad). Ahora el maestro escribe una invitacion pendiente
// directo en Firestore, el equipo nuevo confirma directo en Firestore, sin
// firmar nada - igual que ya funciona con usuarios y carritos. Ademas, esto
// le da a Nacho visibilidad real desde App Soporte de cuantos equipos tiene
// cada cliente y cuales son (antes esa lista solo vivia en el celular
// maestro, sin respaldo en ningun lado).
// ============================================================================

async function generarInvitacionRemota(clienteId) {
  const codigo = `IHINV-${clienteId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos_pendientes', codigo);
  await FirebaseSync.setDoc(ref, { fecha_generado: FirebaseSync.serverTimestamp() });
  return codigo;
}

async function validarInvitacionRemota(codigo) {
  const raw = (codigo || '').trim().toUpperCase().replace(/\s/g, '');
  const partes = raw.split('-');
  if (partes[0] !== 'IHINV' || partes.length < 3) return [null, 'Formato inválido'];
  const clienteId = partes.slice(1, -1).join('-'); // el cliente_id puede tener guiones adentro
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos_pendientes', raw);
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) return [null, 'Invitación inválida, ya usada, o expirada'];
  return [{ cliente_id: clienteId, codigo_invitacion: raw }, 'OK'];
}

async function confirmarEquipoRemoto(clienteId, deviceId, nombreEquipo, codigoInvitacion) {
  const refEquipo = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos', deviceId);
  await FirebaseSync.setDoc(refEquipo, {
    nombre_equipo: nombreEquipo, fecha_confirmado: FirebaseSync.serverTimestamp(),
  });
  // La invitacion ya se uso - se borra para que nadie mas la pueda reusar.
  if (codigoInvitacion) {
    const refInv = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos_pendientes', codigoInvitacion);
    await FirebaseSync.deleteDoc(refInv);
  }
}

async function listarEquiposRemoto(clienteId) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'equipos');
  const snap = await FirebaseSync.getDocs(col);
  const equipos = [];
  snap.forEach((doc) => equipos.push({ device_id: doc.id, ...doc.data() }));
  return equipos;
}

async function soltarEquipoRemoto(clienteId, deviceId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos', deviceId);
  await FirebaseSync.deleteDoc(ref);
}

async function registrarEsteEquipo(clienteId, deviceId, nombreEquipo) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'equipos', deviceId);
  await FirebaseSync.setDoc(ref, { nombre_equipo: nombreEquipo, fecha_confirmado: FirebaseSync.serverTimestamp() });
}

function hayCupoDisponibleRemoto(cliente, equiposActuales) {
  return equiposActuales.length < (cliente.capacidad || 2);
}
