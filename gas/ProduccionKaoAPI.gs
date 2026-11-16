/**
 * ProduccionKaoAPI.gs — Base de datos de la sección "Producción / Kao Chimigraf".
 *
 * INSTALACIÓN (una vez):
 *  1. Crea una Google Sheet nueva llamada "Producción Kao" (vacía).
 *  2. Extensiones → Apps Script → pega este archivo completo y guarda.
 *  3. Implementar → Nueva implementación → Tipo: Aplicación web
 *       Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 *  4. Copia la URL que termina en /exec y pégala en api/kao.js (APPS_SCRIPT_URL).
 *  5. Abre la web → Producción → Kao Chimigraf → botón "Cargar datos iniciales".
 *     Eso llena las hojas con el maestro, las fórmulas y las producciones 2026.
 *
 * Hojas que crea solas: Materias, Colores, Formulas, Producciones, Config.
 * Se pueden mirar en Sheets, pero se editan desde la web.
 */

const HOJAS = {
  Materias: ['id', 'codigo', 'origen', 'descripcion', 'usd', 'tipo', 'activo'],
  Colores: ['id', 'codigo', 'nombre', 'archivo', 'cliente', 'precio', 'estado', 'envase_mp', 'envase_kg', 'notas'],
  Formulas: ['color_id', 'mp_id', 'pct'],
  Producciones: ['id', 'fecha', 'folio', 'codigo', 'descripcion', 'kg', 'pu', 'total', 'cliente', 'origen', 'obs'],
  Config: ['clave', 'valor']
};

function hoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // códigos y folios como texto, para que Sheets no los convierta en números
    const txt = { Materias: [2], Colores: [2], Producciones: [3, 4] }[nombre] || [];
    txt.forEach(c => sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@'));
  }
  return sh;
}

function leer_(nombre) {
  const sh = hoja_(nombre);
  const v = sh.getDataRange().getValues();
  const cab = v.shift() || HOJAS[nombre];
  return v.filter(f => f.some(c => c !== '')).map(f => {
    const o = {};
    cab.forEach((k, i) => { o[k] = f[i] instanceof Date ? Utilities.formatDate(f[i], 'America/Santiago', 'yyyy-MM-dd') : f[i]; });
    return o;
  });
}

function escribir_(nombre, objs) {
  const sh = hoja_(nombre);
  const cab = HOJAS[nombre];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).clearContent();
  if (!objs.length) return;
  sh.getRange(2, 1, objs.length, cab.length).setValues(objs.map(o => cab.map(k => o[k] === undefined || o[k] === null ? '' : o[k])));
}

function upsert_(nombre, obj, key) {
  const sh = hoja_(nombre);
  const cab = HOJAS[nombre];
  const k = cab.indexOf(key || 'id');
  const n = sh.getLastRow() - 1;
  const ids = n > 0 ? sh.getRange(2, k + 1, n, 1).getValues().map(f => String(f[0])) : [];
  const fila = cab.map(c => obj[c] === undefined || obj[c] === null ? '' : obj[c]);
  const i = ids.indexOf(String(obj[key || 'id']));
  if (i >= 0) sh.getRange(i + 2, 1, 1, cab.length).setValues([fila]);
  else sh.appendRow(fila);
}

function borrar_(nombre, pred) {
  const sh = hoja_(nombre);
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (pred(v[i], v[0])) sh.deleteRow(i + 1);
}

function todo_() {
  const formulas = leer_('Formulas');
  const porColor = {};
  formulas.forEach(f => (porColor[f.color_id] = porColor[f.color_id] || []).push({ mp: String(f.mp_id), pct: Number(f.pct) }));
  const config = {};
  leer_('Config').forEach(c => { config[c.clave] = c.valor; });
  return {
    ok: true,
    config,
    materias: leer_('Materias').map(m => ({ ...m, id: String(m.id), codigo: String(m.codigo), usd: m.usd === '' ? null : Number(m.usd), activo: m.activo !== false && m.activo !== 'NO' })),
    colores: leer_('Colores').map(c => ({
      id: String(c.id), codigo: String(c.codigo), nombre: c.nombre, archivo: c.archivo, cliente: c.cliente,
      precio: c.precio === '' ? null : Number(c.precio), estado: c.estado || '', notas: c.notas || '',
      envase: c.envase_mp ? { mp: String(c.envase_mp), kg: Number(c.envase_kg) || 1 } : null,
      formula: porColor[c.id] || []
    })),
    producciones: leer_('Producciones').map(p => ({ ...p, id: String(p.id), folio: String(p.folio), codigo: String(p.codigo), kg: Number(p.kg), pu: Number(p.pu), total: Number(p.total) }))
  };
}

function guardarColor_(c) {
  upsert_('Colores', {
    id: c.id, codigo: c.codigo || '', nombre: c.nombre, archivo: c.archivo || '', cliente: c.cliente || '',
    precio: c.precio === null || c.precio === undefined ? '' : c.precio, estado: c.estado || '',
    envase_mp: c.envase ? c.envase.mp : '', envase_kg: c.envase ? c.envase.kg : '', notas: c.notas || ''
  });
  if (c.formula) {
    borrar_('Formulas', f => String(f[0]) === String(c.id));
    const sh = hoja_('Formulas');
    const filas = c.formula.filter(f => f.mp && Number(f.pct)).map(f => [c.id, f.mp, Number(f.pct)]);
    if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, 3).setValues(filas);
  }
}

const claveProd_ = p => [p.folio, p.codigo, Number(p.kg)].join('|');

function doGet() {
  return json_(todo_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = JSON.parse(e.postData.contents || '{}');
    switch (b.action) {
      case 'seed': {
        if (leer_('Colores').length && !b.forzar) return json_({ ok: false, error: 'La base ya tiene datos. Usa forzar para reemplazar.' });
        const d = b.data;
        escribir_('Materias', d.materias.map(m => ({ ...m, activo: m.activo === false ? 'NO' : 'SI' })));
        escribir_('Colores', []); escribir_('Formulas', []);
        escribir_('Colores', d.colores.map(c => ({ ...c, envase_mp: c.envase ? c.envase.mp : '', envase_kg: c.envase ? c.envase.kg : '' })));
        const ff = [];
        d.colores.forEach(c => (c.formula || []).forEach(f => ff.push({ color_id: c.id, mp_id: f.mp, pct: f.pct })));
        escribir_('Formulas', ff);
        escribir_('Producciones', d.producciones.map((p, i) => ({ ...p, id: p.id || 'P' + (i + 1) })));
        escribir_('Config', Object.keys(d.config || {}).map(k => ({ clave: k, valor: d.config[k] })));
        return json_({ ok: true });
      }
      case 'guardarMateria':
        upsert_('Materias', { ...b.item, activo: b.item.activo === false ? 'NO' : 'SI' });
        return json_({ ok: true });
      case 'guardarColor':
        guardarColor_(b.item);
        return json_({ ok: true });
      case 'borrarColor':
        borrar_('Colores', f => String(f[0]) === String(b.id));
        borrar_('Formulas', f => String(f[0]) === String(b.id));
        return json_({ ok: true });
      case 'importarProducciones': {
        const ya = new Set(leer_('Producciones').map(claveProd_));
        const nuevas = (b.items || []).filter(p => !ya.has(claveProd_(p)));
        const sh = hoja_('Producciones');
        const cab = HOJAS.Producciones;
        const base = Date.now();
        const filas = nuevas.map((p, i) => cab.map(k => k === 'id' ? 'P' + base + '-' + i : (p[k] === undefined ? '' : p[k])));
        if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, cab.length).setValues(filas);
        return json_({ ok: true, nuevas: filas.length, repetidas: (b.items || []).length - filas.length });
      }
      case 'guardarProduccion': {
        const p = b.item;
        if (!p.id) p.id = 'P' + Date.now();
        upsert_('Producciones', p);
        return json_({ ok: true, id: p.id });
      }
      case 'asignarClientes': { // [{id, cliente}]
        const sh = hoja_('Producciones');
        const n = sh.getLastRow() - 1;
        if (n > 0) {
          const col = HOJAS.Producciones.indexOf('cliente') + 1;
          const ids = sh.getRange(2, 1, n, 1).getValues().map(f => String(f[0]));
          const rango = sh.getRange(2, col, n, 1);
          const vals = rango.getValues();
          (b.items || []).forEach(x => { const i = ids.indexOf(String(x.id)); if (i >= 0) vals[i][0] = x.cliente; });
          rango.setValues(vals);
        }
        return json_({ ok: true });
      }
      case 'borrarProduccion':
        borrar_('Producciones', f => String(f[0]) === String(b.id));
        return json_({ ok: true });
      case 'guardarConfig':
        Object.keys(b.config || {}).forEach(k => upsert_('Config', { clave: k, valor: b.config[k] }, 'clave'));
        return json_({ ok: true });
      default:
        return json_({ ok: false, error: 'Acción no válida: ' + b.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
