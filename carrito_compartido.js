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
// intentar loguear a nadie) - deja _cacheUsuarios lista para consultar. Los
// usuarios son del CLIENTE entero (2026-09-15: antes de cada local por
// separado - se corrigió porque, para que "cualquier equipo sirva para
// cualquier local" funcione, hace falta poder encontrar a un usuario por
// nombre ANTES de saber en qué local va a trabajar - si estuvieran
// separados por local no habría forma de buscarlo sin adivinar primero
// dónde está). Cada usuario tiene un campo negocio_id (el local "de
// origen") y locales_permitidos (en cuáles puede trabajar) - mismo
// esquema que ya usa Parking con estacionamiento_id.
function iniciarEscuchaUsuarios(clienteId, alListo) {
  if (unsubscribeUsuarios) unsubscribeUsuarios();
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'usuarios');
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
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'usuarios');
  const consulta = FirebaseSync.query(col, FirebaseSync.where('nombre', '==', nombre), FirebaseSync.where('activo', '==', true));
  const snap = await FirebaseSync.getDocs(consulta);
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function crearUsuarioRemoto(clienteId, datos) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'usuarios');
  const ref = await FirebaseSync.addDoc(col, { ...datos, activo: true });
  incrementarUsoDiario(clienteId, 'usuario_creado');
  return ref.id;
}

async function editarUsuarioRemoto(clienteId, usuarioId, cambios) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'usuarios', usuarioId);
  await FirebaseSync.updateDoc(ref, cambios);
  incrementarUsoDiario(clienteId, 'usuario_editado');
}

// ============================================================================
// SEÑAL DE CIERRE DEL MAESTRO - si el equipo maestro cierra sesion, los
// equipos sub se enteran y cierran la suya tambien, solos. Simple a
// proposito: un campo con la hora del ultimo cierre, todos escuchando.
// ============================================================================

let unsubscribeCierreMaestro = null;

async function avisarCierreDeSesionMaestro(clienteId, negocioId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId);
  await FirebaseSync.setDoc(ref, { ultimo_cierre_maestro: FirebaseSync.serverTimestamp() }, { merge: true });
}

// callback() se llama SOLO cuando aparece un cierre NUEVO (no en el primer
// valor que ya hubiera de antes) - asi un equipo que recien se conecta no se
// cierra solo por un aviso viejo de la ultima vez que el maestro cerro.
function escucharCierreDeSesionMaestro(clienteId, negocioId, callback) {
  if (unsubscribeCierreMaestro) unsubscribeCierreMaestro();
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId);
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

// Lista los locales del cliente (lectura puntual, no listener) - la usa el
// selector de local al loguearse (resolverLocalYCompletarLogin) y la
// pantalla de permisos de usuario (¿en qué otros locales puede trabajar?).
async function listarNegociosRemoto(clienteId) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios');
  const snap = await FirebaseSync.getDocs(col);
  const items = [];
  snap.forEach((doc) => items.push({ negocio_id: doc.id, ...doc.data() }));
  return items.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
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

// Parseo del codigo de activacion "CLI-XXXXXXXXXX#N1" (cliente + local) -
// mismo formato exacto que usa Parking para cliente+sede.
function parsearCodigoNegocio(codigo) {
  const raw = (codigo || '').trim().toUpperCase().replace(/\s/g, '');
  if (!raw.startsWith('CLI-') || !raw.includes('#')) return null;
  const [clienteId, negocioId] = raw.split('#');
  if (!clienteId || !negocioId) return null;
  return { clienteId, negocioId };
}

// Version para ACTIVAR un equipo (a diferencia de obtenerNegocioRemoto, que
// asume que el local existe y solo trae su config) - devuelve [null, msg]
// si no existe, igual que obtenerEstacionamientoRemoto en Parking.
async function obtenerNegocioParaActivarRemoto(clienteId, negocioId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId);
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) return [null, 'Ese local no existe o fue eliminado.'];
  return [{ negocio_id: snap.id, ...snap.data() }, 'OK'];
}

// Codigo de "primer ingreso" que genera Manager IH al pre-crear un jefe (o
// cualquier usuario) para un cliente todavia sin activar - ver
// CONTEXTO_HANDOFF_JEFE_QR.md. Formato real (confirmado contra el codigo de
// Manager IH, `carrito_compartido.js` de app_soporte, funcion
// crearJefeRemoto): "{clienteId}#{negocioId}#{usuarioId}" - 3 partes, NO 2
// como decia la primera version del handoff.
//
// OJO con las mayusculas: clienteId y negocioId son codigos cortos que
// siempre van en mayuscula (obtenerClienteRemoto ya asume esto, y
// generarNegocioId en Manager IH arma "N1"/"N2" directamente en mayuscula),
// pero usuarioId es un id automatico de Firestore (mayusculas Y minusculas
// mezcladas) - pasarlo por .toUpperCase() como hace parsearCodigoNegocio
// con el codigo completo lo hubiera roto, buscando un documento que no
// existe con ese casing. Por eso esta funcion NO uppercasea el string
// entero de una, solo los 2 primeros segmentos.
function parsearCodigoUsuarioDirecto(codigo) {
  const raw = (codigo || '').trim();
  const mayus = raw.toUpperCase();
  if (mayus.startsWith('CLI-') || mayus.startsWith('IHINV-')) return null;
  const partes = raw.split('#');
  if (partes.length !== 3) return null;
  const [clienteId, negocioId, usuarioId] = partes;
  if (!clienteId || !negocioId || !usuarioId) return null;
  return { clienteId: clienteId.toUpperCase(), negocioId: negocioId.toUpperCase(), usuarioId };
}

// Lectura puntual del usuario ANTES de que exista sesion (misma idea que
// obtenerClienteRemoto/obtenerNegocioParaActivarRemoto) - hace de chequeo de
// seguridad real, no solo de conveniencia: si el usuario ya eligio su clave
// definitiva (clave_temporal ya en false) o fue dado de baja, este codigo NO
// debe volver a meter a nadie automatico - la persona cae al login normal
// de nombre+clave, como pide el handoff.
async function obtenerUsuarioParaActivarRemoto(clienteId, usuarioId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'usuarios', usuarioId);
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) return [null, 'Este código ya no es válido — pide uno nuevo.'];
  const usuario = { id: snap.id, ...snap.data() };
  if (usuario.activo === false) return [null, 'Este usuario fue dado de baja.'];
  if (!usuario.clave_temporal) return [null, 'Este código ya se usó — inicia sesión con tu nombre y tu clave.'];
  return [usuario, 'OK'];
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
// nuevo. Via de UNA SOLA MANO: el cliente solo puede PROPONER (escribir en su
// propio biblioteca_pendiente) - nunca leer la biblioteca compartida en si.
// Nacho es el unico que consulta/revisa/reparte desde Manager IH o Indexer
// (ambos autenticados) - por eso esta funcion NO tiene una busqueda directa a
// biblioteca_productos, a proposito (esa lectura la bloquean tambien las
// reglas de Firestore para quien no esta autenticado).
// ============================================================================

// El cliente propone un producto nuevo - NO se sube directo a la biblioteca
// general, queda pendiente de revision de Nacho, bajo el cliente que lo
// mando. No hay forma de saber desde aca si el codigo ya estaba en la
// biblioteca (el cliente no puede consultarla) - si ya estaba, Nacho
// simplemente descarta la propuesta duplicada al revisarla.
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

function iniciarEscuchaProductos(clienteId, negocioId, alActualizar) {
  if (unsubscribeProductos) unsubscribeProductos();
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'productos');
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

async function crearProductoRemoto(clienteId, negocioId, datos) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'productos');
  const ref = await FirebaseSync.addDoc(col, datos);
  return ref.id;
}

async function editarProductoRemoto(clienteId, negocioId, productoId, cambios) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'productos', productoId);
  await FirebaseSync.updateDoc(ref, cambios);
}

// La pieza clave de seguridad: descuenta stock de VARIOS productos a la vez,
// de forma atomica - si CUALQUIERA de los items no tiene stock suficiente en
// el momento exacto de confirmar (alguien mas se lo llevo mientras tanto),
// TODA la venta se cancela junta, no se descuenta ninguno a medias. Firestore
// reintenta esta funcion sola si otro dispositivo escribio el mismo producto
// justo al mismo tiempo (eso es lo que hace que sea "atomico" de verdad).
// Un item de combo no tiene producto_id propio (representa varios productos
// a la vez - ver aplicarCombo en panel.html, que guarda producto_id:null y
// productos_combo:[...]) - hay que "abrirlo" a los productos reales que lo
// componen antes de tocar el stock, o una venta de combo nunca descontaba
// nada (bug real encontrado en QA, ninguna venta de combo movio el stock).
function _aplanarItemsParaStock(items) {
  const porProducto = new Map();
  for (const it of items) {
    if (it.es_combo && it.productos_combo) {
      for (const productoId of it.productos_combo) {
        if (!productoId) continue;
        const actual = porProducto.get(productoId) || { nombre: it.nombre, cantidad: 0 };
        actual.cantidad += it.cantidad;
        porProducto.set(productoId, actual);
      }
    } else if (it.producto_id) {
      const cantidadReal = it.cantidad * (it.cantidad_base_presentacion || 1);
      const actual = porProducto.get(it.producto_id) || { nombre: it.nombre, cantidad: 0 };
      actual.cantidad += cantidadReal;
      porProducto.set(it.producto_id, actual);
    }
  }
  return porProducto;
}

async function venderConTransaccionSegura(clienteId, negocioId, itemsVendidos) {
  const porProducto = _aplanarItemsParaStock(itemsVendidos);
  await FirebaseSync.runTransaction(db, async (transaccion) => {
    const refs = Array.from(porProducto.entries()).map(([productoId, datos]) => ({
      productoId, ...datos, ref: FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'productos', productoId),
    }));

    // TODAS las lecturas de una transaccion tienen que pasar antes que
    // cualquier escritura - regla de Firestore, no se pueden mezclar.
    const snapshots = await Promise.all(refs.map((r) => transaccion.get(r.ref)));

    for (let i = 0; i < refs.length; i++) {
      const snap = snapshots[i];
      const r = refs[i];
      if (!snap.exists()) throw new Error(`El producto "${r.nombre}" ya no existe.`);
      const stockActual = Number(snap.data().stock) || 0;
      if (stockActual < r.cantidad) {
        throw new Error(`No hay suficiente stock de "${r.nombre}" — quedan ${stockActual}, se intentaron vender ${r.cantidad}.`);
      }
    }
    for (let i = 0; i < refs.length; i++) {
      transaccion.update(refs[i].ref, { stock: FirebaseSync.increment(-refs[i].cantidad) });
    }
  });
}

// Para devoluciones - sumar stock de vuelta nunca "se queda sin stock", asi
// que no hace falta la misma verificacion, pero se usa increment() igual
// para que sea seguro si 2 devoluciones del mismo producto pasan a la vez.
async function devolverStockSeguro(clienteId, negocioId, itemsDevueltos) {
  const porProducto = _aplanarItemsParaStock(itemsDevueltos);
  for (const [productoId, datos] of porProducto.entries()) {
    const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'productos', productoId);
    await FirebaseSync.updateDoc(ref, { stock: FirebaseSync.increment(datos.cantidad) });
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
    iniciar(clienteId, negocioId, alActualizar) {
      if (unsubscribe) unsubscribe();
      const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion);
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
    async crear(clienteId, negocioId, datos) {
      const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion);
      const ref = await FirebaseSync.addDoc(col, datos);
      return ref.id;
    },
    async editar(clienteId, negocioId, id, cambios) {
      const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion, id);
      await FirebaseSync.updateDoc(ref, cambios);
    },
  };
}

const _presentaciones = _crearColeccionEnVivo('presentaciones');
const _promociones = _crearColeccionEnVivo('promociones');
const _combos = _crearColeccionEnVivo('combos');
const _historialPrecios = _crearColeccionEnVivo('historial_precios');

function iniciarEscuchaPresentaciones(clienteId, negocioId, alActualizar) { return _presentaciones.iniciar(clienteId, negocioId, alActualizar); }
function listarPresentacionesRemoto() { return _presentaciones.listar(); }
async function crearPresentacionRemota(clienteId, negocioId, datos) { return await _presentaciones.crear(clienteId, negocioId, datos); }

function iniciarEscuchaPromociones(clienteId, negocioId, alActualizar) { return _promociones.iniciar(clienteId, negocioId, alActualizar); }
function listarPromocionesRemoto() { return _promociones.listar(); }
async function crearPromocionRemota(clienteId, negocioId, datos) { return await _promociones.crear(clienteId, negocioId, datos); }

function iniciarEscuchaCombos(clienteId, negocioId, alActualizar) { return _combos.iniciar(clienteId, negocioId, alActualizar); }
function listarCombosRemoto() { return _combos.listar(); }
async function crearComboRemoto(clienteId, negocioId, datos) { return await _combos.crear(clienteId, negocioId, datos); }

function iniciarEscuchaHistorialPrecios(clienteId, negocioId, alActualizar) { return _historialPrecios.iniciar(clienteId, negocioId, alActualizar); }
function listarHistorialPreciosRemoto() { return _historialPrecios.listar(); }
async function crearHistorialPrecioRemoto(clienteId, negocioId, datos) { return await _historialPrecios.crear(clienteId, negocioId, datos); }

// ============================================================================
// Respaldo completo (exportar/restaurar) - lectura/escritura directa de
// TODOS los documentos de una coleccion, sin pasar por el cache de las
// escuchas en vivo de arriba (para no depender de que ya esten activas).
// Se usa desde exportarRespaldoCompleto/restaurarRespaldoCompleto en datos.js.
// ============================================================================

async function listarColeccionCompletaRemoto(clienteId, negocioId, nombreColeccion) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion);
  const snap = await FirebaseSync.getDocs(col);
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items;
}

// Borra todo lo que haya HOY en la coleccion y lo reemplaza por "filas",
// respetando el id original de cada fila (para no romper referencias
// cruzadas entre colecciones, ej: historial_precios -> producto_id).
async function restaurarColeccionCompletaRemoto(clienteId, negocioId, nombreColeccion, filas) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion);
  const existentes = await FirebaseSync.getDocs(col);
  for (const doc of existentes.docs) await FirebaseSync.deleteDoc(doc.ref);
  for (const fila of filas) {
    const { id, ...campos } = fila;
    const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, nombreColeccion, id);
    await FirebaseSync.setDoc(ref, campos);
  }
}

// Turnos de caja (apertura/cierre) - antes vivian SOLO en el IndexedDB de
// cada celular (sin historial, sin verse entre equipos ni desde Manager
// IH). Mismo patron de coleccion en vivo que productos/promociones/etc.
const _turnos = _crearColeccionEnVivo('turnos');
function iniciarEscuchaTurnos(clienteId, negocioId, alActualizar) { return _turnos.iniciar(clienteId, negocioId, alActualizar); }
function listarTurnosRemoto() { return _turnos.listar(); }
async function crearTurnoRemoto(clienteId, negocioId, datos) { return await _turnos.crear(clienteId, negocioId, datos); }
async function editarTurnoRemoto(clienteId, negocioId, id, cambios) { return await _turnos.editar(clienteId, negocioId, id, cambios); }

// ============================================================================
// FASE 3 - Ventas centralizadas. A diferencia de productos, NO usa una
// escucha en vivo permanente - las ventas crecen sin parar con el tiempo,
// asi que "escuchar todas para siempre" saldria caro con el tiempo. En vez
// de eso, se consulta por rango de fechas cada vez que se abre Historial o
// se necesita un reporte - igual que ya funciona el filtro de periodo hoy,
// solo que ahora la consulta la hace Firestore, no un filtro local.
// ============================================================================

async function crearVentaRemota(clienteId, negocioId, venta) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'ventas');
  const ref = await FirebaseSync.addDoc(col, venta);
  return ref.id;
}

// desde/hasta en formato YYYY-MM-DD, o null para "todo" (sin acotar - se
// usa poco, solo cuando alguien elige explicitamente "Todo" el historial).
async function listarVentasRemoto(clienteId, negocioId, desde, hasta) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'ventas');
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

async function obtenerVentaRemota(clienteId, negocioId, ventaId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'ventas', ventaId);
  const snap = await FirebaseSync.getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function agregarDevolucionAVenta(clienteId, negocioId, ventaId, devolucion) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'ventas', ventaId);
  await FirebaseSync.updateDoc(ref, { devoluciones: FirebaseSync.arrayUnion(devolucion) });
}

async function editarVentaRemota(clienteId, negocioId, ventaId, cambios) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'ventas', ventaId);
  await FirebaseSync.updateDoc(ref, cambios);
}

// Movimientos de inventario (ajustes de stock) - igual concepto que la tabla
// del mismo nombre en Minimarket Pro (el exe): un ajuste SIEMPRE tiene
// motivo, y no se puede tocar el stock de otra forma que no sea vendiendo,
// devolviendo, o por esta via (ver ajustarStockProducto en datos.js). Mismo
// patron que ventas: sin escucha permanente, por rango de fecha.
async function crearMovimientoInventarioRemoto(clienteId, negocioId, datos) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'movimientos_inventario');
  const ref = await FirebaseSync.addDoc(col, datos);
  return ref.id;
}
async function listarMovimientosInventarioRemoto(clienteId, negocioId, desde, hasta) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'movimientos_inventario');
  let consulta = col;
  if (desde && hasta) {
    consulta = FirebaseSync.query(col,
      FirebaseSync.where('fecha', '>=', desde + 'T00:00:00'),
      FirebaseSync.where('fecha', '<=', hasta + 'T23:59:59'));
  }
  const snap = await FirebaseSync.getDocs(consulta);
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// Facturas de proveedor (mercadería que llega) - mismo patrón que
// movimientos_inventario. Antes vivían solo en IndexedDB del celular (bug
// real encontrado en QA: ni siquiera guardaba nada, tiraba error apenas se
// tocaba "Guardar factura" - ver crearFactura en datos.js), sin sincronizar
// entre equipos ni quedar con historial real. Ahora en Firestore como todo
// lo demás.
async function crearFacturaRemota(clienteId, negocioId, datos) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'facturas');
  const ref = await FirebaseSync.addDoc(col, datos);
  return ref.id;
}
async function listarFacturasRemoto(clienteId, negocioId) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'facturas');
  const snap = await FirebaseSync.getDocs(col);
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// Caja chica (ingresos/gastos) - mismo bug real que las facturas, mismo
// arreglo: vivía solo en IndexedDB del celular, así que un ingreso
// registrado en una caja nunca lo veía la otra caja del mismo local (cada
// equipo tiene su propio IndexedDB, aislado), y se perdía para siempre si
// se reinstalaba la app o se limpiaba el caché del navegador.
async function crearMovimientoCajaChicaRemoto(clienteId, negocioId, datos) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'caja_chica');
  const ref = await FirebaseSync.addDoc(col, datos);
  return ref.id;
}
async function listarMovimientosCajaChicaRemoto(clienteId, negocioId) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'caja_chica');
  const snap = await FirebaseSync.getDocs(col);
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
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

async function generarInvitacionRemota(clienteId, negocioId) {
  const codigo = `IHINV-${clienteId}#${negocioId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos_pendientes', codigo);
  await FirebaseSync.setDoc(ref, { fecha_generado: FirebaseSync.serverTimestamp() });
  return codigo;
}

const MINUTOS_VENCIMIENTO_INVITACION = 15;

async function validarInvitacionRemota(codigo) {
  const raw = (codigo || '').trim().toUpperCase().replace(/\s/g, '');
  const partes = raw.split('-');
  if (partes[0] !== 'IHINV' || partes.length < 3) return [null, 'Formato inválido'];
  // El medio (clienteId#negocioId) puede tener guiones adentro (el
  // clienteId ya los tiene) - se recupera uniendo todo menos el primer y
  // último trozo, igual que en Parking.
  const claveCompuesta = partes.slice(1, -1).join('-');
  const [clienteId, negocioId] = claveCompuesta.split('#');
  if (!clienteId || !negocioId) return [null, 'Formato inválido'];
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos_pendientes', raw);
  const snap = await FirebaseSync.getDoc(ref);
  if (!snap.exists()) return [null, 'Invitación inválida, ya usada, o expirada'];

  const fechaGenerado = snap.data().fecha_generado;
  const minutosPasados = fechaGenerado ? (Date.now() - fechaGenerado.toMillis()) / 60000 : 0;
  if (minutosPasados > MINUTOS_VENCIMIENTO_INVITACION) {
    return [null, 'Este código ya venció (dura 15 minutos) — pide uno nuevo al equipo principal.'];
  }

  return [{ cliente_id: clienteId, negocio_id: negocioId, codigo_invitacion: raw }, 'OK'];
}

async function confirmarEquipoRemoto(clienteId, negocioId, deviceId, nombreEquipo, codigoInvitacion) {
  const refEquipo = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos', deviceId);
  await FirebaseSync.setDoc(refEquipo, {
    nombre_equipo: nombreEquipo, fecha_confirmado: FirebaseSync.serverTimestamp(),
  });
  // La invitacion ya se uso - se borra para que nadie mas la pueda reusar.
  if (codigoInvitacion) {
    const refInv = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos_pendientes', codigoInvitacion);
    await FirebaseSync.deleteDoc(refInv);
  }
}

async function listarEquiposRemoto(clienteId, negocioId) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos');
  const snap = await FirebaseSync.getDocs(col);
  const equipos = [];
  snap.forEach((doc) => equipos.push({ device_id: doc.id, ...doc.data() }));
  return equipos;
}

async function soltarEquipoRemoto(clienteId, negocioId, deviceId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos', deviceId);
  await FirebaseSync.deleteDoc(ref);
}

async function registrarEsteEquipo(clienteId, negocioId, deviceId, nombreEquipo) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos', deviceId);
  await FirebaseSync.setDoc(ref, { nombre_equipo: nombreEquipo, fecha_confirmado: FirebaseSync.serverTimestamp() });
}

function hayCupoDisponibleRemoto(negocio, equiposActuales) {
  return equiposActuales.length < (negocio.capacidad_equipos || 2);
}

// Escucha en vivo de "clientes/{clienteId}/equipos" para el panel del
// maestro (a diferencia de listarEquiposRemoto arriba, que es una lectura
// unica usada antes de iniciar sesion - ej. para chequear cupo en
// activar.html, donde todavia no hay una sesion activa que mantenga viva
// esta escucha) - asi la lista de "Equipos vinculados" y el cupo se
// actualizan solos cuando otro equipo se suma o se saca, sin que el
// maestro tenga que recargar la pagina o cambiar de pestaña.
let unsubscribeEquiposPanel = null;
let _cacheEquiposPanel = null;

function iniciarEscuchaEquiposPanel(clienteId, negocioId, alActualizar) {
  if (unsubscribeEquiposPanel) unsubscribeEquiposPanel();
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'equipos');
  unsubscribeEquiposPanel = FirebaseSync.onSnapshot(col, (snap) => {
    const equipos = [];
    snap.forEach((doc) => equipos.push({ device_id: doc.id, ...doc.data() }));
    _cacheEquiposPanel = equipos;
    if (alActualizar) alActualizar();
  }, (error) => {
    console.warn('Error escuchando equipos:', error.message);
  });
  return unsubscribeEquiposPanel;
}
function dejarDeEscucharEquiposPanel() {
  if (unsubscribeEquiposPanel) { unsubscribeEquiposPanel(); unsubscribeEquiposPanel = null; }
  _cacheEquiposPanel = null;
}
function equiposPanelEnCache() {
  return _cacheEquiposPanel || [];
}

// ============================================================================
// CONFIGURACION DEL LOCAL (documento raiz clientes/{clienteId}/negocios/
// {negocioId}, no una subcoleccion) - hoy solo se usa para las frecuencias
// del reporte periodico que el jefe elige (diario/semanal/mensual).
// ============================================================================

async function obtenerNegocioRemoto(clienteId, negocioId) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId);
  const snap = await FirebaseSync.getDoc(ref);
  return snap.exists() ? snap.data() : {};
}

async function editarNegocioRemoto(clienteId, negocioId, cambios) {
  const ref = FirebaseSync.doc(db, 'clientes', clienteId, 'negocios', negocioId);
  await FirebaseSync.setDoc(ref, cambios, { merge: true });
}

// ============================================================================
// AUDITORIA DE PERMISOS - registro de cada cambio de permiso que un jefe
// (o delegado) le hace a un usuario, para que aparezca en el reporte
// periodico por correo. NO registra la creacion inicial de un usuario,
// solo cambios posteriores a uno que ya existia.
// ============================================================================

async function registrarCambioPermiso(clienteId, negocioId, { usuarioAfectado, campo, valorAnterior, valorNuevo, hechoPor }) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'auditoria_permisos');
  await FirebaseSync.addDoc(col, {
    usuario_afectado: usuarioAfectado, campo, valor_anterior: valorAnterior, valor_nuevo: valorNuevo,
    hecho_por: hechoPor, fecha: new Date().toISOString(),
  });
}

async function listarAuditoriaPermisos(clienteId, negocioId, desde, hasta) {
  const col = FirebaseSync.collection(db, 'clientes', clienteId, 'negocios', negocioId, 'auditoria_permisos');
  let consulta = col;
  if (desde && hasta) {
    consulta = FirebaseSync.query(col,
      FirebaseSync.where('fecha', '>=', desde + 'T00:00:00'),
      FirebaseSync.where('fecha', '<=', hasta + 'T23:59:59'));
  }
  const snap = await FirebaseSync.getDocs(consulta);
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
