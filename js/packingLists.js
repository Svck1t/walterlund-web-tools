// =====================================================
// SECCIÓN: PACKING LISTS — v2 (sección propia, conectada con Control Importaciones)
// Fuente: planilla "Packing Lists" (PL_Cabecera + PL_Detalle) vía /api/packing-lists
// Cruza con Importaciones para proveedor, orden, llegada, estado, GE y bodega
// =====================================================

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
  const bodCls = b => { const u = String(b || '').toUpperCase(); return u.includes('ALDUNATE') ? 'ald' : u.includes('VIEL') ? 'viel' : ''; };
  const sinBodega = b => !b || String(b).toUpperCase().includes('POR ASIGNAR');
  const has = (pl, i) => pl.l.some(l => l[i] !== null && l[i] !== '' && l[i] !== undefined && l[i] !== 0);

  // Datos del contenedor combinando packing list + Importaciones
  function info(pl) {
    const r = imp.get(norm(pl.c)) || {};
    const bodega = sinBodega(pl.b) && r.bodega ? r.bodega : (pl.b || 'POR ASIGNAR');
    const guias = pl.g.length ? pl.g : (r.ge ? String(r.ge).split(/[,/]/).map(s => s.trim()).filter(Boolean) : []);
    return { r, bodega, guias, bodegaImp: sinBodega(pl.b) && !!r.bodega, geImp: !pl.g.length && guias.length > 0, fecha: r.llegada || r.eta || String(pl.creado || '').slice(0, 10) };
  }
  function alertas(pl) {
    const a = [];
    if (!pl.c) a.push('Falta el N° de contenedor');
    if (pl.l.some(l => !l[0] || l[0].toUpperCase() === 'SIN CÓDIGO')) a.push('Hay líneas sin código asignado');
    if (pl.c && !imp.has(norm(pl.c))) a.push('El contenedor no aparece en Importaciones');
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
        porCont = new Map(items.filter(x => x.c).map(x => [norm(x.c), x]));
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
      const pl = porCont.get(a.c);
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
  const tiene = c => porCont.has(norm(c));
  const firma = () => items.map(x => x.id + ':' + (x.c || '') + ':' + x.l.length).join('|');
  function abrir(c) { accion = { tipo: 'ver', c: norm(c) }; irSeccion(); }
  function nuevo(c) { accion = { tipo: 'nuevo', c: norm(c) }; irSeccion(); }
  function pdfContenedores(conts) {
    const lista = conts.map(c => porCont.get(norm(c))).filter(Boolean);
    if (!lista.length) { toast('Ninguno de esos contenedores tiene packing list', true); return; }
    pdf(lista);
  }

  // ============ RENDER ============
  // Lo llama ContendedoresSection cada vez que dibuja la pestaña (también en el auto-refresh)
  function render(container, rowsImportaciones) {
    injectStyles();
    imp = new Map();
    (rowsImportaciones || []).forEach(r => { const k = norm(r.contenedor); if (k && !imp.has(k)) imp.set(k, r); });
    const yaMontado = body === container && container.querySelector('.pl-wrap');
    body = container;
    if (!yaMontado) {
      body.innerHTML = `<div class="pl-wrap">
        <aside class="pl-list">
          <div class="pl-list-head">
            <input class="ci-search pl-search" id="pl-q" type="search" placeholder="Buscar contenedor, GE, código o producto" value="${esc(st.q)}">
            <div class="pl-filters" id="pl-filters"></div>
            <button class="pl-b pl-pri pl-new-sm" data-new>➕ Nuevo packing list</button>
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
    body.querySelector('.pl-new-sm').addEventListener('click', () => abrirForm(null));
    body.querySelector('#pl-selall').addEventListener('click', e => { e.preventDefault(); filtrados().forEach(pl => st.marked.add(pl.id)); renderList(); });
    body.querySelector('#pl-selclear').addEventListener('click', () => { st.marked.clear(); renderList(); });
    body.querySelector('#pl-selprint').addEventListener('click', () => pdf(ordenados().filter(pl => st.marked.has(pl.id))));
    body.querySelector('#pl-detail').addEventListener('click', e => {
      if (e.target.closest('[data-back]')) body.querySelector('.pl-wrap').classList.remove('pl-show');
      if (e.target.closest('[data-new]')) abrirForm(null);
      if (e.target.closest('[data-edit]')) abrirForm(items.find(x => x.id === st.sel));
      if (e.target.closest('[data-pdf1]')) pdf(items.filter(x => x.id === st.sel));
      if (e.target.closest('[data-imp]')) { const pl = items.find(x => x.id === st.sel); if (pl && pl.c) ContendedoresSection.abrir(pl.c); }
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
    const bar = (extra = '') => `<div class="pl-top"><button class="pl-b pl-back" data-back>‹ Contenedores</button><span></span><div class="pl-acts">${extra}<button class="pl-b pl-pri" data-new>➕ Nuevo packing list</button></div></div>`;
    if (errorCarga) { el.innerHTML = bar() + `<p class="ci-err">Revisa que api/packing-lists.js tenga la URL del Web App. <button class="pl-b" data-retry>Reintentar</button></p>`; return; }
    const pl = items.find(x => x.id === st.sel);
    if (!pl) { el.innerHTML = bar() + `<p class="ci-empty">${cargado ? 'Elige un contenedor de la lista o crea un packing list nuevo' : 'Cargando…'}</p>`; return; }
    const i = info(pl), C = cols(pl), sum = k => pl.l.reduce((s, l) => s + (Number(l[k]) || 0), 0);
    const bc = bodCls(i.bodega), al = alertas(pl);
    const c = pl.c || '';
    el.innerHTML = bar(`${c && imp.has(norm(c)) ? '<button class="pl-b" data-imp>🚢 Ver en Importaciones</button>' : ''}<button class="pl-b" data-edit>✏️ Editar</button><button class="pl-b" data-pdf1>📄 PDF</button>`) + `
      <div class="pl-headline">
        ${c ? `<div class="pl-plate"><span>${esc(c.slice(0, 4))}</span><span>${esc(c.slice(4, 10))}</span><span class="pl-chk">${esc(c.slice(10))}</span></div>` : '<div class="pl-plate pl-plate-none">Sin N° contenedor</div>'}
        <div><strong>${esc(i.r.proveedor || 'No aparece en Importaciones')}</strong><small>${esc(i.r.material || '')}${i.r.orden ? ' · Orden ' + esc(i.r.orden) : ''}</small></div>
      </div>
      <div class="pl-facts">
        <div><span>Bodega destino</span><b><span class="ci-bod${bc ? ' ci-bod-' + bc : ''}">${esc(bodLbl(i.bodega))}</span>${i.bodegaImp ? '<small>según Importaciones</small>' : ''}</b></div>
        <div><span>${i.guias.length > 1 ? 'Guías de entrada' : 'Guía de entrada'}</span><b>${i.guias.length ? i.guias.map(esc).join(', ') : '—'}${i.geImp ? '<small>según Importaciones</small>' : ''}</b></div>
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
      <p class="pl-hint">Totales y kg por unidad calculados desde las líneas · ${esc(pl.id)}${pl.origen && pl.origen !== 'web' ? ' · migrado de ' + esc(pl.origen) : ''}</p>`;
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
  function infoImp() {
    const c = dlg.querySelector('#pl-fc').value, r = imp.get(c), el = dlg.querySelector('#pl-fimp');
    el.textContent = c.length === 11 ? (r ? `En Importaciones: ${r.proveedor || ''} · ${r.material || ''}${r.ge ? ' · GE ' + r.ge : ''}${r.bodega ? ' · ' + r.bodega : ''}` : 'Este contenedor todavía no aparece en Importaciones.') : '';
    if (r && !dlg.querySelector('#pl-fg').value && r.ge) dlg.querySelector('#pl-fg').value = r.ge;
    if (r && r.bodega && dlg.querySelector('#pl-fb').value === 'POR ASIGNAR') {
      const b = BODEGAS.find(x => String(r.bodega).toUpperCase().includes(x)); if (b) dlg.querySelector('#pl-fb').value = b;
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
    if (!pl && contSugerido) infoImp();
    dlg.showModal();
    dlg.querySelector('#pl-fc').focus();
  }
  async function guardar() {
    const err = dlg.querySelector('#pl-ferr'), btn = dlg.querySelector('#pl-save');
    const c = dlg.querySelector('#pl-fc').value;
    err.textContent = '';
    if (c && !/^[A-Z]{4}\d{7}$/.test(c)) { err.textContent = 'El N° de contenedor debe tener 4 letras y 7 dígitos.'; return; }
    if (c && items.some(x => x.c === c && x.id !== editId)) { err.textContent = `${c} ya tiene packing list.`; return; }
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
      .pl-new-sm{display:none;width:100%;margin-top:10px}
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
      .pl-lines{width:100%;border-collapse:collapse;font-size:13px}
      .pl-lines th{background:#f5f7fa;text-align:left;padding:8px 6px;white-space:nowrap}
      .pl-lines th.num,.pl-lines input.num{text-align:right}
      .pl-lines td{padding:4px}
      .pl-out{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums;padding-right:8px!important}
      .pl-x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:4px 8px}
      @media (max-width:900px){
        .pl-wrap{grid-template-columns:1fr}
        .pl-list{position:static;max-height:none}
        .pl-wrap.pl-show .pl-list{display:none}
        .pl-wrap:not(.pl-show) .pl-detail{display:none}
        .pl-back{display:inline-block}
        .pl-new-sm{display:block}
        .pl-grid4{grid-template-columns:1fr 1fr}
        .pl-plate{font-size:24px}
      }
    `;
    document.head.appendChild(s);
  }

  return { init, render, cargar, tiene, firma, abrir, nuevo, pdfContenedores };
})();
