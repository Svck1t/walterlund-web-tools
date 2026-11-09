// =====================================================
// SECCIÓN: NOTAS DE CRÉDITO — v3 (+ bot de Telegram + datos leídos de la factura con Gemini)
// Reemplaza el grupo de Telegram: solicitud → devolución en bodega → NC emitida (timbrada),
// con respaldos en Drive (solicitud, foto de bodega, PDF timbrado) e historial de quién hizo qué.
// Cruza con Control de Despachos (factura registrada / N/C marcada).
// Fuente: /api/despachos?m=nc (Apps Script "Despachos — anexo", misma planilla de Control de Despachos)
// =====================================================

const NotasCreditoSection = (() => {
  const API = '/api/despachos';
  const CF_URL = 'https://script.google.com/macros/s/AKfycbxchbWwNZnnx72MF5d_NZockO1XD56He_Ti-nIb3Hx7HLb_0u-gpqRTh0Vy3c23BrXl/exec'; // Control de Despachos (solo lectura)
  const BODEGAS = ['Aldunate', 'SF 918', 'Viel', 'San Ignacio', 'Stgo Concha'];
  const MOTIVOS = ['Cliente anula pedido', 'Cambio de producto', 'Error en digitación', 'Error en solicitud del cliente', 'Error de precio o monto',
    'Cambio de bodega', 'Error de sistema', 'Cambio/error ejecutivo', 'Stock erróneo/incompleto', 'Cambio de razón social', 'Cliente rechaza material',
    'Cliente devuelve producto', 'Cambio de material', 'Material cortado', 'Cambio de medida', 'Cambio de pago', 'Producto no despachado',
    'Cambio de factura', 'Duplicidad de factura', 'Otro'];
  const EST = {
    SOLICITADA: ['Solicitada', 'sol'], PEND_DEVOLUCION: ['Esperando devolución', 'dev'], EN_BODEGA: ['Registrada en bodega', 'bod'],
    EMITIDA: ['Emitida', 'emi'], ANULADA: ['Anulada', 'anu']
  };
  const POR_EMITIR = ['SOLICITADA', 'PEND_DEVOLUCION', 'EN_BODEGA'];
  const FILTROS = [['emitir', 'Por emitir'], ['PEND_DEVOLUCION', 'Esperando devolución'], ['EN_BODEGA', 'En bodega'], ['EMITIDA', 'Emitidas'], ['ANULADA', 'Anuladas'], ['todas', 'Todas']];
  const MAX_ARCHIVO = 3 * 1024 * 1024;
  const KEY_QUIEN = 'wl_nc_quien';

  let notas = [], tgs = [], hoy = '', cargado = false, errorCarga = '', root = null;
  const st = { tab: 'bandeja', filtro: 'emitir', bod: '', q: '', sel: null, periodo: 'mes', tgFiltro: 'SIN_ASIGNAR' };
  let cf = null, cfEstado = 'sin cargar'; // Control de Despachos: Map numero -> registro
  let dlg = null;

  // ============ UTILIDADES ============
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 0 });
  const plata = v => v === '' || v === null || v === undefined || isNaN(v) ? '—' : '$' + nf(v);
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : iso; };
  const dia = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const hoyLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const num = v => { let s = String(v ?? '').replace(/[$\s]/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); const n = Number(s); return isNaN(n) ? null : n; };
  const dmyIso = s => { const m = String(s || '').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
  const docLbl = n => `${n.docTipo === 'Boleta' ? 'Boleta' : 'Factura'} N° ${n.docNum}`;
  const docCorto = n => `${n.docTipo === 'Boleta' ? 'B' : 'F'} ${n.docNum}`;
  const quien = () => { try { return localStorage.getItem(KEY_QUIEN) || ''; } catch (e) { return ''; } };
  const setQuien = v => { try { localStorage.setItem(KEY_QUIEN, v); } catch (e) {} };
  const historial = n => { try { return JSON.parse(n.historial || '[]'); } catch (e) { return []; } };
  const diasDesde = iso => iso ? dia(hoy || hoyLocal()) - dia(iso) : null;
  // Bodega de Control de Despachos ("" = Aldunate, "SAN FRANCISCO", "VIEL, SAN IGNACIO"…) -> nombre de esta sección
  const bodegaDeCF = b => { const u = txt(String(b || '').split(',')[0]); return !u ? 'Aldunate' : u.includes('FRANCISCO') ? 'SF 918' : u.includes('VIEL') ? 'Viel' : u.includes('IGNACIO') ? 'San Ignacio' : u.includes('CONCHA') ? 'Stgo Concha' : ''; };
  const lec = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const urlDoc = n => n.fotoUrl || n.solicitudUrl || '';
  const lecturaPendiente = n => { const d = lec(n.lecturaDoc), c = lec(n.lecturaNc); return (urlDoc(n) && (!d || d.url !== urlDoc(n))) || (n.ncUrl && (!c || c.url !== n.ncUrl)); };
  const nombres = () => [...new Set(notas.flatMap(n => [n.solicitadoPor, n.registradoPor, n.emitidoPor]).filter(Boolean))].sort();

  // ============ CARGA ============
  async function cargar() {
    try {
      const r = await fetch(`${API}?m=nc`, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      notas = d.notas; tgs = d.tg || []; hoy = d.hoy || hoyLocal(); cargado = true; errorCarga = '';
    } catch (err) { console.error('NC:', err); errorCarga = err.message; hoy = hoy || hoyLocal(); }
    dibujar();
  }
  // Facturas de Control de Despachos (para cruzar). Solo lectura.
  async function cargarCF() {
    if (cfEstado === 'cargando') return;
    cfEstado = 'cargando';
    try {
      const r = await fetch(`${CF_URL}?action=listado`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      cf = new Map(d.registros.map(x => [String(x.numero).trim(), x]));
      cfEstado = 'ok';
    } catch (err) { console.error('NC → Control de Despachos:', err); cfEstado = 'error'; }
    dibujar();
  }
  async function post(body) {
    body.quien = body.quien || quien();
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d; try { d = await r.json(); } catch (e) { throw new Error(r.status === 413 ? 'El archivo es muy grande' : 'HTTP ' + r.status); }
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
    return d;
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="nc">
      <div class="section-header nc-head">
        <div><h1>Notas de Crédito</h1><p>Solicitud → devolución en bodega → NC emitida, con respaldos y quién hizo cada paso.</p></div>
        <div class="nc-acts">
          <label class="nc-quien" title="Queda registrado en el historial de cada NC">👤 <input id="nc-quien" list="nc-nombres" placeholder="Tu nombre" value="${esc(quien())}"></label>
          <button class="nc-b" id="nc-ref">🔄</button>
          <button class="nc-b" id="nc-imp">📥 Importar Telegram</button>
          <button class="nc-b nc-pri" id="nc-new">➕ Nueva solicitud</button>
        </div>
      </div>
      <datalist id="nc-nombres"></datalist>
      <div class="nc-kpis" id="nc-kpis"></div>
      <div class="nc-tabs"><button data-tab="bandeja">Bandeja</button><button data-tab="telegram">Telegram <span class="nc-badge" id="nc-tgn"></span></button><button data-tab="resumen">Resumen</button></div>
      <div id="nc-bandeja">
        <div class="nc-wrap">
          <aside class="nc-list">
            <div class="nc-list-head">
              <div class="nc-row2"><input class="nc-in" id="nc-q" type="search" placeholder="N° doc, cliente, folio, motivo…" value="${esc(st.q)}">
                <select class="nc-in nc-bodsel" id="nc-bod"><option value="">Todas las bodegas</option>${BODEGAS.map(b => `<option>${b}</option>`).join('')}</select></div>
              <div class="nc-chips" id="nc-chips"></div>
            </div>
            <div class="nc-items" id="nc-items"><p class="nc-empty">Cargando…</p></div>
          </aside>
          <section class="nc-detail" id="nc-detail"></section>
        </div>
      </div>
      <div id="nc-resumen" hidden></div>
      <div id="nc-telegram" hidden></div>
    </div>`;
    const $ = s => root.querySelector(s);
    $('#nc-quien').addEventListener('change', e => setQuien(e.target.value.trim()));
    $('#nc-ref').addEventListener('click', () => { cargar(); cargarCF(); });
    $('#nc-new').addEventListener('click', () => abrirForm(null));
    $('#nc-imp').addEventListener('click', abrirImport);
    $('.nc-tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; dibujar(); } });
    $('#nc-q').addEventListener('input', e => { st.q = e.target.value; dibujarLista(); });
    $('#nc-bod').addEventListener('change', e => { st.bod = e.target.value; dibujarLista(); });
    $('#nc-chips').addEventListener('click', e => { const t = e.target.closest('[data-f]'); if (t) { st.filtro = t.dataset.f; st.sel = null; dibujar(); } });
    $('#nc-items').addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) { st.sel = t.dataset.id; $('.nc-wrap').classList.add('nc-show'); dibujarLista(); dibujarDetalle(); } });
    // visor de archivos (respaldos y mensajes de Telegram): se abre en la misma página
    root.querySelector('.nc').addEventListener('click', e => { const f = e.target.closest('[data-file]'); if (f) { e.stopPropagation(); verArchivo(f.dataset.file, f.dataset.titulo); } }, true);
    $('#nc-detail').addEventListener('click', accion);
    $('#nc-detail').addEventListener('change', adjuntarSuelto);
    $('#nc-telegram').addEventListener('click', accionTg);
    $('#nc-resumen').addEventListener('click', e => {
      const p = e.target.closest('[data-per]'); if (p) { st.periodo = p.dataset.per; dibujarResumen(); }
      const c = e.target.closest('[data-crear]'); if (c) abrirForm(null, c.dataset.crear);
    });
    dibujar();
    cargar();
    if (!cf) cargarCF();
  }

  function pasaFiltro(n) {
    if (st.filtro === 'emitir') return POR_EMITIR.includes(n.estado);
    if (st.filtro === 'todas') return true;
    return n.estado === st.filtro;
  }
  function filtradas() {
    const q = txt(st.q.trim());
    return notas.filter(pasaFiltro)
      .filter(n => !st.bod || n.bodega === st.bod)
      .filter(n => { if (!q) return true; const d = lec(n.lecturaDoc) || {};
        return txt([n.docNum, n.cliente, n.folioNc, n.motivo, n.solicitadoPor, n.facturaSustituta, n.obs, d.rut, d.vendedor, ...(d.productos || []).map(p => p.codigo + ' ' + p.descripcion)].join(' ')).includes(q); })
      .sort((a, b) => POR_EMITIR.includes(a.estado) && POR_EMITIR.includes(b.estado)
        ? String(a.fechaSolicitud).localeCompare(String(b.fechaSolicitud))           // por emitir: lo más antiguo primero
        : String(b.fechaEmision || b.fechaSolicitud).localeCompare(String(a.fechaEmision || a.fechaSolicitud)));
  }

  // ============ RENDER ============
  function dibujar() {
    if (!root || !root.querySelector('.nc')) return;
    root.querySelectorAll('.nc-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    root.querySelector('#nc-bandeja').hidden = st.tab !== 'bandeja';
    root.querySelector('#nc-resumen').hidden = st.tab !== 'resumen';
    root.querySelector('#nc-telegram').hidden = st.tab !== 'telegram';
    const sinAsig = tgs.filter(t => t.estado === 'SIN_ASIGNAR').length;
    root.querySelector('#nc-tgn').textContent = sinAsig || '';
    root.querySelector('#nc-nombres').innerHTML = nombres().map(n => `<option value="${esc(n)}">`).join('');
    const mes = (hoy || hoyLocal()).slice(0, 7);
    const pend = notas.filter(n => POR_EMITIR.includes(n.estado));
    const emMes = notas.filter(n => n.estado === 'EMITIDA' && String(n.fechaEmision).startsWith(mes));
    const tiempos = notas.filter(n => n.estado === 'EMITIDA' && n.fechaSolicitud && n.fechaEmision).map(n => dia(n.fechaEmision) - dia(n.fechaSolicitud)).filter(x => x >= 0);
    const prom = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;
    root.querySelector('#nc-kpis').innerHTML = [
      ['Por emitir', pend.length, pend.filter(n => diasDesde(n.fechaSolicitud) > 3).length ? `${pend.filter(n => diasDesde(n.fechaSolicitud) > 3).length} con más de 3 días` : '', 'nar'],
      ['Esperando devolución', notas.filter(n => n.estado === 'PEND_DEVOLUCION').length, '', ''],
      ['Emitidas este mes', emMes.length, plata(emMes.reduce((s, n) => s + (Number(n.montoNc || (n.tipo === 'Completa' ? n.montoDoc : 0)) || 0), 0)), 'verde'],
      ['Días promedio a emisión', prom === null ? '—' : prom.toFixed(1).replace('.', ','), tiempos.length ? `${tiempos.length} NC medidas` : '', '']
    ].map(([l, v, s, c]) => `<div class="nc-kpi ${c}"><span>${l}</span><strong>${v}</strong>${s ? `<small>${s}</small>` : ''}</div>`).join('');
    const cnt = k => notas.filter(n => k === 'emitir' ? POR_EMITIR.includes(n.estado) : k === 'todas' ? true : n.estado === k).length;
    root.querySelector('#nc-chips').innerHTML = FILTROS.map(([k, l]) => `<button class="nc-chip${st.filtro === k ? ' on' : ''}" data-f="${k}">${l} <b>${cnt(k)}</b></button>`).join('');
    if (st.tab === 'bandeja') { dibujarLista(); dibujarDetalle(); } else if (st.tab === 'telegram') dibujarTelegram(); else dibujarResumen();
  }

  function dibujarLista() {
    const el = root && root.querySelector('#nc-items'); if (!el) return;
    if (errorCarga) { el.innerHTML = `<p class="nc-err">No se pudieron cargar las notas de crédito: ${esc(errorCarga)}</p>`; return; }
    if (!cargado) return;
    const f = filtradas();
    if (!st.sel && f.length && !window.matchMedia('(max-width: 900px)').matches) st.sel = f[0].id;
    el.innerHTML = f.map(n => {
      const [lbl, cls] = EST[n.estado] || ['—', ''];
      const d = POR_EMITIR.includes(n.estado) ? diasDesde(n.fechaSolicitud) : null;
      return `<button class="nc-item${st.sel === n.id ? ' cur' : ''}" data-id="${esc(n.id)}">
        <div class="nc-it-top"><i class="nc-dot ${cls}"></i><b>${esc(docCorto(n))}</b>${n.tipo ? `<span class="nc-tipo">${esc(n.tipo)}</span>` : ''}<span class="nc-it-r">${n.montoDoc ? plata(n.montoDoc) : ''}</span></div>
        <small>${esc(n.cliente || 'Sin cliente')}</small>
        <small>${esc(lbl)}${n.motivo ? ' · ' + esc(n.motivo) : ''}${d !== null ? ` · <span class="${d > 3 ? 'nc-late' : ''}">${d === 0 ? 'hoy' : d + (d === 1 ? ' día' : ' días')}</span>` : n.estado === 'EMITIDA' ? ' · ' + fCorta(n.fechaEmision) : ''}</small>
      </button>`;
    }).join('') || `<p class="nc-empty">${notas.length ? 'Ninguna NC coincide' : 'Aún no hay notas de crédito. Crea una o importa el historial de Telegram.'}</p>`;
  }

  function pasos(n) {
    const dev = String(n.requiereDev).toUpperCase() === 'SI' || n.fechaBodega || n.fotoUrl;
    const p = [{ t: 'Solicitada', ok: true, f: n.fechaSolicitud, q: n.solicitadoPor }];
    if (dev) p.push({ t: n.estado === 'PEND_DEVOLUCION' ? 'Esperando devolución' : 'Registrada en bodega', ok: !!(n.fechaBodega || n.fotoUrl), f: n.fechaBodega, q: n.registradoPor });
    p.push({ t: n.estado === 'ANULADA' ? 'Anulada' : 'Emitida', ok: n.estado === 'EMITIDA' || n.estado === 'ANULADA', f: n.fechaEmision, q: n.emitidoPor, anu: n.estado === 'ANULADA' });
    return p;
  }

  function dibujarDetalle() {
    const el = root && root.querySelector('#nc-detail'); if (!el) return;
    const n = notas.find(x => x.id === st.sel);
    if (!n) { el.innerHTML = `<div class="nc-card nc-empty">${cargado ? 'Elige una NC de la lista' : 'Cargando…'}</div>`; return; }
    const [lbl, cls] = EST[n.estado] || ['—', ''];
    const abierta = POR_EMITIR.includes(n.estado);
    const reg = cf && cf.get(String(n.docNum).trim());
    const cfHtml = n.docTipo === 'Boleta' ? '' : cfEstado === 'cargando' ? '<span class="nc-dim">Buscando en Control de Despachos…</span>'
      : !cf ? '<span class="nc-dim">No se pudo consultar Control de Despachos</span>'
      : reg ? `✓ Registrada en Control de Despachos el ${esc(reg.fecha)}${reg.bodega ? ' · ' + esc(reg.bodega) : ''}${reg.proceso ? ' · ' + esc(reg.proceso) : ''}${reg.nc ? ` · <b>N/C ${esc(reg.nc)}</b> marcada${reg.motivoNc ? ' (' + esc(reg.motivoNc) + ')' : ''}` : ' · sin N/C marcada allá'}`
      : '<span class="nc-dim">No aparece en Control de Despachos</span>';
    const arch = (campo, titulo, icono) => {
      const url = n[campo];
      return `<div class="nc-file${url ? ' has' : ''}"><span>${icono} ${titulo}</span>
        ${url ? `<button class="nc-b nc-sm" data-file="${esc(url)}" data-titulo="${esc(titulo + ' · ' + docLbl(n))}">Ver</button>` : '<em>Sin archivo</em>'}
        <label class="nc-b nc-sm">${url ? 'Reemplazar' : 'Adjuntar'}<input type="file" accept="image/*,application/pdf" data-campo="${campo}" hidden></label></div>`;
    };
    el.innerHTML = `
      <div class="nc-top"><button class="nc-b nc-back" data-back>‹ Notas de crédito</button>
        <div class="nc-acts">
          ${abierta && n.estado !== 'EN_BODEGA' ? '<button class="nc-b" data-bodega>📦 Registrar en bodega</button>' : ''}
          ${abierta ? '<button class="nc-b nc-pri" data-emitir>✅ Emitir NC</button>' : ''}
          <button class="nc-b" data-edit>✏️ Editar</button>
          ${abierta ? '<button class="nc-b" data-anular>Anular</button>' : '<button class="nc-b" data-reabrir>Reabrir</button>'}
          <button class="nc-b nc-del" data-borrar title="Eliminar">🗑</button>
        </div></div>
      <div class="nc-card">
        <div class="nc-hl">
          <div><h2>${esc(docLbl(n))} <span class="nc-est ${cls}">${lbl}</span></h2><p>${esc(n.cliente || 'Sin cliente')}</p></div>
          ${n.montoDoc || n.montoNc ? `<div class="nc-big"><strong>${n.tipo === 'Parcial' && n.montoNc ? plata(n.montoNc) : plata(n.montoDoc)}</strong><span>${n.tipo === 'Parcial' ? 'NC parcial' + (n.montoDoc ? ' de ' + plata(n.montoDoc) : '') : n.tipo === 'Completa' ? 'NC completa' : 'monto documento'}</span></div>` : ''}
        </div>
        <ol class="nc-steps">${pasos(n).map(p => `<li class="${p.ok ? (p.anu ? 'anu' : 'ok') : ''}"><b>${p.t}</b><small>${p.ok ? fCorta(p.f) + (p.q ? ' · ' + esc(p.q) : '') : 'pendiente'}</small></li>`).join('')}</ol>
        <div class="nc-facts">
          <div><span>Tipo</span><b>${esc(n.tipo || '—')}</b></div>
          <div><span>Motivo</span><b>${esc(n.motivo || '—')}</b></div>
          <div><span>Bodega</span><b>${esc(n.bodega || '—')}</b></div>
          <div><span>Fecha documento</span><b>${fCorta(n.fechaDoc)}</b></div>
          <div><span>Folio NC</span><b>${esc(n.folioNc || '—')}</b></div>
          ${n.facturaSustituta ? `<div><span>Factura sustituta</span><b>${esc(n.facturaSustituta)}</b></div>` : ''}
        </div>
        ${cfHtml ? `<p class="nc-cf">${cfHtml}</p>` : ''}
        ${n.anulacion ? `<div class="nc-note anu">Anulada: ${esc(n.anulacion)}</div>` : ''}
        ${n.obs ? `<div class="nc-note">${esc(n.obs)}</div>` : ''}
      </div>
      ${datosLeidos(n)}
      <div class="nc-card"><h3 class="nc-h3">Respaldos</h3>
        <div class="nc-files">${arch('solicitudUrl', 'Solicitud', '📝')}${arch('fotoUrl', 'Foto bodega', '📷')}${arch('ncUrl', 'NC timbrada', '🧾')}</div>
      </div>
      <div class="nc-card"><h3 class="nc-h3">Historial</h3>
        <ol class="nc-hist">${historial(n).slice().reverse().map(h => `<li><b>${esc(h.q || '—')}</b> ${esc(h.t)}<small>${esc(h.f)}</small></li>`).join('') || '<li class="nc-dim">Sin movimientos</li>'}</ol>
      </div>`;
  }

  // ============ ACCIONES ============
  function pedirQuien() {
    let q = quien();
    if (!q) { q = (prompt('¿Quién eres? Queda registrado en el historial.') || '').trim(); if (q) { setQuien(q); const i = root.querySelector('#nc-quien'); if (i) i.value = q; } }
    return q;
  }
  async function accion(e) {
    if (e.target.closest('[data-back]')) { root.querySelector('.nc-wrap').classList.remove('nc-show'); return; }
    const n = notas.find(x => x.id === st.sel); if (!n) return;
    if (e.target.closest('[data-edit]')) return abrirForm(n);
    const lb = e.target.closest('[data-leer]');
    if (lb) { lb.disabled = true; lb.textContent = 'Leyendo… (10–30 s)'; return ejecutar({ action: 'nc_leer', id: n.id, forzar: lb.dataset.leer === 'forzar' }, 'Factura leída'); }
    if (e.target.closest('[data-bodega]')) return abrirPaso(n, 'bodega');
    if (e.target.closest('[data-emitir]')) return abrirPaso(n, 'emitir');
    if (e.target.closest('[data-anular]')) {
      if (!pedirQuien()) return;
      const m = prompt(`¿Por qué se anula la solicitud de ${docLbl(n)}?`, 'Queda sin efecto');
      if (m === null) return;
      return ejecutar({ action: 'nc_anular', id: n.id, motivo: m.trim() }, 'Solicitud anulada');
    }
    if (e.target.closest('[data-reabrir]')) {
      if (!pedirQuien()) return;
      if (n.estado === 'EMITIDA' && !confirm('¿Reabrir? Se borran el folio y la fecha de emisión (el PDF timbrado se mantiene).')) return;
      return ejecutar({ action: 'nc_reabrir', id: n.id }, 'Reabierta');
    }
    if (e.target.closest('[data-borrar]')) {
      if (!confirm(`¿Eliminar la NC de ${docLbl(n)} y sus archivos? No se puede deshacer. Si solo quedó sin efecto, usa Anular.`)) return;
      st.sel = null;
      return ejecutar({ action: 'nc_borrar', id: n.id }, 'Eliminada');
    }
  }
  async function adjuntarSuelto(e) {
    const inp = e.target.closest('input[type=file][data-campo]'); if (!inp || !inp.files[0]) return;
    if (!pedirQuien()) { inp.value = ''; return; }
    const lab = inp.closest('label'); lab.firstChild.textContent = 'Subiendo…';
    try {
      const archivo = await prepararArchivo(inp.files[0]);
      await post({ action: 'nc_archivo', id: st.sel, campo: inp.dataset.campo, archivo });
      toast('Archivo adjuntado'); await cargar();
    } catch (err) { toast(err.message, true); lab.firstChild.textContent = 'Adjuntar'; }
  }
  async function ejecutar(body, ok) {
    try { await post(body); toast(ok); await cargar(); }
    catch (err) { toast(err.message, true); }
  }

  // Hora del mensaje: "10:05". Si viene como fecha (registros antiguos que Sheets convirtió) no se muestra.
  const horaTg = h => /^\d{1,2}:\d{2}/.test(String(h || '')) ? String(h).slice(0, 5) : '';

  // ============ VISOR DE ARCHIVOS ============
  // Vista previa de Drive (fotos y PDF) dentro de la página, con descargar y abrir en Drive
  let visor = null;
  const idDrive = url => { const m = String(url || '').match(/[-\w]{25,}/); return m ? m[0] : ''; };
  function verArchivo(url, titulo) {
    const id = idDrive(url);
    if (!visor) {
      visor = document.createElement('dialog');
      visor.className = 'nc-visor';
      visor.addEventListener('click', e => { if (e.target === visor || e.target.closest('[data-cerrar]')) visor.close(); });
      visor.addEventListener('close', () => { const f = visor.querySelector('iframe'); if (f) f.src = 'about:blank'; });
      document.body.appendChild(visor);
    }
    visor.innerHTML = `<div class="nc-visor-in">
      <div class="nc-visor-head"><h2>${esc(titulo || 'Archivo')}</h2>
        <div class="nc-visor-acts">
          ${id ? `<a class="nc-b nc-sm" href="https://drive.google.com/uc?export=download&id=${esc(id)}" target="_blank" rel="noopener">⬇ Descargar</a>` : ''}
          <a class="nc-b nc-sm" href="${esc(url)}" target="_blank" rel="noopener">↗ Abrir en Drive</a>
          <button class="nc-x" data-cerrar aria-label="Cerrar">✕</button>
        </div></div>
      <div class="nc-visor-body">${id ? `<iframe src="https://drive.google.com/file/d/${esc(id)}/preview" title="${esc(titulo || 'Archivo')}" allow="autoplay"></iframe>` : '<p class="nc-empty">No se puede mostrar este archivo aquí. Ábrelo en Drive.</p>'}</div>
    </div>`;
    visor.showModal();
  }

  // ============ ARCHIVOS ============
  async function prepararArchivo(f) {
    if (!f) return null;
    let out;
    if (f.type.startsWith('image/')) {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.78));
      out = { nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', tipo: 'image/jpeg', blob };
    } else out = { nombre: f.name, tipo: f.type || 'application/pdf', blob: f };
    if (out.blob.size > MAX_ARCHIVO) throw new Error(`${f.name} pesa más de 3 MB. Si es un PDF escaneado, súbelo como foto.`);
    return { nombre: out.nombre, tipo: out.tipo, base64: await aBase64(out.blob) };
  }
  const aBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // ============ DIÁLOGO GENÉRICO ============
  function abrirDlg(titulo, cuerpo, textoBoton, onGuardar) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'nc-dlg';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<div class="nc-dlg-in">
      <div class="nc-dlg-head"><h2>${esc(titulo)}</h2><button type="button" class="nc-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="nc-dlg-body">${cuerpo}</div>
      <div class="nc-dlg-foot"><span class="nc-err" data-err></span><button type="button" class="nc-b nc-pri" data-ok>${esc(textoBoton)}</button></div></div>`;
    const err = dlg.querySelector('[data-err]'), btn = dlg.querySelector('[data-ok]');
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    btn.onclick = async () => {
      err.textContent = ''; btn.disabled = true; const t = btn.textContent; btn.textContent = 'Guardando…';
      try { if (await onGuardar(dlg) !== false) dlg.close(); }
      catch (e2) { err.textContent = e2.message; }
      finally { btn.disabled = false; btn.textContent = t; }
    };
    dlg.showModal();
    return dlg;
  }
  const v = (d, sel) => (d.querySelector(sel).value || '').trim();
  const fileUI = (id, txtBtn) => `<label class="nc-drop">${txtBtn}<input type="file" id="${id}" accept="image/*,application/pdf"><small>En el celular puedes sacar la foto directo. Las fotos se comprimen antes de subir.</small></label>`;

  // ============ NUEVA / EDITAR ============
  function abrirForm(n, docSugerido) {
    const q = quien();
    const motivoOtro = n && n.motivo && !MOTIVOS.includes(n.motivo);
    const d = abrirDlg(n ? `Editar · ${docLbl(n)}` : 'Nueva solicitud de NC', `
      <div class="nc-grid">
        <label>Documento<select class="nc-in" id="f-tipo-doc"><option>Factura</option><option>Boleta</option></select></label>
        <label>N° documento<input class="nc-in" id="f-num" inputmode="numeric" autocomplete="off" value="${esc(n ? n.docNum : docSugerido || '')}"></label>
        <label>Fecha documento<input class="nc-in" id="f-fdoc" type="date" value="${esc(n ? n.fechaDoc : '')}"></label>
        <label>Bodega<select class="nc-in" id="f-bod"><option value="">—</option>${BODEGAS.map(b => `<option>${b}</option>`).join('')}</select></label>
        <label class="nc-span2">Cliente<input class="nc-in" id="f-cli" autocomplete="off" value="${esc(n ? n.cliente : '')}"></label>
        <label>Tipo de NC<select class="nc-in" id="f-tipo"><option value="">—</option><option>Completa</option><option>Parcial</option></select></label>
        <label>Motivo<select class="nc-in" id="f-mot"><option value="">—</option>${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="nc-span2" id="f-otro-w" hidden>Especifica el motivo<input class="nc-in" id="f-otro" value="${esc(motivoOtro ? n.motivo : '')}"></label>
        <label>Monto documento ($)<input class="nc-in" id="f-mdoc" inputmode="numeric" value="${esc(n ? n.montoDoc : '')}"></label>
        <label id="f-mnc-w">Monto NC ($)<input class="nc-in" id="f-mnc" inputmode="numeric" value="${esc(n ? n.montoNc : '')}"></label>
        <label>Solicitado por<input class="nc-in" id="f-sol" list="nc-nombres" value="${esc(n ? n.solicitadoPor : q)}"></label>
        <label>Fecha solicitud<input class="nc-in" id="f-fsol" type="date" value="${esc(n ? n.fechaSolicitud : hoyLocal())}"></label>
        <label class="nc-check nc-span2"><input type="checkbox" id="f-dev" ${n && String(n.requiereDev).toUpperCase() === 'SI' ? 'checked' : ''}> Requiere devolución o retiro de material en bodega</label>
        <label class="nc-span2">Observación<input class="nc-in" id="f-obs" value="${esc(n ? n.obs : '')}"></label>
      </div>
      <p class="nc-cfhint" id="f-cf"></p>
      ${n ? '' : fileUI('f-arch', '📝 Adjuntar solicitud (PDF o foto)')}
      <datalist id="nc-nombres2">${nombres().map(x => `<option value="${esc(x)}">`).join('')}</datalist>`, n ? 'Guardar cambios' : 'Crear solicitud', async dd => {
      if (!pedirQuien()) throw new Error('Escribe tu nombre arriba para registrar quién hace la solicitud');
      const mot = v(dd, '#f-mot') === 'Otro' ? (v(dd, '#f-otro') || 'Otro') : v(dd, '#f-mot');
      const x = {
        id: n ? n.id : '', docTipo: v(dd, '#f-tipo-doc'), docNum: v(dd, '#f-num').replace(/\D/g, ''), fechaDoc: v(dd, '#f-fdoc'), bodega: v(dd, '#f-bod'),
        cliente: v(dd, '#f-cli'), tipo: v(dd, '#f-tipo'), motivo: mot, montoDoc: num(v(dd, '#f-mdoc')) ?? '', montoNc: v(dd, '#f-tipo') === 'Parcial' ? (num(v(dd, '#f-mnc')) ?? '') : '',
        solicitadoPor: v(dd, '#f-sol'), fechaSolicitud: v(dd, '#f-fsol'), requiereDev: dd.querySelector('#f-dev').checked ? 'SI' : '', obs: v(dd, '#f-obs')
      };
      if (!x.docNum) throw new Error('Falta el N° de documento');
      const fi = dd.querySelector('#f-arch');
      const archivo = fi && fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
      let r;
      try { r = await post({ action: 'nc_guardar', n: x, archivo }); }
      catch (e2) {
        if (!/Ya existe una NC activa/.test(e2.message) || !confirm(e2.message)) throw e2;
        r = await post({ action: 'nc_guardar', n: x, archivo, forzar: true });
      }
      st.sel = r.id; if (!n) { st.filtro = 'emitir'; st.tab = 'bandeja'; }
      toast(n ? 'NC actualizada' : 'Solicitud creada');
      await cargar();
    });
    d.querySelector('#f-tipo-doc').value = n && n.docTipo === 'Boleta' ? 'Boleta' : 'Factura';
    d.querySelector('#f-bod').value = n && BODEGAS.includes(n.bodega) ? n.bodega : '';
    d.querySelector('#f-tipo').value = n ? n.tipo || '' : '';
    d.querySelector('#f-mot').value = motivoOtro ? 'Otro' : n ? n.motivo || '' : '';
    d.querySelector('#f-sol').setAttribute('list', 'nc-nombres2');
    const sync = () => {
      d.querySelector('#f-otro-w').hidden = d.querySelector('#f-mot').value !== 'Otro';
      d.querySelector('#f-mnc-w').style.visibility = d.querySelector('#f-tipo').value === 'Parcial' ? 'visible' : 'hidden';
    };
    d.querySelector('#f-mot').addEventListener('change', sync);
    d.querySelector('#f-tipo').addEventListener('change', sync);
    sync();
    // Al escribir el N°: busca la factura en Control de Despachos y completa fecha y bodega
    const buscar = () => {
      const el = d.querySelector('#f-cf'), num_ = v(d, '#f-num');
      if (d.querySelector('#f-tipo-doc').value !== 'Factura' || !num_ || !cf) { el.textContent = ''; return; }
      const reg = cf.get(num_);
      const ya = notas.filter(x => x.docNum === num_ && x.id !== (n && n.id) && x.estado !== 'ANULADA');
      el.innerHTML = (reg ? `✓ En Control de Despachos: ${esc(reg.fecha)}${reg.bodega ? ' · ' + esc(reg.bodega) : ''}${reg.nc ? ' · N/C ' + esc(reg.nc) + ' marcada' : ''}` : 'No aparece en Control de Despachos')
        + (ya.length ? ` · <b class="nc-late">Ya tiene ${ya.length} NC (${ya.map(x => EST[x.estado][0]).join(', ')})</b>` : '');
      if (reg && !n) {
        if (!d.querySelector('#f-fdoc').value) d.querySelector('#f-fdoc').value = dmyIso(reg.fecha);
        if (!d.querySelector('#f-bod').value) d.querySelector('#f-bod').value = bodegaDeCF(reg.bodega);
        if (!d.querySelector('#f-tipo').value && reg.nc) { d.querySelector('#f-tipo').value = /parcial/i.test(reg.nc) ? 'Parcial' : 'Completa'; sync(); }
      }
    };
    d.querySelector('#f-num').addEventListener('input', buscar);
    d.querySelector('#f-tipo-doc').addEventListener('change', buscar);
    buscar();
    if (!n) d.querySelector('#f-num').focus();
  }

  // ============ PASOS: BODEGA / EMITIR ============
  function abrirPaso(n, paso) {
    if (paso === 'bodega') {
      abrirDlg(`Registrar en bodega · ${docLbl(n)}`, `
        <div class="nc-grid nc-grid2">
          <label>Fecha<input class="nc-in" id="b-fecha" type="date" value="${hoyLocal()}"></label>
          <label>Registrado por<input class="nc-in" id="b-quien" list="nc-nombres" value="${esc(quien())}"></label>
          <label class="nc-span2">Nota (opcional)<input class="nc-in" id="b-nota" placeholder="Ej: material devuelto completo a SF 918"></label>
        </div>
        ${fileUI('b-arch', '📷 Foto de la factura / devolución')}`, 'Registrar', async d => {
        const q = v(d, '#b-quien'); if (!q) throw new Error('Indica quién registra');
        const fi = d.querySelector('#b-arch');
        const archivo = fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
        await post({ action: 'nc_bodega', id: n.id, fecha: v(d, '#b-fecha'), nota: v(d, '#b-nota'), archivo, quien: q });
        toast('Registrada en bodega'); await cargar();
      });
    } else {
      abrirDlg(`Emitir NC · ${docLbl(n)}`, `
        <div class="nc-grid nc-grid2">
          <label>Folio de la NC<input class="nc-in" id="e-folio" inputmode="numeric" autocomplete="off"></label>
          <label>Fecha de emisión<input class="nc-in" id="e-fecha" type="date" value="${hoyLocal()}"></label>
          <label>Emitida por<input class="nc-in" id="e-quien" list="nc-nombres" value="${esc(quien())}"></label>
          ${n.tipo === 'Parcial' ? `<label>Monto NC ($)<input class="nc-in" id="e-monto" inputmode="numeric" value="${esc(n.montoNc)}"></label>` : '<span></span>'}
          <label class="nc-span2">Factura sustituta (si se reemplazó)<input class="nc-in" id="e-sust" inputmode="numeric" value="${esc(n.facturaSustituta)}"></label>
        </div>
        ${fileUI('e-arch', '🧾 PDF timbrado de la NC')}`, 'Marcar emitida', async d => {
        const q = v(d, '#e-quien'); if (!q) throw new Error('Indica quién emite');
        const fi = d.querySelector('#e-arch');
        const archivo = fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
        const m = d.querySelector('#e-monto');
        await post({ action: 'nc_emitir', id: n.id, folio: v(d, '#e-folio'), fecha: v(d, '#e-fecha'), montoNc: m ? (num(m.value) ?? '') : '', facturaSustituta: v(d, '#e-sust'), archivo, quien: q });
        toast('NC emitida'); await cargar();
      });
    }
  }

  // ============ DATOS LEÍDOS DE LA FACTURA (Gemini) ============
  function datosLeidos(n) {
    const d = lec(n.lecturaDoc), c = lec(n.lecturaNc);
    if (!urlDoc(n) && !n.ncUrl) return '';
    const pend = lecturaPendiente(n);
    const btn = `<button class="nc-b nc-sm" data-leer="${pend ? '' : 'forzar'}">${pend ? '🔎 Leer ahora' : '↻ Volver a leer'}</button>`;
    if (!d && !c) return `<div class="nc-card"><div class="nc-h3row"><h3 class="nc-h3">Datos de la factura</h3>${btn}</div>
      <p class="nc-dim" style="margin:0">En cola: el lector revisa cada 10 minutos las fotos y PDF nuevos.</p></div>`;
    const m = v => v === null || v === undefined || v === '' || Number(v) === 0 ? '' : plata(v);
    const dato = (l, v) => v ? `<div><span>${l}</span><b>${esc(v)}</b></div>` : '';
    let html = '';
    if (d && d.error) html += `<p class="nc-err" style="margin:0 0 8px">No se pudo leer la factura: ${esc(d.error)}</p>`;
    else if (d) {
      const nc = d.nc || {};
      const otroN = d.numero && String(d.numero).replace(/\D/g, '') !== String(n.docNum);
      html += `${otroN ? `<div class="nc-note anu" style="margin:0 0 10px">⚠ El documento dice N° <b>${esc(d.numero)}</b> y la NC está como ${esc(n.docNum)}. Revisa cuál es el correcto.</div>` : ''}
        <div class="nc-facts">${dato('Cliente', d.cliente)}${dato('RUT', d.rut)}${dato('Vendedor', d.vendedor)}${dato('Bodega', d.bodega)}${dato('Fecha', d.fecha && fCorta(d.fecha))}${dato('Entrega', d.tipoEntrega)}${dato('Orden de compra', d.ordenCompra)}${dato('Digitado por', d.digitador)}</div>
        ${(d.productos || []).length ? `<div class="nc-tw nc-mt"><table class="nc-t"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cant.</th><th>Un.</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
          <tbody>${d.productos.map(p => `<tr><td><b>${esc(p.codigo || '—')}</b></td><td>${esc(p.descripcion)}</td><td class="num">${nf(p.cantidad)}</td><td>${esc(p.unidad || '')}</td><td class="num">${m(p.precioUnitario)}</td><td class="num">${m(p.total)}</td></tr>`).join('')}</tbody>
          <tfoot>${[['Neto', d.neto], ['IVA', d.iva], ['Total', d.total]].filter(x => Number(x[1]) > 0).map(([l, v]) => `<tr><td colspan="5" class="num">${l}</td><td class="num"><b>${plata(v)}</b></td></tr>`).join('')}</tfoot></table></div>` : ''}
        ${nc.marcada || nc.motivoManuscrito ? `<div class="nc-note nc-mt">🖊 Timbre NC: <b>${esc(nc.marcada ? (/parcial/i.test(nc.marcada) ? 'Parcial' : 'Completa') : '—')}</b>${nc.motivoManuscrito ? ` · motivo escrito: <i>"${esc(nc.motivoManuscrito)}"</i>` : ''}${nc.revisadoPor ? ` · revisó ${esc(nc.revisadoPor)}` : ''}</div>` : ''}`;
    }
    if (c && !c.error) {
      const ncd = c.nc || {};
      html += `<div class="nc-note nc-mt">🧾 NC timbrada: folio <b>${esc(ncd.folioNc || (c.tipo === 'nota_credito' ? c.numero : '') || '—')}</b>${(ncd.montoNc || c.total) ? ` · ${plata(ncd.montoNc || c.total)}` : ''}${ncd.documentoReferencia ? ` · referencia F ${esc(ncd.documentoReferencia)}` : ''}</div>`;
    } else if (c && c.error) html += `<p class="nc-err">No se pudo leer la NC timbrada: ${esc(c.error)}</p>`;
    const ref = d && !d.error ? d : c;
    return `<div class="nc-card"><div class="nc-h3row"><h3 class="nc-h3">Datos de la factura <span class="nc-dim">· leído automáticamente${ref && ref.confianza ? ', confianza ' + esc(ref.confianza) : ''}</span></h3>${btn}</div>${html}
      <p class="nc-hint">Los datos leídos completan los campos vacíos de la NC; lo que ya estaba escrito no se pisa.</p></div>`;
  }

  // ============ RESUMEN ============
  function dibujarResumen() {
    const el = root && root.querySelector('#nc-resumen'); if (!el) return;
    const mes = (hoy || hoyLocal()).slice(0, 7);
    const [y, m] = mes.split('-').map(Number);
    const mesAnt = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const enPer = n => { const f = String(n.fechaSolicitud); return st.periodo === 'todo' || f.startsWith(st.periodo === 'mes' ? mes : mesAnt); };
    const base = notas.filter(n => n.estado !== 'ANULADA' && enPer(n));
    const monto = n => Number(n.montoNc || (n.tipo === 'Completa' ? n.montoDoc : 0)) || 0;
    const grupo = (campo, top = 12) => {
      const g = new Map();
      base.forEach(n => { const k = n[campo] || 'Sin dato'; const x = g.get(k) || { n: 0, $: 0 }; x.n++; x.$ += monto(n); g.set(k, x); });
      const arr = [...g.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, top);
      const max = Math.max(1, ...arr.map(a => a[1].n));
      return arr.map(([k, x]) => `<div class="nc-barrow"><span>${esc(k)}</span><div class="nc-bar"><i style="width:${x.n / max * 100}%"></i></div><b>${x.n}</b><em>${x.$ ? plata(x.$) : ''}</em></div>`).join('') || '<p class="nc-empty">Sin datos en el período</p>';
    };
    const grupoLec = (lista, fn) => {
      const g = new Map();
      lista.forEach(n => { const d = lec(n.lecturaDoc); const k = d && !d.error ? (fn(d) || 'Sin dato') : null; if (!k) return; const x = g.get(k) || { n: 0, $: 0 }; x.n++; x.$ += monto(n); g.set(k, x); });
      const arr = [...g.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
      const max = Math.max(1, ...arr.map(a => a[1].n));
      return arr.map(([k, x]) => `<div class="nc-barrow"><span>${esc(k)}</span><div class="nc-bar"><i style="width:${x.n / max * 100}%"></i></div><b>${x.n}</b><em>${x.$ ? plata(x.$) : ''}</em></div>`).join('') || '<p class="nc-empty">Aún no hay facturas leídas en el período</p>';
    };
    const productosNC = lista => {
      const g = new Map();
      lista.forEach(n => { const d = lec(n.lecturaDoc); if (!d || d.error) return; (d.productos || []).forEach(p => { const k = p.codigo || p.descripcion; if (!k) return; const x = g.get(k) || { d: p.descripcion, n: 0, $: 0 }; x.n++; x.$ += Number(p.total) || 0; g.set(k, x); }); });
      const arr = [...g.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
      const max = Math.max(1, ...arr.map(a => a[1].n));
      return arr.map(([k, x]) => `<div class="nc-barrow"><span title="${esc(x.d)}">${esc(k)} <small class="nc-dim">${esc(x.d || '')}</small></span><div class="nc-bar"><i style="width:${x.n / max * 100}%"></i></div><b>${x.n}</b><em>${x.$ ? plata(x.$) : ''}</em></div>`).join('') || '<p class="nc-empty">Aún no hay facturas leídas en el período</p>';
    };
    // Facturas con N/C marcada en Control de Despachos que no tienen ficha aquí
    const fichas = new Set(notas.map(n => String(n.docNum)));
    const sinFicha = cf ? [...cf.values()].filter(r => r.nc && !fichas.has(String(r.numero).trim())) : [];
    el.innerHTML = `
      <div class="nc-per">${[['mes', 'Este mes'], ['ant', 'Mes anterior'], ['todo', 'Todo']].map(([k, l]) => `<button class="nc-chip${st.periodo === k ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}
        <span class="nc-dim">${base.length} NC · ${plata(base.reduce((s, n) => s + monto(n), 0))} (sin anuladas)</span></div>
      <div class="nc-res">
        <div class="nc-card"><h3 class="nc-h3">Por motivo</h3>${grupo('motivo')}</div>
        <div class="nc-card"><h3 class="nc-h3">Por bodega</h3>${grupo('bodega')}<h3 class="nc-h3 nc-mt">Completa / Parcial</h3>${grupo('tipo')}</div>
        <div class="nc-card"><h3 class="nc-h3">Por quién solicita</h3>${grupo('solicitadoPor')}</div>
        <div class="nc-card"><h3 class="nc-h3">Clientes con más NC</h3>${grupo('cliente', 10)}</div>
        <div class="nc-card"><h3 class="nc-h3">Por vendedor <span class="nc-dim">(de la factura leída)</span></h3>${grupoLec(base, d => d.vendedor)}</div>
        <div class="nc-card"><h3 class="nc-h3">Productos en facturas con NC <span class="nc-dim">(de la factura leída)</span></h3>${productosNC(base)}</div>
      </div>
      <p class="nc-dim" style="margin:12px 0">${notas.filter(n => lec(n.lecturaDoc) && !lec(n.lecturaDoc).error).length} de ${notas.filter(n => urlDoc(n)).length} NC con foto o PDF ya tienen la factura leída${notas.filter(lecturaPendiente).length ? ` · ${notas.filter(lecturaPendiente).length} en cola` : ''}.</p>
      <div class="nc-card"><h3 class="nc-h3">En Control de Despachos con N/C marcada, sin ficha aquí <span class="nc-dim">(${cf ? sinFicha.length : '…'})</span></h3>
        ${!cf ? `<p class="nc-dim">${cfEstado === 'error' ? 'No se pudo consultar Control de Despachos' : 'Cargando…'}</p>` : sinFicha.length
          ? `<div class="nc-tw"><table class="nc-t"><thead><tr><th>Factura</th><th>Fecha</th><th>Bodega</th><th>N/C</th><th>Motivo</th><th></th></tr></thead><tbody>${sinFicha.slice(0, 60).map(r => `<tr><td><b>${esc(r.numero)}</b></td><td>${esc(r.fecha)}</td><td>${esc(r.bodega || 'Aldunate')}</td><td>${esc(r.nc)}</td><td>${esc(r.motivoNc || '—')}</td><td><button class="nc-b nc-sm" data-crear="${esc(r.numero)}">Crear ficha</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="nc-dim">Todo cuadra ✓</p>'}
      </div>`;
  }

  // ============ TELEGRAM (mensajes que llegaron del bot) ============
  const COMO = { bodega: 'Registrada en bodega', solicitud: 'Solicitud', emitida: 'Emitida (PDF timbrado)', comentario: 'Comentario' };
  function dibujarTelegram() {
    const el = root && root.querySelector('#nc-telegram'); if (!el) return;
    const sinAsig = tgs.filter(t => t.estado === 'SIN_ASIGNAR');
    const lista = st.tgFiltro === 'SIN_ASIGNAR' ? sinAsig : tgs;
    const porId = new Map(notas.map(n => [n.id, n]));
    el.innerHTML = `
      <div class="nc-per">${[['SIN_ASIGNAR', `Sin asignar`, sinAsig.length], ['todos', 'Todos los mensajes', null]].map(([k, l, c]) => `<button class="nc-chip${st.tgFiltro === k ? ' on' : ''}" data-tgf="${k}">${l}${c !== null ? ` <b>${c}</b>` : ''}</button>`).join('')}
        <span class="nc-dim">El bot lee el grupo de NC sin escribir nada. Lo que no logra vincular a un documento queda aquí.</span></div>
      ${!tgs.length ? '<div class="nc-card nc-empty">Aún no llegan mensajes del bot. Revisa que esté en el grupo y que el webhook esté activo.</div>'
        : !lista.length ? '<div class="nc-card nc-empty">Nada pendiente ✓</div>'
        : `<div class="nc-tglist">${lista.map(t => {
          const n = porId.get(t.ncId);
          const ico = t.archivoTipo === 'foto' ? '📷' : t.archivoTipo === 'pdf' ? '📄' : t.archivoTipo ? '📎' : '💬';
          const defComo = t.archivoTipo === 'foto' ? 'bodega' : t.archivoTipo === 'pdf' ? 'solicitud' : 'comentario';
          return `<div class="nc-card nc-tg ${t.estado === 'SIN_ASIGNAR' ? 'pend' : ''}">
            <div class="nc-tg-head"><b>${ico} ${esc(t.autor || '—')}</b><span>${fCorta(t.fecha)} ${esc(horaTg(t.hora))}</span></div>
            ${t.texto ? `<p class="nc-tg-txt">${esc(t.texto)}</p>` : ''}
            <div class="nc-tg-foot">
              ${t.archivo ? `<button class="nc-b nc-sm" data-file="${esc(t.archivo)}" data-titulo="${esc((t.autor || 'Telegram') + ' · ' + fCorta(t.fecha) + ' ' + horaTg(t.hora))}">Ver archivo</button>` : ''}
              ${t.estado === 'ASIGNADO' ? `<button class="nc-b nc-sm" data-ver="${esc(t.ncId)}">${n ? esc(docCorto(n)) : esc((t.docTipo === 'Boleta' ? 'B ' : 'F ') + t.docNum)} →</button><span class="nc-dim">${esc(String(t.accion).replace(/^(\w+)/, x => COMO[x] || x))}</span>` : ''}
              ${t.estado === 'IGNORADO' ? '<span class="nc-dim">Conversación / ignorado</span>' : ''}
              ${t.estado === 'SIN_ASIGNAR' ? `<span class="nc-asig" data-msg="${esc(t.msgId)}">
                <select class="nc-in" data-k="tipo"><option>Factura</option><option>Boleta</option></select>
                <input class="nc-in" data-k="num" inputmode="numeric" placeholder="N°">
                <select class="nc-in" data-k="como">${Object.entries(COMO).map(([k, l]) => `<option value="${k}"${k === defComo ? ' selected' : ''}>${l}</option>`).join('')}</select>
                <button class="nc-b nc-sm nc-pri" data-asignar>Asignar</button><button class="nc-b nc-sm" data-ignorar>Ignorar</button></span>` : ''}
            </div></div>`;
        }).join('')}</div>`}`;
  }
  async function accionTg(e) {
    const f = e.target.closest('[data-tgf]'); if (f) { st.tgFiltro = f.dataset.tgf; dibujarTelegram(); return; }
    const ver = e.target.closest('[data-ver]');
    if (ver) { st.tab = 'bandeja'; st.filtro = 'todas'; st.q = ''; st.sel = ver.dataset.ver; const q = root.querySelector('#nc-q'); if (q) q.value = ''; dibujar(); return; }
    const box = e.target.closest('[data-msg]'); if (!box) return;
    if (e.target.closest('[data-ignorar]')) return ejecutar({ action: 'tg_ignorar', msgId: box.dataset.msg }, 'Mensaje ignorado');
    if (e.target.closest('[data-asignar]')) {
      const g = k => box.querySelector(`[data-k="${k}"]`).value.trim();
      if (!g('num')) { toast('Escribe el N° de documento', true); return; }
      return ejecutar({ action: 'tg_asignar', msgId: box.dataset.msg, docTipo: g('tipo'), docNum: g('num'), como: g('como') }, 'Mensaje asignado');
    }
  }

  // ============ IMPORTAR HISTORIAL DE TELEGRAM ============
  // Lee la hoja "Resumen por factura" del Excel exportado del grupo y, si se eligen, sube las fotos (F_<n°>_msg<id>.jpg)
  function abrirImport() {
    if (typeof XLSX === 'undefined') { toast('No se cargó la librería de Excel', true); return; }
    let filas = [];
    const d = abrirDlg('Importar historial de Telegram', `
      <p class="nc-p">1. Elige el Excel <b>Notas_de_Credito_Telegram.xlsx</b> (hoja "Resumen por factura").</p>
      <input type="file" id="i-xls" accept=".xlsx,.xls" class="nc-in">
      <p class="nc-p">2. (Opcional) Elige todas las fotos de la carpeta <b>fotos</b>: se adjuntan solas a su NC según el nombre del archivo.</p>
      <input type="file" id="i-fotos" accept="image/*" multiple class="nc-in">
      <label class="nc-check nc-mt"><input type="checkbox" id="i-emit"> Las "Registradas en bodega" ya fueron emitidas (marcarlas como Emitidas)</label>
      <div id="i-prev" class="nc-p"></div>`, 'Importar', async dd => {
      if (!filas.length) throw new Error('Elige primero el Excel');
      const btn = dd.querySelector('[data-ok]');
      const emit = dd.querySelector('#i-emit').checked;
      const yo = pedirQuien();
      const lote = filas.map(f => {
        const x = { ...f.n };
        if (f.estado === 'bodega' && emit) { x.fechaEmision = x.fechaBodega; x.emitidoPor = 'Histórico (Telegram)'; }
        return x;
      });
      btn.textContent = 'Guardando fichas…';
      const r = await post({ action: 'nc_importar', notas: lote, quien: yo });
      const fotos = [...dd.querySelector('#i-fotos').files];
      const porNombre = new Map(fotos.map(f => [f.name, f]));
      const subir = filas.map((f, i) => ({ id: r.ids[i], foto: f.fotos.map(x => porNombre.get(x)).find(Boolean) })).filter(x => x.foto);
      let ok = 0; const fallos = [];
      for (let k = 0; k < subir.length; k++) {
        btn.textContent = `Subiendo foto ${k + 1} de ${subir.length}…`;
        try { await post({ action: 'nc_archivo', id: subir[k].id, campo: 'fotoUrl', archivo: await prepararArchivo(subir[k].foto), mantener: true }); ok++; }
        catch (e2) { fallos.push(subir[k].foto.name); }
      }
      toast(`${r.nuevos} NC importadas${subir.length ? ` · ${ok} fotos` : ''}${fallos.length ? ` · ${fallos.length} fotos fallaron` : ''}`, fallos.length > 0);
      st.filtro = 'todas'; st.sel = null;
      await cargar();
    });
    d.querySelector('#i-xls').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const prev = d.querySelector('#i-prev');
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets['Resumen por factura'];
        if (!ws) throw new Error('El Excel no tiene la hoja "Resumen por factura"');
        filas = XLSX.utils.sheet_to_json(ws, { defval: '' }).filter(r => r['N°']).map(convertirFila);
        const c = k => filas.filter(x => x.estado === k).length;
        prev.innerHTML = `Leí <b>${filas.length}</b> documentos: ${c('emitida')} timbradas, ${c('bodega')} registradas en bodega, ${c('pendiente')} esperando retiro, ${c('anulada')} anuladas, ${c('solicitada')} solo solicitadas. ${filas.reduce((s, x) => s + x.fotos.length, 0)} fotos referenciadas. Si ya importaste antes, los repetidos no se duplican.`;
      } catch (err) { prev.innerHTML = `<span class="nc-err">${esc(err.message)}</span>`; filas = []; }
    });
  }
  function convertirFila(r) {
    const estadoTxt = String(r['Estado'] || '');
    const fsol = dmyIso(r['Fecha 1er msg']);
    const doc = String(r['Documento'] || '');
    const n = {
      docTipo: /^boleta/i.test(doc) ? 'Boleta' : 'Factura', docNum: String(r['N°']).trim(), cliente: r['Cliente'] || '', bodega: r['Bodega'] || '',
      tipo: r['Tipo NC'] || '', motivo: r['Motivo'] || '', montoDoc: r['Total doc ($)'] === '' ? '' : String(r['Total doc ($)']),
      fechaDoc: dmyIso(r['Fecha doc']), fechaSolicitud: fsol, solicitadoPor: String(r['Solicitado por'] || '').replace(/\s*\(reenvío\)/i, ''),
      obs: [r['Observaciones'], r['PDF solicitud'] && 'PDF solicitud: ' + r['PDF solicitud'], r['PDF timbrado (respuesta)'] && 'PDF timbrado: ' + r['PDF timbrado (respuesta)'], 'Mensajes Telegram: ' + r['IDs mensajes']].filter(Boolean).join(' · ')
    };
    const fotos = String(r['Foto(s)'] || '').split(/[,;\s]+/).filter(x => /\.(jpe?g|png)$/i.test(x));
    let estado = 'solicitada';
    if (/timbrada/i.test(estadoTxt)) {
      estado = 'emitida';
      const t = String(r['PDF timbrado (respuesta)'] || '').match(/\((\d{1,2})\/(\d{1,2})/);
      n.fechaEmision = t ? `${fsol.slice(0, 4)}-${t[2].padStart(2, '0')}-${t[1].padStart(2, '0')}` : fsol;
      n.emitidoPor = String(r['Respondido por'] || '').replace(/\s*\(tú\)/, '');
    } else if (/registrada en bodega/i.test(estadoTxt)) {
      estado = 'bodega'; n.fechaBodega = fsol; n.registradoPor = n.solicitadoPor;
    } else if (/anulada/i.test(estadoTxt)) {
      estado = 'anulada'; n.anulacion = r['Observaciones'] || 'Queda sin efecto';
    } else if (/retiro/i.test(estadoTxt)) {
      estado = 'pendiente'; n.requiereDev = 'SI';
    }
    if (fotos.length && !n.fechaBodega && estado !== 'emitida') { n.fechaBodega = fsol; n.registradoPor = n.registradoPor || n.solicitadoPor; }
    const sust = String(r['Observaciones'] || '').match(/sustituta[^\d]*(\d{5,})/i);
    if (sust) n.facturaSustituta = sust[1];
    return { n, estado, fotos };
  }

  function toast(msg, error) {
    document.querySelectorAll('.nc-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = 'nc-toast' + (error ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function injectStyles() {
    if (document.getElementById('nc-styles')) return;
    const s = document.createElement('style');
    s.id = 'nc-styles';
    s.textContent = `
      .nc{color:#1c2733}
      .nc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .nc-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .nc-quien{display:flex;align-items:center;gap:6px;border:1px solid #d4d9e0;border-radius:8px;padding:0 4px 0 10px;background:#fff;font-size:14px}
      .nc-quien input{border:0;outline:none;padding:8px 6px;font:inherit;font-size:13px;width:130px;background:transparent}
      .nc-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
      .nc-b:hover{background:#f5f7fa}.nc-b:disabled{opacity:.6;cursor:wait}
      .nc-pri{background:#1565c0;border-color:#1565c0;color:#fff}.nc-pri:hover{background:#0f529e}
      .nc-del{color:#b91c1c}.nc-sm{padding:5px 10px;font-size:12px}
      .nc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}
      .nc-kpi{background:#fff;border:1px solid #e1e5ea;border-left:4px solid #1565c0;border-radius:10px;padding:12px 14px}
      .nc-kpi.nar{border-left-color:#ea580c}.nc-kpi.verde{border-left-color:#16a34a}
      .nc-kpi span{display:block;font-size:12px;color:#5b6b7a}.nc-kpi strong{display:block;font-size:24px;margin-top:2px}
      .nc-kpi small{display:block;font-size:12px;color:#5b6b7a;margin-top:2px}
      .nc-tabs{display:inline-flex;gap:2px;padding:4px;background:#fff;border:1px solid #e1e5ea;border-radius:10px;margin-bottom:14px}
      .nc-tabs button{border:0;background:none;padding:8px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:600;color:#5b6b7a;cursor:pointer}
      .nc-tabs button.on{background:#1565c0;color:#fff}
      .nc-badge{display:inline-block;min-width:18px;border-radius:999px;background:#ea580c;color:#fff;font-size:11px;padding:0 5px;margin-left:2px}
      .nc-badge:empty{display:none}
      .nc-tglist{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
      .nc-tg{margin:0;padding:14px}.nc-tg.pend{border-left:4px solid #ea580c}
      .nc-tg-head{display:flex;justify-content:space-between;gap:8px;font-size:14px}.nc-tg-head span{color:#5b6b7a;font-size:12px}
      .nc-tg-txt{margin:8px 0 0;font-size:13px;color:#374151;white-space:pre-wrap}
      .nc-tg-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;font-size:12px}
      .nc-asig{display:flex;flex-wrap:wrap;gap:6px;width:100%}
      .nc-asig .nc-in{width:auto;padding:6px 8px;font-size:13px}.nc-asig [data-k=num]{width:100px}
      .nc-wrap{display:grid;grid-template-columns:350px minmax(0,1fr);gap:18px;align-items:start}
      .nc-list{background:#fff;border:1px solid #e1e5ea;border-radius:10px;display:flex;flex-direction:column;max-height:calc(100vh - 300px);min-height:420px;position:sticky;top:12px;overflow:hidden}
      .nc-list-head{padding:12px;border-bottom:1px solid #eef0f3}
      .nc-row2{display:flex;gap:6px}.nc-bodsel{width:auto;flex-shrink:0;max-width:130px}
      .nc-in{width:100%;box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#1c2733}
      .nc-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
      .nc-chips,.nc-per{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
      .nc-per{margin:0 0 12px}
      .nc-chip{border:1px solid #d4d9e0;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;color:#4b5563}
      .nc-chip b{margin-left:2px}.nc-chip.on{background:#1c2733;border-color:#1c2733;color:#fff}
      .nc-items{overflow:auto;flex:1;min-height:0}
      .nc-item{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #f0f1f4;border-left:3px solid transparent;padding:10px 14px;cursor:pointer;font:inherit;color:inherit}
      .nc-item:hover{background:#f8fafc}.nc-item.cur{background:#eef4fd;border-left-color:#1565c0}
      .nc-it-top{display:flex;align-items:center;gap:6px}.nc-it-top b{font-size:15px}
      .nc-it-r{margin-left:auto;font-size:13px;font-weight:600;color:#5b6b7a}
      .nc-item small{display:block;color:#5b6b7a;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nc-tipo{font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6b7a;background:#f3f4f6;border-radius:4px;padding:1px 5px}
      .nc-late{color:#c2410c;font-weight:700}
      .nc-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0;background:#cbd5e1}
      .nc-dot.sol{background:#2563eb}.nc-dot.dev{background:#ea580c}.nc-dot.bod{background:#9333ea}.nc-dot.emi{background:#16a34a}.nc-dot.anu{background:#9ca3af}
      .nc-est{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;vertical-align:middle}
      .nc-est.sol{background:#dbeafe;color:#1e40af}.nc-est.dev{background:#ffedd5;color:#9a3412}.nc-est.bod{background:#f3e8ff;color:#6b21a8}.nc-est.emi{background:#dcfce7;color:#166534}.nc-est.anu{background:#f3f4f6;color:#6b7280}
      .nc-detail{min-width:0}
      .nc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
      .nc-back{display:none}
      .nc-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:18px;margin-bottom:14px}
      .nc-hl{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .nc-hl h2{margin:0;font-size:20px}.nc-hl p{margin:4px 0 0;color:#5b6b7a}
      .nc-big{text-align:right}.nc-big strong{display:block;font-size:22px}.nc-big span{font-size:12px;color:#5b6b7a}
      .nc-steps{display:flex;list-style:none;margin:16px 0;padding:0;counter-reset:p}
      .nc-steps li{flex:1;position:relative;padding:22px 6px 0;text-align:center;font-size:13px;color:#9ca3af}
      .nc-steps li::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #cbd5e1;z-index:1}
      .nc-steps li::after{content:"";position:absolute;top:7px;left:-50%;width:100%;height:2px;background:#e1e5ea}
      .nc-steps li:first-child::after{display:none}
      .nc-steps li.ok{color:#1c2733}.nc-steps li.ok::before{background:#16a34a;border-color:#16a34a}.nc-steps li.ok::after{background:#16a34a}
      .nc-steps li.anu::before{background:#9ca3af;border-color:#9ca3af}
      .nc-steps b{display:block}.nc-steps small{display:block;font-size:11px;color:#5b6b7a;margin-top:2px}
      .nc-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
      .nc-facts>div{background:#f8fafc;border-radius:8px;padding:9px 11px}
      .nc-facts span{display:block;font-size:12px;color:#5b6b7a}.nc-facts b{display:block;font-size:14px;margin-top:2px}
      .nc-cf{margin:12px 0 0;font-size:13px;color:#15803d}
      .nc-note{margin-top:10px;background:#f8fafc;border-radius:8px;padding:9px 12px;font-size:13px;color:#4b5563}
      .nc-note.anu{background:#f3f4f6;color:#374151}
      .nc-h3{font-size:14px;margin:0 0 10px}.nc-mt{margin-top:16px!important}
      .nc-files{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
      .nc-file{border:1.5px dashed #d4d9e0;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;font-size:14px;font-weight:600}
      .nc-file.has{border-style:solid;border-color:#bbf7d0;background:#f0fdf4}
      .nc-file em{font-style:normal;font-weight:400;font-size:12px;color:#9ca3af}
      .nc-file label{cursor:pointer}
      .nc-hist{list-style:none;margin:0;padding:0;font-size:13px}
      .nc-hist li{padding:7px 0;border-bottom:1px solid #f0f1f4}.nc-hist li:last-child{border:0}
      .nc-hist small{display:block;color:#9ca3af;font-size:11px}
      .nc-dim{color:#9ca3af;font-weight:400}
      .nc-empty{color:#8a97a5;padding:20px;text-align:center;margin:0}
      .nc-err{color:#b91c1c;font-size:13px}.nc-list .nc-err{padding:14px;margin:0}
      .nc-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
      .nc-res .nc-card{margin:0}
      .nc-barrow{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(60px,1fr) 30px 90px;gap:8px;align-items:center;font-size:13px;padding:4px 0}
      .nc-barrow span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nc-barrow b{text-align:right}.nc-barrow em{font-style:normal;color:#5b6b7a;font-size:12px;text-align:right}
      .nc-bar{height:8px;background:#eef0f3;border-radius:99px;overflow:hidden}.nc-bar i{display:block;height:100%;background:#1565c0;border-radius:99px}
      .nc-tw{overflow-x:auto}
      .nc-t{width:100%;border-collapse:collapse;font-size:13px}
      .nc-t th{text-align:left;background:#f5f7fa;color:#5b6b7a;font-size:11px;text-transform:uppercase;padding:8px 10px}
      .nc-t td{padding:8px 10px;border-top:1px solid #eef0f3}
      .nc-dlg{border:0;border-radius:12px;padding:0;width:min(760px,96vw);max-height:92vh;box-shadow:0 20px 60px rgba(0,0,0,.3);color:#1c2733}
      .nc-dlg::backdrop{background:rgba(17,24,39,.45)}
      .nc-dlg-in{display:flex;flex-direction:column;max-height:92vh}
      .nc-dlg-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eef0f3}
      .nc-dlg-head h2{margin:0;font-size:17px}
      .nc-dlg-body{padding:16px 20px;overflow:auto}
      .nc-dlg-body label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}
      .nc-dlg-foot{display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:12px 20px;border-top:1px solid #eef0f3}
      .nc-dlg-foot .nc-err{margin-right:auto}
      .nc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.nc-grid2{grid-template-columns:1fr 1fr}
      .nc-span2{grid-column:span 2}
      .nc-dlg-body .nc-check{flex-direction:row;align-items:center;gap:8px;font-weight:500}
      .nc-check input{width:16px;height:16px;accent-color:#1565c0}
      .nc-drop{border:1.5px dashed #c7d0db;border-radius:10px;padding:14px;margin-top:14px;background:#fafbfc}
      .nc-drop input{font-weight:400;font-size:13px}.nc-drop small{font-weight:400;color:#8a97a5;font-size:12px}
      .nc-hint{font-size:12px;color:#8a97a5;margin:10px 0 0}
      .nc-cfhint{font-size:12px;color:#15803d;margin:10px 0 0;min-height:1em}
      .nc-p{font-size:13px;color:#4b5563;margin:10px 0 6px}
      .nc-x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:6px 8px}
      .nc-visor{border:0;border-radius:14px;padding:0;width:min(900px,94vw);height:min(88vh,1000px);box-shadow:0 20px 60px rgba(0,0,0,.35);color:#1c2733;overflow:hidden}
      .nc-visor::backdrop{background:rgba(17,24,39,.6)}
      .nc-visor-in{display:flex;flex-direction:column;height:100%}
      .nc-visor-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eef0f3;flex-wrap:wrap}
      .nc-visor-head h2{margin:0;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
      .nc-visor-acts{display:flex;gap:8px;align-items:center}
      .nc-visor-body{flex:1;background:#f3f4f6;padding:10px}
      .nc-visor-body iframe{width:100%;height:100%;border:0;border-radius:8px;background:#fff}
      @media (max-width:560px){.nc-visor{width:100vw;max-width:100vw;height:100%;max-height:100vh;border-radius:0}.nc-visor-head h2{flex-basis:100%}}
      .nc-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2733;color:#fff;padding:11px 18px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.2)}
      .nc-toast.err{background:#b91c1c}
      @media (max-width:900px){
        .nc-wrap{grid-template-columns:1fr}
        .nc-list{position:static;max-height:none}
        .nc-wrap.nc-show .nc-list{display:none}
        .nc-wrap:not(.nc-show) .nc-detail{display:none}
        .nc-back{display:inline-flex}
        .nc-grid{grid-template-columns:1fr 1fr}
      }
      @media (max-width:560px){
        .nc-grid,.nc-grid2{grid-template-columns:1fr}.nc-span2{grid-column:auto}
        .nc-kpis{grid-template-columns:1fr 1fr}.nc-kpi strong{font-size:20px}
        .nc-head .nc-acts{width:100%}.nc-quien{flex:1}.nc-quien input{width:100%}
        .nc-top .nc-acts{width:100%}
        .nc-dlg{width:100vw;max-width:100vw;max-height:100vh;height:100%;border-radius:0}
        .nc-dlg-in{max-height:100vh;height:100%}.nc-dlg-body{flex:1}
        .nc-barrow{grid-template-columns:minmax(0,1fr) 60px 26px 80px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
