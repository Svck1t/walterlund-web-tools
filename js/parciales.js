// =====================================================
// SECCIÓN: DESPACHOS PARCIALES — v1
// Una "carpeta" por factura despachada por partes: productos facturados, guías de despacho
// (con foto/PDF en Drive) y saldo pendiente calculado. Cruza con Stock en vivo para ver
// si hoy hay stock para completar el saldo.
// Fuente: /api/parciales (Apps Script + Google Sheets)
// =====================================================

const ParcialesSection = (() => {
  const API = '/api/parciales';
  const STOCK_URL = '/api/stock-live';
  const BODEGAS = ['ALDUNATE', 'VIEL', 'SAN IGNACIO', 'SAN FRANCISCO', 'STGO CONCHA'];
  const MOTIVOS = ['Sin stock', 'En corte / producción', 'Esperando contenedor', 'Cliente pidió por partes', 'Falta transporte', 'Otro'];
  const FILTROS = [['abiertos', 'Abiertos'], ['atrasados', 'Atrasados'], ['completos', 'Completados'], ['cerrados', 'Cerrados con N/C'], ['todos', 'Todos']];
  const MAX_ARCHIVO = 3 * 1024 * 1024; // después de comprimir (el proxy acepta ~4 MB)

  let items = [], hoy = '', cargado = false, errorCarga = '', root = null;
  const st = { filtro: 'abiertos', q: '', sel: null };
  let stock = null, stockEstado = 'sin cargar'; // Map codigo -> { producto, unidad, total, bodegas }
  let dlgP = null, dlgE = null;

  // ============ UTILIDADES ============
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: d || 2 });
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : iso; };
  const dia = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const hoyLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const cap = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '';
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Acepta "1.500", "1500", "12,5"
  const num = v => { let s = String(v ?? '').trim(); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); const n = Number(s); return isNaN(n) ? null : n; };

  // Facturado, entregado y saldo por línea
  function calc(p) {
    const ent = {};
    p.entregas.forEach(e => { let c = {}; try { c = JSON.parse(e.cantidades || '{}'); } catch (x) {} Object.keys(c).forEach(n => { ent[n] = (ent[n] || 0) + Number(c[n] || 0); }); });
    const lineas = p.lineas.map(l => { const fac = Number(l.cantidad) || 0, e = ent[l.n] || 0; return { ...l, fac, ent: e, saldo: Math.max(fac - e, 0) }; });
    const fac = lineas.reduce((s, l) => s + l.fac, 0), entT = lineas.reduce((s, l) => s + Math.min(l.ent, l.fac), 0);
    return { lineas, pct: fac ? Math.round(entT / fac * 100) : 0, pendientes: lineas.filter(l => l.saldo > 0) };
  }
  const abierto = p => p.estado === 'ABIERTO';
  const atrasado = p => abierto(p) && p.compromiso && dia(p.compromiso) < dia(hoy);
  const diasAbierto = p => p.fechaFactura ? dia(hoy) - dia(p.fechaFactura) : null;
  function semaforo(p) {
    if (!abierto(p)) return '';
    if (!p.compromiso) return 'gris';
    const n = dia(p.compromiso) - dia(hoy);
    return n < 0 ? 'rojo' : n <= 2 ? 'amarillo' : 'verde';
  }
  const stockDe = cod => stock && cod ? stock.get(String(cod).trim().toUpperCase()) : null;
  // ¿Alcanza el stock de hoy para completar todo el saldo?
  const completable = p => abierto(p) && stock && calc(p).pendientes.every(l => { const s = stockDe(l.codigo); return s && s.total >= l.saldo; });

  // ============ CARGA ============
  async function cargar() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      items = d.parciales; hoy = d.hoy || hoyLocal(); cargado = true; errorCarga = '';
    } catch (err) {
      console.error('Parciales:', err); errorCarga = err.message; hoy = hoy || hoyLocal();
    }
    dibujar();
  }
  // Stock en vivo (misma fuente que la sección Stock): catálogo de códigos + stock por bodega
  async function cargarStock() {
    if (stockEstado === 'cargando' || typeof ExcelReader === 'undefined') return;
    stockEstado = 'cargando'; dibujarStockMeta();
    try {
      const r = await fetch(STOCK_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const recs = await ExcelReader.readFile(new File([await r.blob()], 'stock.xls', { type: 'application/vnd.ms-excel' }));
      stock = new Map(recs.filter(x => x.codProducto).map(x => [String(x.codProducto).trim().toUpperCase(), {
        producto: x.producto, unidad: x.unidadMedida, total: Number(x.disponible ?? x.stockTotal) || 0, bodegas: x.bodegas || {}
      }]));
      stockEstado = 'ok';
    } catch (err) { console.error('Stock parciales:', err); stockEstado = 'error'; }
    dibujar();
  }

  async function post(body) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d; try { d = await r.json(); } catch (e) { throw new Error(r.status === 413 ? 'El archivo es muy grande' : 'HTTP ' + r.status); }
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
    return d;
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="dp">
      <div class="section-header dp-head">
        <div><h1>Despachos Parciales</h1><p>Facturas despachadas por partes: guías, saldo pendiente y stock para completar.</p></div>
        <div class="dp-acts"><button class="dp-b" id="dp-ref">🔄 Actualizar</button><button class="dp-b dp-pri" id="dp-new">➕ Nuevo parcial</button></div>
      </div>
      <div class="dp-kpis" id="dp-kpis"></div>
      <div class="dp-wrap">
        <aside class="dp-list">
          <div class="dp-list-head">
            <input class="dp-in" id="dp-q" type="search" placeholder="Buscar factura, cliente, guía o código" value="${esc(st.q)}">
            <div class="dp-chips" id="dp-chips"></div>
          </div>
          <div class="dp-items" id="dp-items"><p class="dp-empty">Cargando…</p></div>
          <p class="dp-stockmeta" id="dp-stockmeta"></p>
        </aside>
        <section class="dp-detail" id="dp-detail"></section>
      </div>
    </div>`;
    // listeners sobre elementos recién creados: no se acumulan al volver a la sección
    root.querySelector('#dp-ref').addEventListener('click', () => { cargar(); cargarStock(); });
    root.querySelector('#dp-new').addEventListener('click', () => abrirParcial(null));
    root.querySelector('#dp-q').addEventListener('input', e => { st.q = e.target.value; dibujarLista(); });
    root.querySelector('#dp-chips').addEventListener('click', e => { const t = e.target.closest('[data-f]'); if (t) { st.filtro = t.dataset.f; dibujar(); } });
    root.querySelector('#dp-items').addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) { st.sel = t.dataset.id; root.querySelector('.dp-wrap').classList.add('dp-show'); dibujarLista(); dibujarDetalle(); } });
    root.querySelector('#dp-detail').addEventListener('click', accionDetalle);
    dibujar();
    cargar();
    if (!stock) cargarStock();
  }

  function filtrados() {
    const q = txt(st.q.trim());
    const f = {
      abiertos: abierto, atrasados: atrasado, completos: p => p.estado === 'COMPLETO', cerrados: p => p.estado === 'CERRADO', todos: () => true
    }[st.filtro];
    return items.filter(f).filter(p => !q || txt([p.factura, p.cliente, p.motivo, p.bodega, ...p.entregas.map(e => e.guia), ...p.lineas.map(l => l.codigo + ' ' + l.producto)].join(' ')).includes(q))
      .sort((a, b) => (abierto(b) - abierto(a)) || String(a.compromiso || '9').localeCompare(String(b.compromiso || '9')) || String(a.fechaFactura).localeCompare(String(b.fechaFactura)));
  }

  // ============ RENDER ============
  function dibujar() {
    if (!root || !root.querySelector('.dp')) return;
    const ab = items.filter(abierto);
    const mes = hoy.slice(0, 7);
    root.querySelector('#dp-kpis').innerHTML = [
      ['Parciales abiertos', ab.length, ''],
      ['Atrasados', items.filter(atrasado).length, 'rojo'],
      ['Se pueden completar hoy', stock ? ab.filter(completable).length : '…', 'verde'],
      ['Completados este mes', items.filter(p => p.estado === 'COMPLETO' && String(p.actualizado).startsWith(mes)).length, '']
    ].map(([l, v, c]) => `<div class="dp-kpi ${c}"><span>${l}</span><strong>${v}</strong></div>`).join('');
    const n = k => items.filter({ abiertos: abierto, atrasados: atrasado, completos: p => p.estado === 'COMPLETO', cerrados: p => p.estado === 'CERRADO', todos: () => true }[k]).length;
    root.querySelector('#dp-chips').innerHTML = FILTROS.map(([k, l]) => `<button class="dp-chip${st.filtro === k ? ' on' : ''}" data-f="${k}">${l} <b>${n(k)}</b></button>`).join('');
    dibujarLista(); dibujarDetalle(); dibujarStockMeta();
  }
  function dibujarStockMeta() {
    const el = root && root.querySelector('#dp-stockmeta'); if (!el) return;
    el.textContent = { 'sin cargar': '', cargando: 'Cargando stock en vivo…', ok: `Stock en vivo: ${nf(stock ? stock.size : 0)} productos`, error: 'No se pudo cargar el stock en vivo (los parciales funcionan igual)' }[stockEstado];
  }

  function dibujarLista() {
    const el = root && root.querySelector('#dp-items'); if (!el) return;
    if (errorCarga) { el.innerHTML = `<p class="dp-err">No se pudieron cargar los parciales: ${esc(errorCarga)}</p>`; return; }
    if (!cargado) return;
    const f = filtrados();
    if (!st.sel && f.length && !window.matchMedia('(max-width: 900px)').matches) st.sel = f[0].id;
    el.innerHTML = f.map(p => {
      const c = calc(p), sem = semaforo(p), d = diasAbierto(p);
      const tag = p.estado === 'COMPLETO' ? '<span class="dp-tag ok">Completo</span>' : p.estado === 'CERRADO' ? '<span class="dp-tag nc">Cerrado N/C</span>' : completable(p) ? '<span class="dp-tag stock">Hay stock</span>' : '';
      return `<button class="dp-item${st.sel === p.id ? ' cur' : ''}" data-id="${esc(p.id)}">
        <div class="dp-item-top">${sem ? `<i class="dp-dot ${sem}"></i>` : ''}<b>N° ${esc(p.factura)}</b>${tag}<span class="dp-pct">${c.pct}%</span></div>
        <small>${esc(p.cliente || 'Sin cliente')}${p.motivo ? ' · ' + esc(p.motivo) : ''}</small>
        <div class="dp-bar"><span style="width:${c.pct}%"></span></div>
        <small>${p.entregas.length} ${p.entregas.length === 1 ? 'guía' : 'guías'}${abierto(p) && d !== null ? ` · ${d} ${d === 1 ? 'día' : 'días'} abierto` : ''}${abierto(p) && p.compromiso ? ' · compromiso ' + fCorta(p.compromiso) : ''}</small>
      </button>`;
    }).join('') || `<p class="dp-empty">${items.length ? 'Ningún parcial coincide' : 'Aún no hay parciales. Crea el primero con ➕ Nuevo parcial'}</p>`;
  }

  function dibujarDetalle() {
    const el = root && root.querySelector('#dp-detail'); if (!el) return;
    const p = items.find(x => x.id === st.sel);
    if (!p) { el.innerHTML = `<div class="dp-card dp-empty">${cargado ? 'Elige un parcial de la lista' : 'Cargando…'}</div>`; return; }
    const c = calc(p), sem = semaforo(p);
    const estado = p.estado === 'COMPLETO' ? '<span class="dp-tag ok">Completo</span>' : p.estado === 'CERRADO' ? '<span class="dp-tag nc">Cerrado con N/C</span>' : '<span class="dp-tag ab">Abierto</span>';
    const stockCell = l => {
      if (l.saldo <= 0) return '<span class="dp-dim">—</span>';
      if (!stock) return `<span class="dp-dim">${stockEstado === 'cargando' ? '…' : '—'}</span>`;
      const s = stockDe(l.codigo);
      if (!s) return '<span class="dp-dim">sin código</span>';
      const bods = Object.entries(s.bodegas).filter(([, v]) => v > 0).map(([b, v]) => `${cap(b)}: ${nf(v)}`).join(' · ');
      return `<span class="${s.total >= l.saldo ? 'dp-ok' : s.total > 0 ? 'dp-warn' : 'dp-bad'}" title="${esc(bods)}">${nf(s.total)}</span>${bods ? `<small>${esc(bods)}</small>` : ''}`;
    };
    el.innerHTML = `
      <div class="dp-top"><button class="dp-b dp-back" data-back>‹ Parciales</button>
        <div class="dp-acts">
          ${abierto(p) ? '<button class="dp-b dp-pri" data-ent>📄 Registrar entrega</button>' : ''}
          <button class="dp-b" data-edit>✏️ Editar</button>
          ${abierto(p) ? '<button class="dp-b" data-cerrar>Cerrar con N/C</button>' : p.estado === 'CERRADO' ? '<button class="dp-b" data-reabrir>Reabrir</button>' : ''}
          <button class="dp-b dp-del" data-borrar title="Eliminar parcial">🗑</button>
        </div></div>
      <div class="dp-card">
        <div class="dp-hl">
          <div><h2>Factura N° ${esc(p.factura)} ${estado}</h2><p>${esc(p.cliente || 'Sin cliente')}</p></div>
          <div class="dp-big"><strong>${c.pct}%</strong><span>entregado</span></div>
        </div>
        <div class="dp-bar dp-bar-lg"><span style="width:${c.pct}%"></span></div>
        <div class="dp-facts">
          <div><span>Fecha factura</span><b>${fCorta(p.fechaFactura)}</b></div>
          <div><span>Bodega</span><b>${esc(cap(p.bodega) || 'Aldunate')}</b></div>
          <div><span>Motivo</span><b>${esc(p.motivo || '—')}</b></div>
          <div><span>Compromiso saldo</span><b>${sem ? `<i class="dp-dot ${sem}"></i>` : ''}${fCorta(p.compromiso)}</b></div>
        </div>
        ${p.estado === 'CERRADO' && p.cierre ? `<div class="dp-note nc">Cerrado: ${esc(p.cierre)}</div>` : ''}
        ${p.obs ? `<div class="dp-note">${esc(p.obs)}</div>` : ''}
      </div>

      <div class="dp-card dp-pad0">
        <h3 class="dp-h3">Productos</h3>
        <div class="dp-tw"><table class="dp-t">
          <thead><tr><th>Código</th><th>Producto</th><th class="num">Facturado</th><th class="num">Entregado</th><th class="num">Saldo</th><th class="num">Stock hoy</th></tr></thead>
          <tbody>${c.lineas.map(l => `<tr class="${l.saldo > 0 ? '' : 'dp-done'}">
            <td><b>${esc(l.codigo || '—')}</b></td><td>${esc(l.producto)}${l.unidad ? ` <small>${esc(l.unidad)}</small>` : ''}</td>
            <td class="num">${nf(l.fac)}</td><td class="num">${nf(l.ent)}</td>
            <td class="num"><b class="${l.saldo > 0 ? 'dp-saldo' : 'dp-ok'}">${l.saldo > 0 ? nf(l.saldo) : '✓'}</b></td>
            <td class="num dp-stock">${stockCell(l)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="dp-card dp-pad0">
        <h3 class="dp-h3">Guías de despacho <span class="dp-dim">(${p.entregas.length})</span></h3>
        ${p.entregas.length ? `<ol class="dp-tl">${p.entregas.map((e, i) => {
          let cant = {}; try { cant = JSON.parse(e.cantidades || '{}'); } catch (x) {}
          const det = c.lineas.filter(l => Number(cant[l.n]) > 0).map(l => `<li><b>${nf(cant[l.n])}</b> ${esc(l.codigo || l.producto)}</li>`).join('');
          return `<li>
            <div class="dp-tl-head"><b>Entrega ${i + 1} · Guía N° ${esc(e.guia)}</b><span>${fCorta(e.fecha)}</span></div>
            <ul class="dp-tl-items">${det || '<li class="dp-dim">Sin cantidades</li>'}</ul>
            ${e.nota ? `<p class="dp-tl-nota">${esc(e.nota)}</p>` : ''}
            <div class="dp-tl-acts">${e.archivoUrl ? `<a class="dp-b dp-sm" href="${esc(e.archivoUrl)}" target="_blank" rel="noopener">📎 Ver guía</a>` : '<span class="dp-dim">Sin archivo adjunto</span>'}
              <button class="dp-b dp-sm dp-del" data-delent="${esc(e.id)}">Eliminar</button></div>
          </li>`;
        }).join('')}</ol>` : '<p class="dp-empty">Aún no hay guías registradas.</p>'}
      </div>`;
  }

  async function accionDetalle(e) {
    const p = items.find(x => x.id === st.sel);
    if (e.target.closest('[data-back]')) { root.querySelector('.dp-wrap').classList.remove('dp-show'); return; }
    if (!p) return;
    if (e.target.closest('[data-ent]')) return abrirEntrega(p);
    if (e.target.closest('[data-edit]')) return abrirParcial(p);
    if (e.target.closest('[data-cerrar]')) {
      const m = prompt(`¿Por qué se cierra el saldo de la factura ${p.factura}?\nEj: N/C 12345 por saldo no despachado`, 'N/C ');
      if (m === null) return;
      return ejecutar({ action: 'cerrar', id: p.id, cierre: m.trim() }, 'Parcial cerrado');
    }
    if (e.target.closest('[data-reabrir]')) return ejecutar({ action: 'reabrir', id: p.id }, 'Parcial reabierto');
    if (e.target.closest('[data-borrar]')) {
      if (!confirm(`¿Eliminar el parcial de la factura ${p.factura} con todas sus guías? Esto no se puede deshacer.`)) return;
      st.sel = null;
      return ejecutar({ action: 'borrar', id: p.id }, 'Parcial eliminado');
    }
    const de = e.target.closest('[data-delent]');
    if (de) {
      if (!confirm('¿Eliminar esta guía? Su archivo también se borra de Drive.')) return;
      return ejecutar({ action: 'borrarEntrega', id: de.dataset.delent }, 'Guía eliminada');
    }
  }
  async function ejecutar(body, ok) {
    try { await post(body); toast(ok); await cargar(); }
    catch (err) { toast(err.message, true); }
  }

  // ============ NUEVO / EDITAR PARCIAL ============
  function crearDlgP() {
    if (dlgP) return;
    dlgP = document.createElement('dialog');
    dlgP.className = 'dp-dlg';
    dlgP.innerHTML = `<form method="dialog" class="dp-dlg-in">
      <div class="dp-dlg-head"><h2 id="dpp-t">Nuevo parcial</h2><button type="button" class="dp-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="dp-dlg-body">
        <div class="dp-grid">
          <label>N° factura<input class="dp-in" id="dpp-fac" inputmode="numeric" autocomplete="off" required></label>
          <label>Fecha factura<input class="dp-in" id="dpp-ff" type="date"></label>
          <label class="dp-span2">Cliente<input class="dp-in" id="dpp-cli" autocomplete="off"></label>
          <label>Bodega<select class="dp-in" id="dpp-bod">${BODEGAS.map(b => `<option value="${b}">${cap(b)}</option>`).join('')}</select></label>
          <label>Motivo del parcial<select class="dp-in" id="dpp-mot"><option value="">—</option>${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
          <label>Compromiso para el saldo<input class="dp-in" id="dpp-comp" type="date"></label>
          <label>Observación<input class="dp-in" id="dpp-obs" autocomplete="off"></label>
        </div>
        <h3 class="dp-h3 dp-mt">Productos facturados</h3>
        <div class="dp-tw"><table class="dp-t dp-lines"><thead><tr><th style="width:22%">Código</th><th>Producto</th><th style="width:12%">Unidad</th><th class="num" style="width:14%">Cantidad</th><th style="width:36px"></th></tr></thead><tbody id="dpp-lb"></tbody></table></div>
        <button type="button" class="dp-b dp-mt8" id="dpp-add">➕ Agregar producto</button>
        <p class="dp-hint">Escribe el código y se completan el producto y la unidad desde el stock en vivo.</p>
        <datalist id="dpp-codes"></datalist>
      </div>
      <div class="dp-dlg-foot"><span class="dp-err" id="dpp-err"></span><button type="button" class="dp-b dp-pri" id="dpp-save">Guardar</button></div>
    </form>`;
    document.body.appendChild(dlgP);
    dlgP.querySelector('[data-close]').addEventListener('click', () => dlgP.close());
    dlgP.querySelector('#dpp-add').addEventListener('click', () => { lineaP({}); dlgP.querySelector('#dpp-lb').lastElementChild.querySelector('input').focus(); });
    dlgP.querySelector('#dpp-lb').addEventListener('click', e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const tr = b.closest('tr');
      if (Number(tr.dataset.ent) > 0) { toast('Ese producto ya tiene entregas; no se puede quitar', true); return; }
      tr.remove();
    });
    dlgP.querySelector('#dpp-lb').addEventListener('input', e => {
      if (e.target.dataset.k !== 'cod') return;
      const s = stockDe(e.target.value), tr = e.target.closest('tr');
      if (s) { tr.querySelector('[data-k="prod"]').value = s.producto; tr.querySelector('[data-k="uni"]').value = s.unidad || ''; }
    });
    dlgP.querySelector('#dpp-save').addEventListener('click', guardarP);
  }
  function lineaP(l) {
    const tr = document.createElement('tr');
    tr.dataset.n = l.n ?? ''; tr.dataset.ent = l.ent || 0;
    tr.innerHTML = `<td><input class="dp-in" data-k="cod" list="dpp-codes" value="${esc(l.codigo)}" autocomplete="off" aria-label="Código"></td>
      <td><input class="dp-in" data-k="prod" value="${esc(l.producto)}" aria-label="Producto"></td>
      <td><input class="dp-in" data-k="uni" value="${esc(l.unidad)}" aria-label="Unidad"></td>
      <td><input class="dp-in num" data-k="cant" inputmode="decimal" value="${esc(l.cantidad)}" aria-label="Cantidad"></td>
      <td><button type="button" class="dp-x" data-del aria-label="Quitar">✕</button></td>`;
    dlgP.querySelector('#dpp-lb').appendChild(tr);
  }
  let editP = null;
  function abrirParcial(p) {
    crearDlgP();
    editP = p;
    const $ = id => dlgP.querySelector(id);
    $('#dpp-t').textContent = p ? `Editar parcial · Factura ${p.factura}` : 'Nuevo parcial';
    $('#dpp-fac').value = p ? p.factura : '';
    $('#dpp-ff').value = p ? p.fechaFactura : hoyLocal();
    $('#dpp-cli').value = p ? p.cliente : '';
    $('#dpp-bod').value = p && BODEGAS.includes(String(p.bodega).toUpperCase()) ? String(p.bodega).toUpperCase() : 'ALDUNATE';
    $('#dpp-mot').value = p ? p.motivo : '';
    $('#dpp-comp').value = p ? p.compromiso : '';
    $('#dpp-obs').value = p ? p.obs : '';
    $('#dpp-err').textContent = '';
    $('#dpp-codes').innerHTML = stock ? [...stock.entries()].slice(0, 5000).map(([k, v]) => `<option value="${esc(k)}">${esc(v.producto)}</option>`).join('') : '';
    $('#dpp-lb').innerHTML = '';
    (p ? calc(p).lineas : [{}, {}]).forEach(lineaP);
    dlgP.showModal();
    $('#dpp-fac').focus();
  }
  async function guardarP() {
    const $ = id => dlgP.querySelector(id), err = $('#dpp-err'), btn = $('#dpp-save');
    err.textContent = '';
    const filas = [...$('#dpp-lb').querySelectorAll('tr')];
    let maxN = Math.max(-1, ...filas.map(tr => tr.dataset.n === '' ? -1 : Number(tr.dataset.n)));
    const lineas = [];
    for (const tr of filas) {
      const g = k => tr.querySelector(`[data-k="${k}"]`).value.trim();
      if (!g('cod') && !g('prod')) continue;
      const cant = num(g('cant'));
      if (!cant || cant <= 0) { err.textContent = `Falta la cantidad de ${g('cod') || g('prod')}`; return; }
      if (Number(tr.dataset.ent) > cant) { err.textContent = `${g('cod') || g('prod')}: ya se entregaron ${nf(tr.dataset.ent)}, no puede quedar en ${nf(cant)}`; return; }
      lineas.push({ n: tr.dataset.n === '' ? ++maxN : Number(tr.dataset.n), codigo: g('cod').toUpperCase(), producto: g('prod'), unidad: g('uni'), cantidad: cant });
    }
    if (!$('#dpp-fac').value.trim()) { err.textContent = 'Falta el N° de factura'; return; }
    if (!lineas.length) { err.textContent = 'Agrega al menos un producto con su cantidad'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const d = await post({ action: 'guardar', p: { id: editP ? editP.id : '', factura: $('#dpp-fac').value.trim(), fechaFactura: $('#dpp-ff').value, cliente: $('#dpp-cli').value.trim(), bodega: $('#dpp-bod').value, motivo: $('#dpp-mot').value, compromiso: $('#dpp-comp').value, obs: $('#dpp-obs').value.trim() }, lineas });
      dlgP.close();
      st.sel = d.id; if (!editP) st.filtro = 'abiertos';
      toast(editP ? 'Parcial actualizado' : 'Parcial creado');
      await cargar();
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  }

  // ============ REGISTRAR ENTREGA ============
  let entP = null;
  function crearDlgE() {
    if (dlgE) return;
    dlgE = document.createElement('dialog');
    dlgE.className = 'dp-dlg';
    dlgE.innerHTML = `<form method="dialog" class="dp-dlg-in">
      <div class="dp-dlg-head"><h2 id="dpe-t">Registrar entrega</h2><button type="button" class="dp-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="dp-dlg-body">
        <div class="dp-grid">
          <label>N° guía de despacho<input class="dp-in" id="dpe-guia" inputmode="numeric" autocomplete="off" required></label>
          <label>Fecha<input class="dp-in" id="dpe-fecha" type="date"></label>
        </div>
        <div class="dp-h3row dp-mt"><h3 class="dp-h3">¿Qué se entregó?</h3><button type="button" class="dp-b dp-sm" id="dpe-todo">Entregar todo el saldo</button></div>
        <div class="dp-tw"><table class="dp-t dp-lines"><thead><tr><th>Producto</th><th class="num">Saldo</th><th class="num" style="width:26%">Entregado ahora</th></tr></thead><tbody id="dpe-lb"></tbody></table></div>
        <label class="dp-mt">Nota (opcional)<input class="dp-in" id="dpe-nota" placeholder="Ej: se despachó con camión de Viel" autocomplete="off"></label>
        <label class="dp-file dp-mt">
          <input type="file" id="dpe-file" accept="image/*,application/pdf">
          <span id="dpe-fname">📷 Adjuntar foto o PDF de la guía</span>
          <small>En el celular puedes sacar la foto directo. Las fotos se comprimen antes de subir.</small>
        </label>
      </div>
      <div class="dp-dlg-foot"><span class="dp-err" id="dpe-err"></span><button type="button" class="dp-b dp-pri" id="dpe-save">Guardar entrega</button></div>
    </form>`;
    document.body.appendChild(dlgE);
    dlgE.querySelector('[data-close]').addEventListener('click', () => dlgE.close());
    dlgE.querySelector('#dpe-todo').addEventListener('click', () => dlgE.querySelectorAll('#dpe-lb tr').forEach(tr => { tr.querySelector('input').value = tr.dataset.saldo; }));
    dlgE.querySelector('#dpe-file').addEventListener('change', e => {
      const f = e.target.files[0];
      dlgE.querySelector('#dpe-fname').textContent = f ? `📎 ${f.name}` : '📷 Adjuntar foto o PDF de la guía';
    });
    dlgE.querySelector('#dpe-save').addEventListener('click', guardarE);
  }
  function abrirEntrega(p) {
    crearDlgE();
    entP = p;
    const $ = id => dlgE.querySelector(id);
    $('#dpe-t').textContent = `Registrar entrega · Factura ${p.factura}`;
    $('#dpe-guia').value = ''; $('#dpe-fecha').value = hoyLocal(); $('#dpe-nota').value = '';
    $('#dpe-file').value = ''; $('#dpe-fname').textContent = '📷 Adjuntar foto o PDF de la guía'; $('#dpe-err').textContent = '';
    $('#dpe-lb').innerHTML = calc(p).pendientes.map(l => `<tr data-n="${esc(l.n)}" data-saldo="${l.saldo}">
      <td><b>${esc(l.codigo || '—')}</b><small class="dp-block">${esc(l.producto)}</small></td>
      <td class="num">${nf(l.saldo)}</td>
      <td><input class="dp-in num" inputmode="decimal" placeholder="0" aria-label="Cantidad entregada de ${esc(l.codigo || l.producto)}"></td></tr>`).join('');
    dlgE.showModal();
    $('#dpe-guia').focus();
  }
  // Foto -> JPEG máx. 1600 px (≈ 200–500 KB). PDF se sube tal cual.
  async function prepararArchivo(f) {
    if (!f) return null;
    if (f.type.startsWith('image/')) {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.75));
      return { nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', tipo: 'image/jpeg', base64: await aBase64(blob), size: blob.size };
    }
    return { nombre: f.name, tipo: f.type || 'application/pdf', base64: await aBase64(f), size: f.size };
  }
  const aBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  async function guardarE() {
    const $ = id => dlgE.querySelector(id), err = $('#dpe-err'), btn = $('#dpe-save');
    err.textContent = '';
    const guia = $('#dpe-guia').value.trim();
    if (!guia) { err.textContent = 'Falta el N° de guía'; return; }
    if (entP.entregas.some(e => e.guia === guia)) { err.textContent = `La guía ${guia} ya está registrada en esta factura`; return; }
    const cantidades = {};
    for (const tr of $('#dpe-lb').querySelectorAll('tr')) {
      const v = num(tr.querySelector('input').value);
      if (v === null || v === 0) continue;
      if (v < 0) { err.textContent = 'Las cantidades no pueden ser negativas'; return; }
      if (v > Number(tr.dataset.saldo)) { err.textContent = `Se está entregando más que el saldo (${nf(tr.dataset.saldo)}). Revisa la cantidad o edita lo facturado.`; return; }
      cantidades[tr.dataset.n] = v;
    }
    if (!Object.keys(cantidades).length) { err.textContent = 'Ingresa al menos una cantidad entregada'; return; }
    btn.disabled = true; btn.textContent = 'Preparando…';
    try {
      const archivo = await prepararArchivo($('#dpe-file').files[0]);
      if (archivo && archivo.size > MAX_ARCHIVO) throw new Error('El archivo pesa más de 3 MB. Si es PDF, intenta con una foto.');
      btn.textContent = archivo ? 'Subiendo guía…' : 'Guardando…';
      if (archivo) delete archivo.size;
      await post({ action: 'entrega', parcialId: entP.id, factura: entP.factura, guia, fecha: $('#dpe-fecha').value, nota: $('#dpe-nota').value.trim(), cantidades, archivo });
      dlgE.close();
      toast('Entrega registrada');
      await cargar();
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Guardar entrega'; }
  }

  function toast(msg, error) {
    const t = document.createElement('div');
    t.className = 'dp-toast' + (error ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function injectStyles() {
    if (document.getElementById('dp-styles')) return;
    const s = document.createElement('style');
    s.id = 'dp-styles';
    s.textContent = `
      .dp{color:#1c2733}
      .dp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .dp-acts{display:flex;gap:8px;flex-wrap:wrap}
      .dp-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
      .dp-b:hover{background:#f5f7fa}
      .dp-b:disabled{opacity:.6;cursor:wait}
      .dp-pri{background:#1565c0;border-color:#1565c0;color:#fff}
      .dp-pri:hover{background:#0f529e}
      .dp-del{color:#b91c1c}
      .dp-sm{padding:5px 10px;font-size:12px}
      .dp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:16px}
      .dp-kpi{background:#fff;border:1px solid #e1e5ea;border-left:4px solid #1565c0;border-radius:10px;padding:12px 14px}
      .dp-kpi.rojo{border-left-color:#dc2626}.dp-kpi.verde{border-left-color:#16a34a}
      .dp-kpi span{display:block;font-size:12px;color:#5b6b7a}
      .dp-kpi strong{display:block;font-size:24px;margin-top:2px}
      .dp-wrap{display:grid;grid-template-columns:340px minmax(0,1fr);gap:18px;align-items:start}
      .dp-list{background:#fff;border:1px solid #e1e5ea;border-radius:10px;display:flex;flex-direction:column;max-height:calc(100vh - 260px);min-height:420px;position:sticky;top:12px;overflow:hidden}
      .dp-list-head{padding:12px;border-bottom:1px solid #eef0f3}
      .dp-in{width:100%;box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#1c2733}
      .dp-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
      .dp-in.num{text-align:right}
      .dp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .dp-chip{border:1px solid #d4d9e0;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;color:#4b5563}
      .dp-chip b{margin-left:2px}
      .dp-chip.on{background:#1c2733;border-color:#1c2733;color:#fff}
      .dp-items{overflow:auto;flex:1;min-height:0}
      .dp-item{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #f0f1f4;border-left:3px solid transparent;padding:11px 14px;cursor:pointer;font:inherit;color:inherit}
      .dp-item:hover{background:#f8fafc}
      .dp-item.cur{background:#eef4fd;border-left-color:#1565c0}
      .dp-item-top{display:flex;align-items:center;gap:6px}
      .dp-item-top b{font-size:15px}
      .dp-pct{margin-left:auto;font-weight:700;font-size:13px;color:#5b6b7a}
      .dp-item small{display:block;color:#5b6b7a;font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dp-bar{height:5px;background:#eef0f3;border-radius:99px;overflow:hidden;margin-top:6px}
      .dp-bar span{display:block;height:100%;background:#1565c0;border-radius:99px}
      .dp-bar-lg{height:8px;margin:4px 0 14px}
      .dp-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;flex-shrink:0}
      .dp-dot.verde{background:#16a34a}.dp-dot.amarillo{background:#eab308}.dp-dot.rojo{background:#dc2626}.dp-dot.gris{background:#cbd5e1}
      .dp-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;background:#f3f4f6;color:#6b7280;vertical-align:middle}
      .dp-tag.ok{background:#dcfce7;color:#166534}.dp-tag.nc{background:#fee2e2;color:#b91c1c}.dp-tag.ab{background:#e0e7ff;color:#3730a3}.dp-tag.stock{background:#dcfce7;color:#166534}
      .dp-stockmeta{margin:0;padding:8px 12px;font-size:11px;color:#8a97a5;border-top:1px solid #eef0f3}
      .dp-detail{min-width:0}
      .dp-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
      .dp-back{display:none}
      .dp-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:18px;margin-bottom:14px}
      .dp-pad0{padding:0;overflow:hidden}
      .dp-hl{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .dp-hl h2{margin:0;font-size:20px}
      .dp-hl p{margin:4px 0 0;color:#5b6b7a}
      .dp-big{text-align:right}.dp-big strong{display:block;font-size:26px;line-height:1}.dp-big span{font-size:12px;color:#5b6b7a}
      .dp-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
      .dp-facts>div{background:#f8fafc;border-radius:8px;padding:9px 11px}
      .dp-facts span{display:block;font-size:12px;color:#5b6b7a}
      .dp-facts b{display:flex;align-items:center;font-size:14px;margin-top:2px}
      .dp-note{margin-top:12px;background:#f8fafc;border-radius:8px;padding:9px 12px;font-size:13px;color:#4b5563}
      .dp-note.nc{background:#fef2f2;color:#b91c1c}
      .dp-h3{font-size:14px;margin:0;padding:14px 16px 10px}
      .dp-dlg .dp-h3{padding:0 0 8px}
      .dp-h3row{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .dp-h3row .dp-h3{padding:0}
      .dp-tw{overflow-x:auto}
      .dp-t{width:100%;border-collapse:collapse;font-size:13.5px}
      .dp-t th{text-align:left;background:#f5f7fa;color:#5b6b7a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:9px 12px;white-space:nowrap}
      .dp-t td{padding:9px 12px;border-top:1px solid #eef0f3;vertical-align:top}
      .dp-t .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .dp-t small{color:#8a97a5;font-size:11px}
      .dp-block{display:block}
      .dp-done td{color:#9ca3af}
      .dp-saldo{color:#c2410c}.dp-ok{color:#15803d;font-weight:700}.dp-warn{color:#b45309;font-weight:700}.dp-bad{color:#b91c1c;font-weight:700}
      .dp-stock small{display:block;max-width:220px;margin-left:auto;white-space:normal}
      .dp-dim{color:#9ca3af;font-weight:400}
      .dp-tl{list-style:none;margin:0;padding:0 16px 8px}
      .dp-tl>li{position:relative;padding:10px 0 12px 22px;border-left:2px solid #e1e5ea;margin-left:6px}
      .dp-tl>li::before{content:"";position:absolute;left:-7px;top:13px;width:12px;height:12px;border-radius:50%;background:#1565c0;border:2px solid #fff}
      .dp-tl-head{display:flex;justify-content:space-between;gap:8px;font-size:14px}
      .dp-tl-head span{color:#5b6b7a;font-size:13px}
      .dp-tl-items{margin:6px 0 0;padding-left:16px;font-size:13px;color:#374151}
      .dp-tl-nota{margin:6px 0 0;font-size:13px;color:#5b6b7a;font-style:italic}
      .dp-tl-acts{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px}
      .dp-empty{color:#8a97a5;padding:20px;text-align:center;margin:0}
      .dp-err{color:#b91c1c;font-size:13px}
      .dp-list .dp-err{padding:14px;margin:0}
      .dp-hint{font-size:12px;color:#8a97a5;margin:8px 0 0}
      .dp-mt{margin-top:16px!important}.dp-mt8{margin-top:8px}
      .dp-dlg{border:0;border-radius:12px;padding:0;width:min(860px,96vw);max-height:92vh;box-shadow:0 20px 60px rgba(0,0,0,.3);color:#1c2733}
      .dp-dlg::backdrop{background:rgba(17,24,39,.45)}
      .dp-dlg-in{display:flex;flex-direction:column;max-height:92vh;margin:0}
      .dp-dlg-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eef0f3}
      .dp-dlg-head h2{margin:0;font-size:17px}
      .dp-dlg-body{padding:16px 20px;overflow:auto}
      .dp-dlg-body label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}
      .dp-dlg-foot{display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:12px 20px;border-top:1px solid #eef0f3}
      .dp-dlg-foot .dp-err{margin-right:auto}
      .dp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .dp-span2{grid-column:span 2}
      .dp-lines td{padding:5px 6px}.dp-lines th{padding:8px 6px}
      .dp-x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:6px 8px}
      .dp-file{border:1.5px dashed #c7d0db;border-radius:10px;padding:14px;cursor:pointer;align-items:flex-start;background:#fafbfc}
      .dp-file:hover{border-color:#1565c0}
      .dp-file input{font-size:13px;font-weight:400}
      .dp-file span{font-size:14px}
      .dp-file small{font-weight:400;color:#8a97a5;font-size:12px}
      .dp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2733;color:#fff;padding:11px 18px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.2)}
      .dp-toast.err{background:#b91c1c}
      @media (max-width:900px){
        .dp-wrap{grid-template-columns:1fr}
        .dp-list{position:static;max-height:none}
        .dp-wrap.dp-show .dp-list{display:none}
        .dp-wrap:not(.dp-show) .dp-detail{display:none}
        .dp-back{display:inline-flex}
        .dp-grid{grid-template-columns:1fr 1fr}
      }
      @media (max-width:560px){
        .dp-grid{grid-template-columns:1fr}.dp-span2{grid-column:auto}
        .dp-kpis{grid-template-columns:1fr 1fr}.dp-kpi strong{font-size:20px}
        .dp-t:not(.dp-lines) td:nth-child(2){min-width:170px}
        .dp-top .dp-acts{width:100%}.dp-top .dp-acts .dp-pri{flex:1;justify-content:center}
        .dp-dlg{width:100vw;max-width:100vw;max-height:100vh;height:100%;border-radius:0}
        .dp-dlg-in{max-height:100vh;height:100%}.dp-dlg-body{flex:1}
        .dp-hl h2{font-size:17px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
