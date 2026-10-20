/* =====================================================
   TrasladosAPI.gs — Control de Traslados (v1)
   Backend de la sección "Control de Traslados" de walterlund-web-tools.

   Vive en un Google Sheet propio ("Control Traslados").
   Pestañas (las crea setup()):
     - Guias  : una fila por guía (cabecera)
     - Lineas : una fila por producto de cada guía

   La web NUNCA llama aquí directo: pasa por /api/traslados (proxy Vercel)
   por el tema CORS.

   GET  ?action=traslados          -> { ok, guias:[...] } con sus líneas
   POST { action:'upsert', guias } -> agrega solo las guías nuevas
                                      (clave = códigoBodegaOrigen|folio)
   ===================================================== */

const VERSION = 'traslados-v1';
const HOJA_GUIAS = 'Guias';
const HOJA_LINEAS = 'Lineas';
const COLS_GUIAS = ['Clave', 'Fecha', 'Folio', 'OrigenCod', 'Origen', 'Destino', 'DestinoRaw', 'Estado', 'Tipo', 'Lineas', 'Valor', 'Cargado'];
const COLS_LINEAS = ['Clave', 'Codigo', 'Descripcion', 'UM', 'Cantidad', 'Precio', 'Total'];

/** Ejecutar UNA VEZ a mano desde el editor: crea las pestañas y deja texto donde corresponde. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  prepararHoja(ss, HOJA_GUIAS, COLS_GUIAS, [1, 2, 3, 4]);   // Clave, Fecha, Folio, OrigenCod como texto
  prepararHoja(ss, HOJA_LINEAS, COLS_LINEAS, [1, 2]);       // Clave, Codigo como texto
  Logger.log('Listo: pestañas Guias y Lineas preparadas (' + VERSION + ')');
}

function prepararHoja(ss, nombre, cols, colsTexto) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // Formato texto en columnas clave: evita que Sheets convierta "2026-01-07" en fecha o "0802" en número
  colsTexto.forEach(c => sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'));
}

// ============ GET ============
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'traslados';
    if (action !== 'traslados') return json({ ok: false, error: 'Acción no válida: ' + action });
    return json({ ok: true, version: VERSION, guias: leerTodo() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function leerTodo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shG = ss.getSheetByName(HOJA_GUIAS), shL = ss.getSheetByName(HOJA_LINEAS);
  if (!shG || !shL) throw new Error('Faltan las pestañas Guias/Lineas: ejecuta setup() una vez');

  const lineasPorClave = {};
  if (shL.getLastRow() > 1) {
    shL.getRange(2, 1, shL.getLastRow() - 1, COLS_LINEAS.length).getValues().forEach(r => {
      const k = String(r[0]);
      (lineasPorClave[k] = lineasPorClave[k] || []).push([String(r[1]), String(r[2]), String(r[3]), num(r[4]), num(r[5]), num(r[6])]);
    });
  }

  if (shG.getLastRow() < 2) return [];
  return shG.getRange(2, 1, shG.getLastRow() - 1, COLS_GUIAS.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({
      k: String(r[0]), fecha: fechaIso(r[1]), folio: String(r[2]), oc: String(r[3]),
      origen: String(r[4]), destino: String(r[5]), destinoRaw: String(r[6]),
      estado: String(r[7]), tipo: String(r[8]), valor: num(r[10]),
      lineas: lineasPorClave[String(r[0])] || []
    }));
}

// ============ POST ============
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.action !== 'upsert') return json({ ok: false, error: 'Acción no válida' });
    return json(upsert(body.guias || []));
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function upsert(guias) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shG = ss.getSheetByName(HOJA_GUIAS), shL = ss.getSheetByName(HOJA_LINEAS);
  if (!shG || !shL) throw new Error('Faltan las pestañas Guias/Lineas: ejecuta setup() una vez');

  const existentes = new Set();
  if (shG.getLastRow() > 1) {
    shG.getRange(2, 1, shG.getLastRow() - 1, 1).getValues().forEach(r => existentes.add(String(r[0])));
  }

  const ahora = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd HH:mm');
  const filasG = [], filasL = [];
  let repetidas = 0;

  guias.forEach(g => {
    const k = String(g.k || '');
    if (!k || existentes.has(k)) { repetidas++; return; }
    existentes.add(k);
    const lineas = Array.isArray(g.lineas) ? g.lineas : [];
    const valor = lineas.reduce((s, l) => s + num(l[5]), 0);
    filasG.push([k, String(g.fecha), String(g.folio), String(g.oc), g.origen || '', g.destino || '', g.destinoRaw || '',
      g.estado || '', g.tipo || '', lineas.length, valor, ahora]);
    lineas.forEach(l => filasL.push([k, String(l[0]), String(l[1] || ''), String(l[2] || ''), num(l[3]), num(l[4]), num(l[5])]));
  });

  escribir(shG, filasG, COLS_GUIAS.length, 4);   // primeras 4 columnas como texto
  escribir(shL, filasL, COLS_LINEAS.length, 2);   // Clave y Codigo como texto

  return { ok: true, nuevas: filasG.length, lineas: filasL.length, repetidas: repetidas };
}

// Agrega filas al final asegurando espacio y formato texto en las primeras columnas
function escribir(sh, filas, nCols, nTexto) {
  if (!filas.length) return;
  const desde = sh.getLastRow() + 1;
  const falta = desde + filas.length - 1 - sh.getMaxRows();
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta);
  sh.getRange(desde, 1, filas.length, nTexto).setNumberFormat('@');
  sh.getRange(desde, 1, filas.length, nCols).setValues(filas);
}

// ============ UTIL ============
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function fechaIso(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
  return String(v);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
