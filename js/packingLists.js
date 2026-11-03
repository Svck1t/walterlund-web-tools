// =====================================================
// SECCIÓN: PACKING LISTS — v3.2 (cruce tolera N° sin dígito verificador)
// Fuente: planilla "Packing Lists" (PL_Cabecera + PL_Detalle) vía /api/packing-lists
// Cruza con Importaciones para proveedor, orden, llegada, estado, GE y bodega
// Regla: GE y Bodega destino se toman SIEMPRE de Importaciones (hoja espejo).
//        Lo guardado en el PL solo se usa si el contenedor no aparece en Importaciones.
// =====================================================

// Lee un Excel con el formato de planilla de packing lists (bloques por contenedor)
// y devuelve un packing list por contenedor con la misma estructura que usa la web:
// { c, g:[], b, f:'pallet'|'bulto'|'simple', lb, lc, l:[[cod, prod, nPallet, kg, bultos, unXbulto, cantidad, vb, costo]] }
const PLImportParser = (() => {
  const T = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const K = v => T(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normC = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const n = v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = T(v); if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const x = Number(s); return isNaN(x) ? null : x;
  };
  // Dígito verificador ISO 6346 (para completar números de 10 caracteres)
  const ISO = 'A10B12C13D14E15F16G17H18I19J20K21L23M24N25O26P27Q28R29S30T31U32V34W35X36Y37Z38';
  function digito(c10) {
    let s = 0;
    for (let i = 0; i < 10; i++) {
      const ch = c10[i], k = ISO.indexOf(ch);
      const v = /\d/.test(ch) ? Number(ch) : Number(ISO.substr(k + 1, 2));
      s += v * Math.pow(2, i);
    }
    return (s % 11) % 10;
  }
  // Devuelve { c, nota } con el número limpio, completado o vacío si no parece contenedor
  function limpiarC(orig) {
    const c = normC(orig);
    if (/^[A-Z]{4}\d{7}$/.test(c)) return { c, nota: '' };
    if (/^[A-Z]{4}\d{6}$/.test(c)) { const d = c + digito(c); return { c: d, nota: `N° completado: ${T(orig)} → ${d}` }; }
    return { c: '', nota: T(orig) ? `Sin N° de contenedor ("${T(orig)}")` : 'Sin N° de contenedor' };
  }
  const r3 = x => x === null ? null : Math.round(x * 1000) / 1000;

  // Hojas a leer: solo las de packing lists; la primera que aparece gana si un contenedor se repite
  function hojasPL(wb) {
    const hs = wb.SheetNames.filter(s => K(s).replace(/\s/g, '').startsWith('PACKINGLIST'));
    // "Impresión" primero (lo vigente), después "Antiguos"
    return hs.sort((a, b) => (K(b).includes('IMPRES') ? 1 : 0) - (K(a).includes('IMPRES') ? 1 : 0));
  }

  function mapearCabecera(row, j0) {
    const m = { cod: null, prod: null, np: null, kg: null, vb: null, co: null, q: [] };
    for (let j = j0 + 1; j < row.length; j++) {
      const h = K(row[j]); if (!h) continue;
      if (h === 'CODIGO') m.cod = j;
      else if (h === 'PRODUCTO') m.prod = j;
      else if (h.startsWith('N° PALLET') || h.startsWith('NO PALLET')) m.np = j;
      else if (h === 'TOTAL KGS') m.kg = j;
      else if (h.startsWith('VB')) m.vb = j;
      else if (h.startsWith('COSTO')) m.co = j;
      else if (h === 'KGS X PAL' || h.startsWith('KGS X')) continue; // calculadas
      else m.q.push({ j, h: T(row[j]) });
    }
    return m;
  }

  function leerHoja(ws, XLSX, hoja) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const j0 = row.findIndex(v => K(v).startsWith('N° CONTENEDOR'));
      if (j0 < 0) continue;
      const m = mapearCabecera(row, j0);
      if (m.cod === null || m.prod === null) continue; // no es un bloque de packing list
      const ok = row.slice(0, j0).some(v => K(v) === 'OK');
      const q = m.q;
      let f, lb = null, lc, ib = null, iu = null, ic;
      if (q.length >= 3) { ib = q[0].j; iu = q[1].j; ic = q[2].j; lb = q[0].h; lc = q[2].h; f = K(lb) === 'PALLETS' ? 'pallet' : 'bulto'; }
      else if (q.length === 2) { ib = q[0].j; ic = q[1].j; lb = q[0].h; lc = q[1].h; f = 'bulto'; }
      else { ic = q.length ? q[0].j : null; lc = q.length ? q[0].h : 'Cantidad'; f = 'simple'; }
      const pl = { c: '', cOrig: '', nota: '', g: [], b: 'POR ASIGNAR', f, lb, lc, l: [], hoja, fila: i + 1, ok };
      let blancos = 0;
      for (let k = i + 1; k < rows.length; k++) {
        const r = rows[k] || [];
        if (r.some(v => K(v).startsWith('N° CONTENEDOR'))) break;
        const a = T(r[j0]), au = K(r[j0]);
        const cod = T(r[m.cod]), prod = T(r[m.prod]);
        if (K(prod) === 'TOTAL' || K(cod) === 'TOTAL') break;
        // columna del contenedor: N°, guía y bodega
        if (k === i + 1) { const x = limpiarC(a); pl.cOrig = a; pl.c = x.c; pl.nota = x.nota; }
        else if (au.startsWith('N° GUIA') || au.startsWith('BODEGA DESTINO') || !a) { /* etiquetas */ }
        else {
          const prev = K((rows[k - 1] || [])[j0]);
          if (prev.startsWith('N° GUIA')) pl.g = a.split(/[,/;]|\s-\s/).map(T).filter(Boolean);
          else if (prev.startsWith('BODEGA DESTINO')) pl.b = au.includes('POR ASIGNAR') ? 'POR ASIGNAR' : au.replace(/[\[\]]/g, '').trim();
        }
        if (!cod && !prod) { if (!a && ++blancos >= 2) break; continue; }
        blancos = 0;
        const bu = ib !== null ? n(r[ib]) : null, ub = iu !== null ? n(r[iu]) : null;
        let ca = ic !== null ? n(r[ic]) : null;
        if (ca === null && bu && ub) ca = bu * ub;
        const vb = m.vb !== null ? T(r[m.vb]) : '';
        pl.l.push([cod, prod, m.np !== null ? T(r[m.np]) : '', r3(n(r[m.kg])), bu, ub, ca, vb === '0' ? '' : vb, m.co !== null ? n(r[m.co]) : null]);
      }
      if (pl.l.length || pl.c) out.push(pl);
    }
    return out;
  }

  // Devuelve { pls, avisos } — un packing list por contenedor
  function parse(wb, XLSX) {
    const hojas = hojasPL(wb);
    const avisos = [];
    if (!hojas.length) return { pls: [], avisos: ['El archivo no tiene hojas "PackingLists…" / "Packinglist…"'], hojas };
    const vistos = new Map(), pls = [];
    hojas.forEach(h => leerHoja(wb.Sheets[h], XLSX, h).forEach(pl => {
      if (pl.c && vistos.has(pl.c)) { const p = vistos.get(pl.c); p.dups = (p.dups || 0) + 1; return; }
      if (pl.c) vistos.set(pl.c, pl);
      pls.push(pl);
    }));
    return { pls, avisos, hojas };
  }

  // Firma para comparar con lo que ya está en la web (ignora nombres de producto y formato de números)
  const firma = pl => pl.l.map(l => [K(l[0]), Math.round((Number(l[3]) || 0) * 10), Number(l[4]) || 0, Number(l[5]) || 0, Math.round(Number(l[6]) || 0)].join(':')).sort().join('|');

  return { parse, firma, normC, digito };
})();

const PackingLists = (() => {
  const API = '/api/packing-lists'; // proxy de Vercel (el POST directo a Apps Script falla por CORS)
  const LBL = { pallet: ['PALLETS', 'Res x Pal', 'Resmas'], bulto: ['Cajas', 'Un x Caja', 'Unidades'], simple: [null, null, 'Cantidad'] };
  const BODEGAS = ['POR ASIGNAR', 'VIEL', 'ALDUNATE', 'SAN FRANCISCO', 'STGO CONCHA', 'CLIENTE'];

  let items = [];        // packing lists desde Sheets
  let imp = new Map();   // contenedor -> fila de Importaciones
  let cargado = false, cargando = null, errorCarga = '';
  let body = null;
  const st = { q: '', bod: 'Todas', sel: null, marked: new Set() };
  let cat = {};          // catálogo código -> {p, u}
  let dlg = null, editId = null;
  let porCont = new Map(); // contenedor -> packing list
  let accion = null;       // acción pedida desde Control Importaciones: { tipo: 'ver'|'nuevo', c }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v === null || v === '' || v === undefined || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fLarga = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const cap = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
  const bodLbl = b => sinBodega(b) ? 'Por asignar' : cap(b);
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Llave de cruce: 4 letras + 6 dígitos (sin dígito verificador), así TIIU594649 calza con TIIU5946490
  const key = c => norm(c).slice(0, 10);
  const bodCls = b => { const u = String(b || '').toUpperCase(); return u.includes('ALDUNATE') ? 'ald' : u.includes('VIEL') ? 'viel' : ''; };
  const sinBodega = b => !b || String(b).toUpperCase().includes('POR ASIGNAR');
  const has = (pl, i) => pl.l.some(l => l[i] !== null && l[i] !== '' && l[i] !== undefined && l[i] !== 0);
  // GE y bodega tal como vienen de una fila de Importaciones
  const geDe = r => r && r.ge ? String(r.ge).split(/[,/]/).map(s => s.trim()).filter(Boolean) : [];
  const bodDe = r => r && !sinBodega(r.bodega) ? r.bodega : 'POR ASIGNAR';

  // Datos del contenedor: GE y bodega mandan desde Importaciones.
  // Lo guardado en el PL solo se usa si el contenedor no está en Importaciones (ej. migrados antiguos)
  function info(pl) {
    const r = imp.get(key(pl.c));
    const fecha = (r && (r.llegada || r.eta)) || String(pl.creado || '').slice(0, 10);
    if (r) return { r, bodega: bodDe(r), guias: geDe(r), fecha };
    return { r: {}, bodega: pl.b || 'POR ASIGNAR', guias: pl.g, fecha };
  }
  function alertas(pl) {
    const a = [];
    if (!pl.c) a.push('Falta el N° de contenedor');
    if (pl.l.some(l => !l[0] || l[0].toUpperCase() === 'SIN CÓDIGO')) a.push('Hay líneas sin código asignado');
    const r = pl.c ? imp.get(key(pl.c)) : null;
    if (pl.c && !r) a.push('El contenedor no aparece en Importaciones');
    if (r && norm(r.contenedor) !== norm(pl.c)) a.push(`En Importaciones figura como ${r.contenedor} (revisa el N° en el Excel)`);
    return a;
  }

  // ============ CARGA ============
  async function cargar(force) {
    if (cargando) return cargando;
    if (cargado && !force) return;
    cargando = (async () => {
      try {
        const r = await fetch(API, { cache: 'no-store' });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
        items = d.items.map(x => ({ ...x, g: x.g || [], l: x.l || [] }));
        porCont = new Map(items.filter(x => x.c).map(x => [key(x.c), x]));
        cat = {};
        items.forEach(pl => pl.l.forEach(l => { if (l[0] && l[0].toUpperCase() !== 'SIN CÓDIGO') cat[l[0]] = { p: l[1], u: l[5] }; }));
        cargado = true; errorCarga = '';
      } catch (err) {
        console.error('Packing lists:', err);
        errorCarga = err.message;
      } finally { cargando = null; }
    })();
    return cargando;
  }

  // ============ SECCIÓN ============
  async function init(container) {
    if (window.ContendedoresSection) ContendedoresSection.estilos(); // reutiliza estilos ci-* (tabla, buscador, toasts)
    container.innerHTML = `<div class="ci">
      <div class="ci-head">
        <div><h1>📋 Packing Lists</h1><p>Detalle por contenedor · conectado con Control Importaciones</p></div>
        <button class="ci-btn" id="pl-refresh">🔄 Actualizar</button>
      </div>
      <div id="pl-body"><p class="ci-empty">Cargando…</p></div>
    </div>`;
    const b = container.querySelector('#pl-body');
    container.querySelector('#pl-refresh').addEventListener('click', async () => {
      const [filas] = await Promise.all([ContendedoresSection.obtenerFilas().catch(() => []), cargar(true)]);
      render(b, filas);
    });
    let filas = [];
    try { filas = await ContendedoresSection.obtenerFilas(); }
    catch (err) { console.error('Importaciones:', err); }
    await cargar(false);
    if (!b.isConnected) return; // el usuario ya se fue a otra sección
    render(b, filas);
    const a = accion; accion = null;
    if (a && a.tipo === 'ver') {
      const pl = porCont.get(key(a.c));
      if (pl) { st.sel = pl.id; st.q = ''; st.bod = 'Todas'; const q = body.querySelector('#pl-q'); if (q) q.value = ''; body.querySelector('.pl-wrap').classList.add('pl-show'); renderFilters(); renderList(); renderDetail(); scrollAlSel(); }
    } else if (a && a.tipo === 'nuevo') {
      abrirForm(null, a.c);
    }
  }
  function irSeccion() {
    const nav = document.querySelector('.nav-item[data-section="packing-lists"]');
    if (nav) nav.click();
  }
  function scrollAlSel() {
    const el = body && body.querySelector('.pl-row.cur');
    if (el) el.scrollIntoView({ block: 'center' });
  }

  // ============ API PARA CONTROL IMPORTACIONES ============
  const tiene = c => porCont.has(key(c));
  const firma = () => items.map(x => x.id + ':' + (x.c || '') + ':' + x.l.length).join('|');
  function abrir(c) { accion = { tipo: 'ver', c: norm(c) }; irSeccion(); }
  function nuevo(c) { accion = { tipo: 'nuevo', c: norm(c) }; irSeccion(); }
  // Usados desde la pestaña Packing lists de Control Importaciones
  function seleccionar(cont) {
    const pl = porCont.get(key(cont));
    if (!pl) return;
    st.sel = pl.id; st.q = ''; st.bod = 'Todas';
    setTimeout(() => {
      const w = body && body.querySelector('.pl-wrap');
      if (w) w.classList.add('pl-show');
      scrollAlSel();
    }, 0);
  }
  function formNuevo(cont) { abrirForm(null, norm(cont)); }

  function pdfContenedores(conts) {
    const lista = [...new Set(conts.map(key))].map(c => porCont.get(c)).filter(Boolean);
    if (!lista.length) { toast('Ninguno de esos contenedores tiene packing list', true); return; }
    pdf(lista);
  }

  // ============ RENDER ============
  // Lo llama ContendedoresSection cada vez que dibuja la pestaña (también en el auto-refresh)
  function render(container, rowsImportaciones) {
    injectStyles();
    imp = new Map();
    (rowsImportaciones || []).forEach(r => { const k = key(r.contenedor); if (k && !imp.has(k)) imp.set(k, r); });
    const yaMontado = body === container && container.querySelector('.pl-wrap');
    body = container;
    if (!yaMontado) {
      body.innerHTML = `<div class="pl-wrap">
        <aside class="pl-list">
          <div class="pl-list-head">
            <input class="ci-search pl-search" id="pl-q" type="search" placeholder="Buscar contenedor, GE, código o producto" value="${esc(st.q)}">
            <div class="pl-filters" id="pl-filters"></div>
            <div class="pl-new-sm"><button class="pl-b" data-importar>📥 Importar Excel</button><button class="pl-b pl-pri" data-new>➕ Nuevo</button></div>
          </div>
          <div class="pl-items" id="pl-items"><p class="ci-empty">Cargando packing lists…</p></div>
          <div class="pl-selbar" id="pl-selbar"><span id="pl-seln"></span><button class="pl-b" id="pl-selclear">Limpiar</button><button class="pl-b pl-pri" id="pl-selprint">Descargar PDF</button></div>
          <div class="pl-count"><span id="pl-count"></span><a href="#" id="pl-selall">Marcar visibles</a></div>
        </aside>
        <section class="pl-detail" id="pl-detail"></section>
      </div>`;
      bind();
    }
    cargar(false).then(() => {
      if (!body || !body.querySelector('.pl-wrap')) return;
      if (!st.sel && items.length && !window.matchMedia('(max-width: 900px)').matches) st.sel = ordenados()[0].id;
      renderFilters(); renderList(); renderDetail();
    });
    renderFilters(); renderList(); renderDetail();
  }

  function bind() {
    body.querySelector('#pl-q').addEventListener('input', e => { st.q = e.target.value; renderList(); });
    body.querySelector('#pl-filters').addEventListener('click', e => {
      const t = e.target.closest('[data-b]'); if (!t) return;
      st.bod = t.dataset.b; renderFilters(); renderList();
    });
    body.querySelector('#pl-items').addEventListener('click', e => {
      const t = e.target.closest('.pl-item'); if (!t) return;
      st.sel = t.dataset.id; body.querySelector('.pl-wrap').classList.add('pl-show'); renderList(); renderDetail();
    });
    body.querySelector('#pl-items').addEventListener('change', e => {
      const id = e.target.dataset.m; if (!id) return;
      e.target.checked ? st.marked.add(id) : st.marked.delete(id); renderSel();
    });
    body.querySelector('.pl-new-sm [data-new]').addEventListener('click', () => abrirForm(null));
    body.querySelector('.pl-new-sm [data-importar]').addEventListener('click', elegirArchivo);
    body.querySelector('#pl-selall').addEventListener('click', e => { e.preventDefault(); filtrados().forEach(pl => st.marked.add(pl.id)); renderList(); });
    body.querySelector('#pl-selclear').addEventListener('click', () => { st.marked.clear(); renderList(); });
    body.querySelector('#pl-selprint').addEventListener('click', () => pdf(ordenados().filter(pl => st.marked.has(pl.id))));
    body.querySelector('#pl-detail').addEventListener('click', e => {
      if (e.target.closest('[data-back]')) body.querySelector('.pl-wrap').classList.remove('pl-show');
      if (e.target.closest('[data-new]')) abrirForm(null);
      if (e.target.closest('[data-importar]')) elegirArchivo();
      if (e.target.closest('[data-edit]')) abrirForm(items.find(x => x.id === st.sel));
      if (e.target.closest('[data-pdf1]')) pdf(items.filter(x => x.id === st.sel));
      if (e.target.closest('[data-imp]')) { const pl = items.find(x => x.id === st.sel); if (pl && pl.c) ContendedoresSection.abrir(info(pl).r.contenedor || pl.c); }
      if (e.target.closest('[data-retry]')) { errorCarga = ''; cargar(true).then(() => { renderList(); renderDetail(); }); }
    });
  }

  function ordenados() {
    return items.slice().sort((a, b) => (info(b).fecha).localeCompare(info(a).fecha) || String(b.id).localeCompare(String(a.id)));
  }
  function filtrados() {
    const q = st.q.trim().toUpperCase();
    return ordenados().filter(pl => {
      const i = info(pl);
      if (st.bod !== 'Todas' && !String(i.bodega).toUpperCase().includes(st.bod)) return false;
      if (!q) return true;
      return [pl.c, i.guias.join(' '), i.r.proveedor, i.r.orden].join(' ').toUpperCase().includes(q)
        || pl.l.some(l => String(l[0]).toUpperCase().includes(q) || String(l[1]).toUpperCase().includes(q));
    });
  }

  function renderFilters() {
    const el = body && body.querySelector('#pl-filters'); if (!el) return;
    const ops = [['Todas', 'Todas'], ['VIEL', 'Viel'], ['ALDUNATE', 'Aldunate'], ['POR ASIGNAR', 'Por asignar']];
    el.innerHTML = ops.map(([k, l]) => `<button class="pl-chip${st.bod === k ? ' on' : ''}" data-b="${k}">${l}</button>`).join('');
  }

  function renderList() {
    const el = body && body.querySelector('#pl-items'); if (!el) return;
    if (errorCarga) { el.innerHTML = `<p class="ci-err" style="padding:14px">No se pudieron cargar los packing lists: ${esc(errorCarga)}</p>`; return; }
    if (!cargado) return;
    const f = filtrados();
    el.innerHTML = f.map(pl => {
      const i = info(pl), kg = pl.l.reduce((s, l) => s + (l[3] || 0), 0), bc = bodCls(i.bodega);
      return `<div class="pl-row${st.sel === pl.id ? ' cur' : ''}">
        <label class="pl-ck"><input type="checkbox" data-m="${esc(pl.id)}" ${st.marked.has(pl.id) ? 'checked' : ''} aria-label="Marcar ${esc(pl.c || pl.id)}"></label>
        <button class="pl-item" data-id="${esc(pl.id)}">
          <b>${esc(pl.c || 'Sin N° contenedor')}</b>
          <span class="ci-bod${bc ? ' ci-bod-' + bc : ''}">${esc(bodLbl(i.bodega))}</span>
          <small>${i.fecha ? fLarga(i.fecha) + ' · ' : ''}${esc(i.r.proveedor || 'Sin proveedor')} · ${pl.l.length} ${pl.l.length === 1 ? 'línea' : 'líneas'}${kg ? ' · ' + nf(kg / 1000, 1) + ' t' : ''}</small>
        </button></div>`;
    }).join('') || '<p class="ci-empty">Ningún packing list coincide con la búsqueda</p>';
    body.querySelector('#pl-count').textContent = `${f.length} de ${items.length} contenedores`;
    renderSel();
  }

  function renderSel() {
    const n = st.marked.size;
    body.querySelector('#pl-selbar').classList.toggle('on', n > 0);
    body.querySelector('#pl-seln').textContent = `${n} ${n === 1 ? 'marcado' : 'marcados'}`;
  }

  function cols(pl) {
    const lb = pl.lb || LBL[pl.f][0] || 'Bultos', lc = pl.lc || LBL[pl.f][2] || 'Cantidad';
    const uni = s => cap(s).replace(/s$/, '').toLowerCase();
    const C = [];
    if (has(pl, 2)) C.push({ h: 'N° pallet', v: l => esc(l[2]) });
    if (has(pl, 3)) C.push({ h: 'Total kg', n: 1, v: l => nf(l[3], 1), s: 3, sd: 1 });
    if (has(pl, 3) && has(pl, 4)) C.push({ h: 'Kg x ' + uni(lb), n: 1, calc: 1, v: l => l[4] ? nf(l[3] / l[4], 2) : '' });
    if (has(pl, 4)) C.push({ h: cap(lb), n: 1, v: l => nf(l[4]), s: 4 });
    if (has(pl, 5)) C.push({ h: pl.f === 'pallet' ? 'Res x Pal' : 'Un x ' + uni(lb), n: 1, v: l => nf(l[5]) });
    if (has(pl, 6)) C.push({ h: cap(lc), n: 1, v: l => nf(l[6]), s: 6 });
    if (has(pl, 3) && has(pl, 6)) C.push({ h: 'Kg x ' + uni(lc), n: 1, calc: 1, v: l => l[6] ? nf(l[3] / l[6], 3) : '' });
    C.push({ h: 'VB°', v: l => (l[7] && l[7] !== '0') ? '<span class="pl-vb">✓</span>' : '' });
    if (has(pl, 8)) C.push({ h: 'Costo unit.', n: 1, v: l => l[8] ? '$' + nf(l[8]) : '' });
    return C;
  }

  function renderDetail() {
    const el = body && body.querySelector('#pl-detail'); if (!el) return;
    const bar = (extra = '') => `<div class="pl-top"><button class="pl-b pl-back" data-back>‹ Contenedores</button><span></span><div class="pl-acts">${extra}<button class="pl-b" data-importar>📥 Importar Excel</button><button class="pl-b pl-pri" data-new>➕ Nuevo packing list</button></div></div>`;
    if (errorCarga) { el.innerHTML = bar() + `<p class="ci-err">Revisa que api/packing-lists.js tenga la URL del Web App. <button class="pl-b" data-retry>Reintentar</button></p>`; return; }
    const pl = items.find(x => x.id === st.sel);
    if (!pl) { el.innerHTML = bar() + `<p class="ci-empty">${cargado ? 'Elige un contenedor de la lista o crea un packing list nuevo' : 'Cargando…'}</p>`; return; }
    const i = info(pl), C = cols(pl), sum = k => pl.l.reduce((s, l) => s + (Number(l[k]) || 0), 0);
    const bc = bodCls(i.bodega), al = alertas(pl);
    const c = pl.c || '';
    el.innerHTML = bar(`${c && imp.has(key(c)) ? '<button class="pl-b" data-imp>🚢 Ver en Importaciones</button>' : ''}<button class="pl-b" data-edit>✏️ Editar</button><button class="pl-b" data-pdf1>📄 PDF</button>`) + `
      <div class="pl-headline">
        ${c ? `<div class="pl-plate"><span>${esc(c.slice(0, 4))}</span><span>${esc(c.slice(4, 10))}</span><span class="pl-chk">${esc(c.slice(10))}</span></div>` : '<div class="pl-plate pl-plate-none">Sin N° contenedor</div>'}
        <div><strong>${esc(i.r.proveedor || 'No aparece en Importaciones')}</strong><small>${esc(i.r.material || '')}${i.r.orden ? ' · Orden ' + esc(i.r.orden) : ''}</small></div>
      </div>
      <div class="pl-facts">
        <div><span>Bodega destino</span><b><span class="ci-bod${bc ? ' ci-bod-' + bc : ''}">${esc(bodLbl(i.bodega))}</span></b></div>
        <div><span>${i.guias.length > 1 ? 'Guías de entrada' : 'Guía de entrada'}</span><b>${i.guias.length ? i.guias.map(esc).join(', ') : '—'}</b></div>
        <div><span>Llegada</span><b>${i.r.llegada ? fLarga(i.r.llegada) : i.r.eta ? fLarga(i.r.eta) + ' (ETA)' : '—'}</b></div>
        <div><span>Estado</span><b>${esc(cap(i.r.estado || '')) || '—'}</b></div>
        ${has(pl, 3) ? `<div><span>Total kg</span><b>${nf(sum(3), 1)}</b></div>` : ''}
        ${has(pl, 4) ? `<div><span>${esc(cap(pl.lb || LBL[pl.f][0] || 'Bultos'))}</span><b>${nf(sum(4))}</b></div>` : ''}
        <div><span>${esc(cap(pl.lc || LBL[pl.f][2] || 'Cantidad'))}</span><b>${nf(sum(6))}</b></div>
      </div>
      ${al.length ? `<div class="pl-alert">${al.map(esc).join(' · ')}</div>` : ''}
      <div class="ci-table-wrap"><table class="ci-table pl-table">
        <thead><tr><th>Código</th><th>Producto</th>${C.map(x => `<th class="${x.n ? 'num' : ''}">${esc(x.h)}</th>`).join('')}</tr></thead>
        <tbody>${pl.l.map(l => `<tr><td class="${!l[0] || l[0].toUpperCase() === 'SIN CÓDIGO' ? 'pl-nocode' : ''}">${esc(l[0] || 'Sin código')}</td><td class="pl-prod">${esc(l[1])}</td>${C.map(x => `<td class="${x.n ? 'num' : ''}${x.calc ? ' pl-calc' : ''}">${x.v(l)}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td></td>${C.map(x => `<td class="${x.n ? 'num' : ''}">${x.s ? nf(sum(x.s), x.sd || 0) : ''}</td>`).join('')}</tr></tfoot>
      </table></div>
      <p class="pl-hint">Totales y kg por unidad calculados desde las líneas · GE y bodega desde Importaciones · ${esc(pl.id)}${pl.origen && pl.origen !== 'web' ? ' · migrado de ' + esc(pl.origen) : ''}</p>`;
  }

  // ============ PDF (formato planilla de descarga, sin costos) ============
  function pdf(lista) {
    if (!lista.length) return;
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('No se cargó la librería de PDF', true); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
    const M = 24, pageH = doc.internal.pageSize.getHeight(), ROW = 14.5;
    const GRIS = [191, 191, 191], LAB = [217, 217, 217], AMA = [255, 255, 0], CEL = [0, 176, 240], ROSA = [255, 204, 255], SALMON = [252, 228, 214];
    let y = M;

    lista.forEach((pl, idx) => {
      const i = info(pl);
      const lb = String(pl.lb || LBL[pl.f][0] || 'Bultos').toUpperCase(), lc = cap(pl.lc || LBL[pl.f][2] || 'Cantidad');
      const C = [];
      if (has(pl, 3)) C.push({ h: 'TOTAL KGS', bg: CEL, v: l => nf(l[3], l[3] % 1 ? 1 : 0), t: 3, td: 2 });
      if (has(pl, 3) && has(pl, 4)) C.push({ h: 'KGS X ' + lb.replace(/S$/, ''), bg: AMA, v: l => l[4] ? nf(l[3] / l[4], 2) : '' });
      if (has(pl, 4)) C.push({ h: lb, bg: CEL, v: l => nf(l[4]), t: 4, td: 2 });
      if (has(pl, 5)) C.push({ h: pl.f === 'pallet' ? 'Res x Pal' : 'Un x ' + cap(lb).replace(/s$/, ''), bg: CEL, v: l => nf(l[5]) });
      if (has(pl, 6)) C.push({ h: lc, bg: AMA, v: l => nf(l[6]), t: 6, td: 2 });
      if (has(pl, 3) && has(pl, 6)) C.push({ h: 'Kgs x ' + lc.slice(0, 3), bg: AMA, v: l => l[6] ? nf(l[3] / l[6], 2) : '' });
      C.push({ h: 'VB°', bg: [255, 255, 255], v: () => '' });

      const bod = i.bodega.toUpperCase().includes('POR ASIGNAR') ? '[ POR ASIGNAR ]' : i.bodega.toUpperCase();
      const lado = [['v', pl.c || '—'], ['l', 'N° Guía Entrada'], ['v', i.guias.length ? 'GE N° ' + i.guias.join(' / ') : ''], ['l', 'Bodega Destino'], ['v', bod, bodCls(i.bodega) === 'ald' ? ROSA : AMA], ['', '']];
      const n = Math.max(pl.l.length, 6);
      const filas = [];
      for (let k = 0; k < n; k++) {
        const l = pl.l[k];
        filas.push([lado[k] ? lado[k][1] : '', l ? l[0] : '', l ? l[1] : '', ...C.map(c => l ? c.v(l) : '')]);
      }
      const tot = ['', '', 'TOTAL', ...C.map(c => c.t ? nf(pl.l.reduce((s, l) => s + (Number(l[c.t]) || 0), 0), c.td) : '')];

      // Bloque completo en la misma página si cabe
      const alto = (n + 2) * ROW + 4;
      if (idx > 0 && y + alto > pageH - M && alto < pageH - 2 * M) { doc.addPage(); y = M; }

      doc.autoTable({
        startY: y, margin: { left: M, right: M },
        head: [['N° Contenedor', 'Código', 'Producto', ...C.map(c => c.h)]],
        body: filas, foot: [tot], showHead: 'everyPage', showFoot: 'lastPage',
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 }, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: [0, 0, 0], halign: 'center', valign: 'middle', overflow: 'ellipsize', minCellHeight: ROW },
        headStyles: { fillColor: GRIS, fontStyle: 'bold', fontSize: 7, overflow: 'linebreak', cellPadding: { top: 3, bottom: 3, left: 1, right: 1 } },
        footStyles: { fillColor: SALMON, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 92, fontStyle: 'bold' }, 1: { cellWidth: 72, halign: 'left' }, 2: { cellWidth: 'auto', halign: 'left' }, ...Object.fromEntries(C.map((_, k) => [k + 3, { cellWidth: 52 }])) },
        didParseCell: d => {
          if (d.section === 'head' && d.column.index >= 3) d.cell.styles.fillColor = C[d.column.index - 3].bg;
          if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'left';
          if (d.section === 'body' && d.column.index === 0) {
            const s = lado[d.row.index];
            d.cell.styles.fillColor = !s || !s[0] ? [255, 255, 255] : s[0] === 'l' ? LAB : (s[2] || AMA);
          }
          if (d.section === 'foot') { if (d.column.index === 0) d.cell.styles.fillColor = [255, 255, 255]; if (d.column.index === 2) d.cell.styles.halign = 'right'; }
        }
      });
      y = doc.lastAutoTable.finalY + 14;
    });

    const hoy = new Date();
    const f = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    doc.save(lista.length === 1 && lista[0].c ? `Packing list ${lista[0].c}.pdf` : `Packing lists descarga ${f}.pdf`);
  }

  // ============ NUEVO / EDITAR ============
  function crearDialog() {
    if (dlg) return;
    dlg = document.createElement('dialog');
    dlg.className = 'pl-dlg';
    dlg.innerHTML = `
      <div class="pl-dlg-head"><h2 id="pl-ftitle">Nuevo packing list</h2><button class="pl-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="pl-dlg-body">
        <div class="pl-grid4">
          <label>N° contenedor<input id="pl-fc" maxlength="11" placeholder="PCIU9184980" autocomplete="off"></label>
          <label>Guías de entrada<input id="pl-fg" placeholder="10410, 10411"></label>
          <label>Bodega destino<select id="pl-fb">${BODEGAS.map(b => `<option value="${b}">${cap(b)}</option>`).join('')}</select></label>
          <label>Se recibe en<select id="pl-ff"><option value="pallet">Pallets y resmas</option><option value="bulto">Cajas y unidades</option><option value="simple">Solo cantidad</option></select></label>
        </div>
        <p class="pl-hint" id="pl-fimp"></p>
        <div class="ci-table-wrap"><table class="pl-lines"><thead id="pl-lh"></thead><tbody id="pl-lb"></tbody></table></div>
        <button class="pl-b" id="pl-add" style="margin-top:8px">➕ Agregar línea</button>
        <p class="pl-hint">Al escribir un código conocido se completan el producto y las unidades por bulto con el último valor usado.</p>
        <datalist id="pl-codes"></datalist>
      </div>
      <div class="pl-dlg-foot"><span id="pl-fsum"></span><span class="ci-err" id="pl-ferr"></span><button class="pl-b pl-pri" id="pl-save">Guardar packing list</button></div>`;
    document.body.appendChild(dlg);
    const lb = dlg.querySelector('#pl-lb');
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('#pl-ff').addEventListener('change', () => { const prev = leerLineas(); cabecera(); lb.innerHTML = ''; (prev.length ? prev : [[], []]).forEach(l => linea(l)); recalc(); });
    dlg.querySelector('#pl-add').addEventListener('click', () => { linea([]); lb.lastElementChild.querySelector('input').focus(); });
    lb.addEventListener('click', e => { if (e.target.closest('[data-del]')) { e.target.closest('tr').remove(); recalc(); } });
    lb.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.k === 'cod') {
        const m = cat[t.value.trim()];
        if (m) { const tr = t.closest('tr'); tr.querySelector('[data-k="prod"]').value = m.p; const ub = tr.querySelector('[data-k="ub"]'); if (ub && m.u && !ub.value) ub.value = m.u; }
      }
      recalc();
    });
    dlg.querySelector('#pl-fc').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); infoImp(); });
    dlg.querySelector('#pl-save').addEventListener('click', guardar);
  }

  const fmt = () => dlg.querySelector('#pl-ff').value;
  function cabecera() {
    const L = LBL[fmt()];
    dlg.querySelector('#pl-lh').innerHTML = `<tr><th style="width:14%">Código</th><th>Producto</th><th class="num" style="width:10%">Total kg</th>
      ${L[0] ? `<th class="num" style="width:9%">${cap(L[0])}</th><th class="num" style="width:9%">${L[1]}</th>` : ''}
      <th class="num" style="width:10%">${L[2]}</th><th class="num" style="width:8%">Kg x un.</th><th class="num" style="width:10%">Costo unit.</th><th style="width:34px"></th></tr>`;
  }
  function linea(v) {
    const L = LBL[fmt()], tr = document.createElement('tr');
    const val = x => (x === null || x === undefined) ? '' : esc(x);
    tr.innerHTML = `<td><input list="pl-codes" data-k="cod" value="${val(v[0])}" aria-label="Código"></td>
      <td><input data-k="prod" value="${val(v[1])}" aria-label="Producto"><input type="hidden" data-k="np" value="${val(v[2])}"><input type="hidden" data-k="vb" value="${val(v[7])}"></td>
      <td><input class="num" data-k="kg" inputmode="decimal" value="${val(v[3])}" aria-label="Total kg"></td>
      ${L[0] ? `<td><input class="num" data-k="bu" inputmode="numeric" value="${val(v[4])}" aria-label="${L[0]}"></td><td><input class="num" data-k="ub" inputmode="numeric" value="${val(v[5])}" aria-label="${L[1]}"></td><td class="pl-out" data-o="ca"></td>`
               : `<td><input class="num" data-k="ca" inputmode="numeric" value="${val(v[6])}" aria-label="Cantidad"></td>`}
      <td class="pl-out" data-o="kxu"></td>
      <td><input class="num" data-k="co" inputmode="numeric" value="${val(v[8])}" aria-label="Costo unitario"></td>
      <td><button class="pl-x" data-del aria-label="Quitar línea">✕</button></td>`;
    dlg.querySelector('#pl-lb').appendChild(tr);
  }
  // Acepta "1.234,5" y "1234.5"
  const num = (tr, k) => {
    const i = tr.querySelector(`[data-k="${k}"]`); if (!i) return null;
    let s = i.value.trim(); if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s); return isNaN(n) ? null : n;
  };
  function leerLineas() {
    const out = [];
    dlg.querySelectorAll('#pl-lb tr').forEach(tr => {
      const cod = tr.querySelector('[data-k="cod"]').value.trim(), prod = tr.querySelector('[data-k="prod"]').value.trim();
      if (!cod && !prod) return;
      const bu = num(tr, 'bu'), ub = num(tr, 'ub');
      const ca = tr.querySelector('[data-k="ca"]') ? num(tr, 'ca') : (bu && ub ? bu * ub : null);
      out.push([cod, prod, tr.querySelector('[data-k="np"]').value, num(tr, 'kg'), bu, ub, ca, tr.querySelector('[data-k="vb"]').value, num(tr, 'co')]);
    });
    return out;
  }
  function recalc() {
    let kg = 0, bu = 0, ca = 0, n = 0;
    dlg.querySelectorAll('#pl-lb tr').forEach(tr => {
      const k = num(tr, 'kg'), b = num(tr, 'bu'), u = num(tr, 'ub');
      const oc = tr.querySelector('[data-o="ca"]');
      const c = oc ? (b && u ? b * u : null) : num(tr, 'ca');
      if (oc) oc.textContent = nf(c);
      tr.querySelector('[data-o="kxu"]').textContent = k && c ? nf(k / c, 3) : '';
      if (tr.querySelector('[data-k="cod"]').value || tr.querySelector('[data-k="prod"]').value) n++;
      kg += k || 0; bu += b || 0; ca += c || 0;
    });
    const L = LBL[fmt()];
    dlg.querySelector('#pl-fsum').textContent = `${n} ${n === 1 ? 'línea' : 'líneas'} · ${nf(kg, 1)} kg${L[0] ? ' · ' + nf(bu) + ' ' + L[0].toLowerCase() : ''} · ${nf(ca)} ${L[2].toLowerCase()}`;
  }
  // Si el contenedor está en Importaciones: GE y bodega se llenan desde ahí y quedan bloqueados
  function infoImp() {
    const c = norm(dlg.querySelector('#pl-fc').value), r = c.length >= 10 ? imp.get(key(c)) : null, el = dlg.querySelector('#pl-fimp');
    const fg = dlg.querySelector('#pl-fg'), fb = dlg.querySelector('#pl-fb');
    el.textContent = c.length === 11 ? (r ? `En Importaciones: ${r.proveedor || ''} · ${r.material || ''} · GE y bodega se toman de ahí` : 'Este contenedor todavía no aparece en Importaciones.') : '';
    fg.disabled = fb.disabled = !!r;
    if (r) {
      fg.value = geDe(r).join(', ');
      fb.value = BODEGAS.find(x => String(bodDe(r)).toUpperCase().includes(x)) || 'POR ASIGNAR';
    }
  }
  function abrirForm(pl, contSugerido) {
    crearDialog();
    editId = pl ? pl.id : null;
    dlg.querySelector('#pl-codes').innerHTML = Object.keys(cat).sort().map(c => `<option value="${esc(c)}">${esc(cat[c].p)}</option>`).join('');
    dlg.querySelector('#pl-ftitle').textContent = pl ? `Editar ${pl.c || pl.id}` : 'Nuevo packing list';
    dlg.querySelector('#pl-fc').value = pl ? (pl.c || '') : (contSugerido || '');
    dlg.querySelector('#pl-fg').value = pl ? pl.g.join(', ') : '';
    const b = pl ? (BODEGAS.find(x => String(pl.b).toUpperCase().includes(x)) || 'POR ASIGNAR') : 'POR ASIGNAR';
    dlg.querySelector('#pl-fb').value = b;
    dlg.querySelector('#pl-ff').value = pl ? pl.f : 'pallet';
    dlg.querySelector('#pl-ferr').textContent = '';
    dlg.querySelector('#pl-fimp').textContent = '';
    cabecera();
    dlg.querySelector('#pl-lb').innerHTML = '';
    (pl ? pl.l : [[], []]).forEach(l => linea(l));
    recalc();
    infoImp(); // siempre: al editar también toma GE y bodega de Importaciones
    dlg.showModal();
    dlg.querySelector('#pl-fc').focus();
  }
  async function guardar() {
    const err = dlg.querySelector('#pl-ferr'), btn = dlg.querySelector('#pl-save');
    const c = dlg.querySelector('#pl-fc').value;
    err.textContent = '';
    if (c && !/^[A-Z]{4}\d{7}$/.test(c)) { err.textContent = 'El N° de contenedor debe tener 4 letras y 7 dígitos.'; return; }
    if (c && items.some(x => x.c && key(x.c) === key(c) && x.id !== editId)) { err.textContent = `${c} ya tiene packing list.`; return; }
    const l = leerLineas();
    if (!l.length) { err.textContent = 'Agrega al menos una línea con código o producto.'; return; }
    const f = fmt(), prev = items.find(x => x.id === editId);
    const pl = {
      id: editId, c, g: dlg.querySelector('#pl-fg').value.split(/[,/]/).map(s => s.trim()).filter(Boolean),
      b: dlg.querySelector('#pl-fb').value, f,
      lb: prev && prev.f === f ? prev.lb : LBL[f][0], lc: prev && prev.f === f ? prev.lc : LBL[f][2], l
    };
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', pl }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
      dlg.close();
      await cargar(true);
      st.sel = d.id; st.q = ''; st.bod = 'Todas';
      const q = body && body.querySelector('#pl-q'); if (q) q.value = '';
      renderFilters(); renderList(); renderDetail();
      toast(editId ? 'Packing list actualizado' : 'Packing list guardado');
    } catch (e) {
      err.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = 'Guardar packing list'; }
  }

  // ============ IMPORTAR EXCEL ============
  // Lee la planilla (hojas PackingLists Impresión / Packinglist Antiguos), separa los bloques
  // y asigna cada uno a su contenedor. Compara con lo que ya está en la web:
  // nuevo → se crea · con cambios → se actualiza (si lo marcas) · igual → no se toca
  let idlg = null, imp_ = [];
  function elegirArchivo() {
    if (!cargado) { toast('Espera a que carguen los packing lists', true); return; }
    if (!window.XLSX) { toast('No se cargó la librería de Excel', true); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xls';
    inp.addEventListener('change', () => { if (inp.files[0]) leerArchivo(inp.files[0]); });
    inp.click();
  }
  async function leerArchivo(file) {
    crearImpDialog();
    idlg.querySelector('#pl-ibody').innerHTML = '<p class="ci-empty">Leyendo ' + esc(file.name) + '…</p>';
    idlg.querySelector('#pl-isave').disabled = true;
    idlg.showModal();
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const { pls, avisos, hojas } = PLImportParser.parse(wb, XLSX);
      if (!pls.length) throw new Error(avisos[0] || 'No encontré bloques "N° Contenedor" en el archivo');
      imp_ = pls.map(clasificar);
      idlg.querySelector('#pl-ititle').textContent = `Importar ${file.name}`;
      idlg.dataset.hojas = hojas.join(' + ');
      renderImp();
    } catch (e) {
      console.error('Importar Excel:', e);
      idlg.querySelector('#pl-ibody').innerHTML = `<p class="ci-err">${esc(e.message)}</p>`;
    }
  }
  // Compara un bloque del Excel con lo que hay en la web
  function clasificar(x) {
    let prev = x.c ? porCont.get(key(x.c)) : null;
    // sin N° de contenedor: lo reconoce por sus líneas (así, cuando le pongas el N° en el Excel, se actualiza el mismo)
    const fx = PLImportParser.firma(x);
    if (!prev) prev = items.find(p => !p.c && PLImportParser.firma(p) === fx) || null;
    const r = x.c ? imp.get(key(x.c)) : null;
    const av = [];
    if (x.nota) av.push(x.nota);
    if (x.c && !r) av.push('No está en Importaciones');
    const sinCod = x.l.filter(l => !l[0] || K_(l[0]) === 'SIN CODIGO').length;
    if (sinCod) av.push(`${sinCod} ${sinCod === 1 ? 'línea' : 'líneas'} sin código`);
    const nuevos = [...new Set(x.l.map(l => l[0]).filter(c => c && K_(c) !== 'SIN CODIGO' && !cat[c]))];
    if (nuevos.length) av.push(`Código${nuevos.length > 1 ? 's' : ''} que no estaba${nuevos.length > 1 ? 'n' : ''} en la web: ${nuevos.slice(0, 4).join(', ')}${nuevos.length > 4 ? '…' : ''}`);
    // GE y bodega: si el contenedor está en Importaciones, se guardan los de ahí (son los que mandan).
    // Si no está, se usa lo del Excel; si el Excel no tiene, se mantiene lo de la web
    const g = r ? geDe(r) : (x.g.length ? x.g : (prev ? prev.g : []));
    const b = r ? bodDe(r) : (!sinBodega(x.b) ? x.b : (prev && !sinBodega(prev.b) ? prev.b : 'POR ASIGNAR'));
    const cambios = [];
    if (prev) {
      if (PLImportParser.firma(prev) !== fx) cambios.push(resumenLineas(prev, x));
      if (!prev.c && x.c) cambios.push('N° de contenedor ' + x.c);
      // con Importaciones, GE y bodega no cuentan como cambio (se muestran siempre desde ahí)
      if (!r) {
        if (g.join(',') !== prev.g.join(',')) cambios.push('GE ' + (g.join(', ') || '—'));
        if (String(b).toUpperCase() !== String(prev.b || 'POR ASIGNAR').toUpperCase()) cambios.push('bodega ' + bodLbl(b));
      }
    }
    const estado = !prev ? 'nuevo' : cambios.length ? 'cambio' : 'igual';
    const pl = { id: prev ? prev.id : null, c: x.c, g, b, f: x.f, lb: x.lb, lc: x.lc, l: x.l };
    // marcados por defecto: los nuevos y los cambios de la hoja vigente (Impresión)
    const on = estado === 'nuevo' || (estado === 'cambio' && K_(x.hoja).includes('IMPRES'));
    return { x, pl, prev, estado, cambios, av, on, ok: x.ok, r };
  }
  const K_ = v => String(v ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  function resumenLineas(a, b) {
    const s = (pl, k) => pl.l.reduce((t, l) => t + (Number(l[k]) || 0), 0);
    const p = [];
    if (a.l.length !== b.l.length) p.push(`${a.l.length} → ${b.l.length} líneas`);
    const ka = s(a, 3), kb = s(b, 3);
    if (Math.abs(ka - kb) > 0.5) p.push(`${nf(ka, 1)} → ${nf(kb, 1)} kg`);
    const ca = s(a, 6), cb = s(b, 6);
    if (Math.round(ca) !== Math.round(cb)) p.push(`${nf(ca)} → ${nf(cb)} ${String(b.lc || 'cantidad').toLowerCase()}`);
    return p.length ? p.join(', ') : 'códigos o cantidades por línea';
  }
  function crearImpDialog() {
    if (idlg) return;
    idlg = document.createElement('dialog');
    idlg.className = 'pl-dlg pl-idlg';
    idlg.innerHTML = `
      <div class="pl-dlg-head"><h2 id="pl-ititle">Importar Excel</h2><button class="pl-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="pl-dlg-body" id="pl-ibody"></div>
      <div class="pl-dlg-foot"><span id="pl-isum"></span><span class="ci-err" id="pl-ierr"></span><button class="pl-b pl-pri" id="pl-isave">Guardar</button></div>`;
    document.body.appendChild(idlg);
    idlg.querySelector('[data-close]').addEventListener('click', () => { if (!idlg.dataset.busy) idlg.close(); });
    idlg.addEventListener('cancel', e => { if (idlg.dataset.busy) e.preventDefault(); });
    idlg.querySelector('#pl-ibody').addEventListener('change', e => {
      const i = e.target.dataset.i;
      if (i !== undefined) { imp_[i].on = e.target.checked; sumImp(); }
      if (e.target.dataset.all !== undefined) { const est = e.target.dataset.all; imp_.forEach(o => { if (o.estado === est) o.on = e.target.checked; }); renderImp(); }
    });
    idlg.querySelector('#pl-ibody').addEventListener('click', e => {
      const t = e.target.closest('[data-ver]'); if (t) { const v = idlg.querySelector('#pl-igual'); v.hidden = !v.hidden; }
    });
    idlg.querySelector('#pl-isave').addEventListener('click', guardarImp);
  }
  function filaImp(o, i) {
    const x = o.x, L = o.pl, sum = k => L.l.reduce((t, l) => t + (Number(l[k]) || 0), 0);
    const tag = { nuevo: '<span class="pl-tag pl-tag-n">Nuevo</span>', cambio: '<span class="pl-tag pl-tag-c">Cambió</span>', igual: '<span class="pl-tag">Sin cambios</span>' }[o.estado];
    const det = [o.cambios.length ? 'Cambia: ' + o.cambios.join(' · ') : '', ...o.av].filter(Boolean);
    return `<tr class="${o.estado === 'igual' ? 'pl-ig' : ''}">
      <td>${o.estado === 'igual' ? '' : `<input type="checkbox" data-i="${i}" ${o.on ? 'checked' : ''} aria-label="Importar ${esc(L.c || 'bloque')}">`}</td>
      <td><b class="pl-ic">${esc(L.c || x.cOrig || 'Sin N°')}</b>${tag}${o.ok ? ' <span class="pl-tag pl-tag-ok">ok</span>' : ''}
        <small>${esc(o.r ? (o.r.proveedor || '') : '')}${o.r && o.r.proveedor ? ' · ' : ''}${esc(x.hoja)} fila ${x.fila}</small>
        ${det.length ? `<small class="pl-idet">${det.map(esc).join('<br>')}</small>` : ''}</td>
      <td class="num">${L.l.length}</td>
      <td class="num">${nf(sum(3), 1)}</td>
      <td class="num">${nf(sum(6))} <small>${esc(String(L.lc || '').toLowerCase())}</small></td>
      <td>${esc(L.g.join(', ') || '—')}</td>
      <td><span class="ci-bod${bodCls(L.b) ? ' ci-bod-' + bodCls(L.b) : ''}">${esc(bodLbl(L.b))}</span></td>
    </tr>`;
  }
  function renderImp() {
    const grupos = ['nuevo', 'cambio', 'igual'].map(est => ({ est, l: imp_.map((o, i) => [o, i]).filter(([o]) => o.estado === est) }));
    const tit = { nuevo: 'Nuevos', cambio: 'Ya están en la web, pero cambiaron', igual: 'Sin cambios (no se tocan)' };
    const head = '<thead><tr><th style="width:28px"></th><th>Contenedor</th><th class="num">Líneas</th><th class="num">Total kg</th><th class="num">Cantidad</th><th>GE</th><th>Bodega</th></tr></thead>';
    idlg.querySelector('#pl-ibody').innerHTML = `<p class="pl-hint" style="margin:0 0 12px">Leí ${imp_.length} contenedores de ${esc(idlg.dataset.hojas || '')}. Si un contenedor está en las dos hojas, se usa el de Impresión. GE y bodega se toman de Importaciones; lo del Excel solo se usa si el contenedor no aparece ahí.</p>` +
      grupos.map(gr => !gr.l.length ? '' : gr.est === 'igual'
        ? `<p class="pl-igh">✓ ${gr.l.length} ${tit.igual} <a href="#" data-ver onclick="return false">ver</a></p><div id="pl-igual" hidden><div class="ci-table-wrap"><table class="ci-table pl-itable">${head}<tbody>${gr.l.map(([o, i]) => filaImp(o, i)).join('')}</tbody></table></div></div>`
        : `<h3 class="pl-ih"><label><input type="checkbox" data-all="${gr.est}" ${gr.l.every(([o]) => o.on) ? 'checked' : ''}> ${tit[gr.est]} (${gr.l.length})</label></h3>
           <div class="ci-table-wrap"><table class="ci-table pl-itable">${head}<tbody>${gr.l.map(([o, i]) => filaImp(o, i)).join('')}</tbody></table></div>`).join('');
    sumImp();
  }
  function sumImp() {
    const n = imp_.filter(o => o.on && o.estado !== 'igual');
    const nn = n.filter(o => o.estado === 'nuevo').length, nc = n.length - nn;
    idlg.querySelector('#pl-isum').textContent = n.length ? [nn ? `${nn} nuevo${nn > 1 ? 's' : ''}` : '', nc ? `${nc} actualizado${nc > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : 'Nada marcado para guardar';
    const btn = idlg.querySelector('#pl-isave');
    btn.disabled = !n.length; btn.textContent = n.length ? `Guardar ${n.length}` : 'Guardar';
  }
  async function guardarImp() {
    const lista = imp_.filter(o => o.on && o.estado !== 'igual');
    if (!lista.length) return;
    const btn = idlg.querySelector('#pl-isave'), err = idlg.querySelector('#pl-ierr');
    err.textContent = ''; btn.disabled = true; idlg.dataset.busy = '1';
    const fallos = [];
    let ok = 0;
    for (let k = 0; k < lista.length; k++) {
      const o = lista[k];
      btn.textContent = `Guardando ${k + 1} de ${lista.length}…`;
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', pl: o.pl }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
        o.on = false; o.estado = 'igual'; o.cambios = []; ok++;
      } catch (e) { fallos.push(`${o.pl.c || o.x.cOrig || 'Sin N°'}: ${e.message}`); }
    }
    delete idlg.dataset.busy;
    await cargar(true);
    renderFilters(); renderList(); renderDetail();
    if (fallos.length) {
      renderImp();
      err.textContent = `${ok} guardados, ${fallos.length} con error: ${fallos.slice(0, 3).join(' · ')}${fallos.length > 3 ? '…' : ''}`;
    } else {
      idlg.close();
      toast(`${ok} packing list${ok > 1 ? 's' : ''} importado${ok > 1 ? 's' : ''}`);
    }
  }

  function toast(msg, error) {
    const t = document.createElement('div');
    t.className = 'ci-toast' + (error ? ' ci-toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function injectStyles() {
    if (document.getElementById('pl-styles')) return;
    const s = document.createElement('style');
    s.id = 'pl-styles';
    s.textContent = `
      .pl-wrap{display:grid;grid-template-columns:330px minmax(0,1fr);gap:18px;align-items:start}
      .pl-detail{min-width:0}
      .pl-list{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;flex-direction:column;max-height:calc(100vh - 220px);min-height:420px;position:sticky;top:12px}
      .pl-list-head{padding:12px;border-bottom:1px solid #eef0f3}
      .pl-search{margin-bottom:8px!important;max-width:none!important}
      .pl-filters{display:flex;flex-wrap:wrap;gap:6px}
      .pl-chip{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:3px 11px;font-size:12px;cursor:pointer;color:#4b5563}
      .pl-chip.on{background:#4f5bd5;border-color:#4f5bd5;color:#fff}
      .pl-items{overflow:auto;flex:1;min-height:0}
      .pl-row{display:flex;border-bottom:1px solid #f0f1f4;border-left:3px solid transparent}
      .pl-row.cur{background:#eef2ff;border-left-color:#667eea}
      .pl-ck{display:flex;align-items:center;padding:0 2px 0 12px;cursor:pointer}
      .pl-ck input{width:16px;height:16px;accent-color:#4f5bd5;cursor:pointer}
      .pl-item{flex:1;min-width:0;display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 12px 10px 8px;background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit}
      .pl-item b{font-size:15px}
      .pl-item .ci-bod{align-self:center}
      .pl-item small{grid-column:1/-1;color:#6b7280;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pl-selbar{display:none;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid #eef0f3;background:#f5f7fa}
      .pl-selbar.on{display:flex}
      .pl-selbar span{flex:1;font-weight:600;font-size:14px;white-space:nowrap}
      .pl-count{display:flex;justify-content:space-between;padding:8px 12px;font-size:12px;color:#6b7280;border-top:1px solid #eef0f3}
      .pl-count a{color:#4f5bd5}
      .pl-b{border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer;white-space:nowrap;font-size:13px;color:#1f2937}
      .pl-b:hover{background:#f5f7fa}
      .pl-pri{background:#1e7b34;border-color:#1e7b34;color:#fff}
      .pl-pri:hover{background:#17652a}
      .pl-b:disabled{opacity:.6;cursor:wait}
      .pl-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
      .pl-acts{display:flex;gap:8px;flex-wrap:wrap}
      .pl-back{display:none}
      .pl-headline{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:16px}
      .pl-headline strong{display:block;font-size:17px}
      .pl-headline small{color:#6b7280;font-size:13px}
      .pl-plate{display:inline-flex;align-items:baseline;gap:8px;background:#facc15;color:#1f2937;border-radius:4px;padding:8px 14px 6px;font-weight:800;font-size:30px;line-height:1;letter-spacing:.05em;box-shadow:inset 0 0 0 2px #1f2937}
      .pl-chk{border:2px solid #1f2937;padding:0 5px;font-size:24px;line-height:1.1}
      .pl-plate-none{background:#f3f4f6;color:#9ca3af;box-shadow:inset 0 0 0 2px #e5e7eb;font-size:20px}
      .pl-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
      .pl-facts>div{background:#fff;border-left:4px solid #667eea;border-radius:8px;padding:10px 12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
      .pl-facts span{display:block;font-size:12px;color:#6b7280}
      .pl-facts b{display:block;font-size:16px;margin-top:3px}
      .pl-facts small{display:block;font-size:11px;font-weight:400;color:#9ca3af;margin-top:2px}
      .pl-alert{background:#fef3c7;color:#92400e;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:12px}
      .pl-table td.pl-prod{white-space:normal;min-width:220px}
      .pl-table td.pl-calc{color:#9ca3af}
      .pl-table td.pl-nocode{color:#b45309;font-weight:600}
      .pl-table tfoot td{font-weight:700;background:#f5f7fa;padding:8px 10px}
      .pl-vb{color:#15803d;font-weight:700}
      .pl-hint{font-size:12px;color:#9ca3af;margin:8px 0 0}
      .pl-dlg{border:0;border-radius:12px;padding:0;width:min(1000px,96vw);max-height:92vh;box-shadow:0 20px 60px rgba(0,0,0,.3);color:#1f2937}
      .pl-dlg::backdrop{background:rgba(17,24,39,.45)}
      .pl-dlg-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eef0f3}
      .pl-dlg-head h2{margin:0;font-size:18px}
      .pl-dlg-body{padding:16px 20px;overflow:auto;max-height:calc(92vh - 130px)}
      .pl-dlg-foot{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid #eef0f3;font-size:13px;color:#4b5563}
      .pl-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .pl-grid4 label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#4b5563;font-weight:600}
      .pl-grid4 input,.pl-grid4 select,.pl-lines input{border:1px solid #d1d5db;border-radius:6px;padding:8px 10px;font:inherit;font-size:14px;font-weight:400;width:100%;box-sizing:border-box}
      .pl-grid4 input:disabled,.pl-grid4 select:disabled{background:#f3f4f6;color:#4b5563;cursor:not-allowed}
      .pl-lines{width:100%;border-collapse:collapse;font-size:13px}
      .pl-lines th{background:#f5f7fa;text-align:left;padding:8px 6px;white-space:nowrap}
      .pl-lines th.num,.pl-lines input.num{text-align:right}
      .pl-lines td{padding:4px}
      .pl-out{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums;padding-right:8px!important}
      .pl-ih{font-size:14px;margin:16px 0 8px}
      .pl-ih label{display:flex;gap:8px;align-items:center;cursor:pointer}
      .pl-itable td{vertical-align:top}
      .pl-itable td small{display:block;color:#6b7280;font-size:12px;margin-top:2px}
      .pl-itable .pl-idet{color:#92400e}
      .pl-itable input{width:16px;height:16px;accent-color:#4f5bd5}
      .pl-ic{font-size:14px;margin-right:6px}
      .pl-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;background:#f3f4f6;color:#6b7280}
      .pl-tag-n{background:#dcfce7;color:#166534}
      .pl-tag-c{background:#fef3c7;color:#92400e}
      .pl-tag-ok{background:#e0e7ff;color:#3730a3}
      .pl-igh{font-size:13px;color:#4b5563;margin:16px 0 8px}
      .pl-igh a{color:#4f5bd5;margin-left:6px}
      .pl-new-sm{display:none;gap:8px;margin-top:10px}
      .pl-new-sm .pl-b{flex:1}
      .pl-x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:4px 8px}
      @media (max-width:900px){
        .pl-wrap{grid-template-columns:1fr}
        .pl-list{position:static;max-height:none}
        .pl-wrap.pl-show .pl-list{display:none}
        .pl-wrap:not(.pl-show) .pl-detail{display:none}
        .pl-back{display:inline-block}
        .pl-new-sm{display:flex}
        .pl-grid4{grid-template-columns:1fr 1fr}
        .pl-plate{font-size:24px}
      }
    `;
    document.head.appendChild(s);
  }

  return { init, render, cargar, tiene, firma, abrir, nuevo, seleccionar, formNuevo, pdfContenedores };
})();
