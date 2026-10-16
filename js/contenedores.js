// =====================================================
// SECCIÓN: COLA DE CONTENEDORES (v5)
// Fuente: pestaña "Importaciones" (espejo del Excel Control Contenedores 2026)
// Checkbox web -> pestaña "RecepcionesWeb" vía Apps Script
// =====================================================

const ContendedoresSection = (() => {
  const API_URL = 'https://script.google.com/macros/s/AKfycbxT1l0nfxchryNr0KbFD5cqo1eVfRgt7GiSWmmxUI3B1iSx5fZXyUm5a8q-BViIQ3P-/exec'; // termina en /exec
  const HORA_LIMITE = '14:00';
  const REFRESH_MS = 60000;

  let rows = [];
  let meta = { hoy: '', ahora: '', sync: '' };
  let tab = 'proximos';
  let filtro = '';
  let timer = null;
  let root = null;

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fCorta = iso => { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${+d}-${MESES[+m - 1]}`; };
  const fLarga = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const kg = n => n ? n.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' kg' : '—';
  const isoToDay = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const recep = r => r.recepExcel || r.recepWeb;
  const fechaRef = r => r.llegada || r.eta;

  // ============ INIT ============
  function init(container) {
    if (!container) { console.error('ContendedoresSection.init(): falta container'); return; }
    root = container;
    injectStyles();
    root.innerHTML = `
      <div class="ci">
        <div class="ci-head">
          <div>
            <h1>📦 Cola de Contenedores</h1>
            <p>Importaciones desde el Excel Control Contenedores 2026 (límite ${HORA_LIMITE})</p>
          </div>
          <button class="ci-btn" id="ci-refresh">🔄 Actualizar ahora</button>
        </div>
        <div class="ci-kpis" id="ci-kpis"></div>
        <p class="ci-meta" id="ci-meta">Cargando…</p>
        <div class="ci-tabs" role="tablist">
          <button class="ci-tab" data-tab="proximos" role="tab">📅 Próximos</button>
          <button class="ci-tab" data-tab="todas" role="tab">📋 Todas las importaciones</button>
        </div>
        <div id="ci-body"></div>
      </div>`;

    root.querySelector('#ci-refresh').addEventListener('click', () => cargar(true));
    root.querySelectorAll('.ci-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    root.addEventListener('change', onCheck);
    root.addEventListener('input', e => {
      if (e.target.id === 'ci-buscar') { filtro = e.target.value; renderTabla(); }
    });

    cargar(true);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.body.contains(root)) { clearInterval(timer); return; } // salió de la sección
      cargar(false);
    }, REFRESH_MS);
  }

  // ============ DATOS ============
  async function cargar(mostrarCarga) {
    const metaEl = root.querySelector('#ci-meta');
    if (mostrarCarga && metaEl) metaEl.textContent = 'Cargando…';
    try {
      const res = await fetch(API_URL, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Respuesta inválida');
      rows = data.rows;
      meta = { hoy: data.hoy, ahora: data.ahora, sync: data.sync };
      render();
    } catch (err) {
      console.error(err);
      if (metaEl) metaEl.innerHTML = `<span class="ci-err">No se pudieron cargar los datos: ${esc(err.message)}. Revisa API_URL y que el Web App esté implementado con acceso "Cualquier usuario".</span>`;
    }
  }

  async function onCheck(e) {
    const cb = e.target;
    if (!cb.classList.contains('ci-check')) return;
    const r = rows.find(x => x.key === cb.dataset.key);
    if (!r) return;
    const valor = cb.checked;
    r.recepWeb = valor; // optimista
    cb.disabled = true;
    try {
      const url = `${API_URL}?action=marcar&key=${encodeURIComponent(r.key)}&valor=${valor ? 1 : 0}`;
      const data = await (await fetch(url, { cache: 'no-store' })).json();
      if (!data.ok) throw new Error(data.error);
      toast(valor ? `${r.contenedor} marcado como recepcionado` : `${r.contenedor} desmarcado`);
    } catch (err) {
      r.recepWeb = !valor;
      toast(`No se guardó ${r.contenedor}: ${err.message}`, true);
    }
    render();
  }

  // ============ CLASIFICACIÓN ============
  function clasificar() {
    const hoy = isoToDay(meta.hoy);
    const dow = (new Date(hoy * 86400000).getUTCDay() + 6) % 7; // 0 = lunes
    const finSemana = hoy + (6 - dow);
    const finProx = finSemana + 7;
    const out = { hoy: [], dias: [], semana: [] };

    rows.filter(r => !recep(r) && fechaRef(r)).forEach(r => {
      const d = isoToDay(fechaRef(r));
      const atrasado = d < hoy;
      if (atrasado || (d === hoy && (!r.hora || r.hora < HORA_LIMITE))) out.hoy.push({ ...r, atrasado });
      else if (d <= finSemana) out.dias.push(r);
      else if (d <= finProx) out.semana.push(r);
    });
    const orden = (a, b) => (fechaRef(a) + a.hora).localeCompare(fechaRef(b) + b.hora);
    Object.values(out).forEach(l => l.sort(orden));
    return out;
  }

  // ============ RENDER ============
  function render() {
    if (!root) return;
    const g = clasificar();
    const nRecep = rows.filter(recep).length;

    root.querySelector('#ci-kpis').innerHTML = [
      ['Hoy (antes ' + HORA_LIMITE + ')', g.hoy.length],
      ['Próximos días', g.dias.length],
      ['Próxima semana', g.semana.length],
      ['✅ Recepcionados', nRecep],
      ['⏳ Pendientes', rows.length - nRecep]
    ].map(([l, v]) => `<div class="ci-kpi"><span>${l}</span><strong>${v}</strong></div>`).join('');

    root.querySelector('#ci-meta').textContent =
      `Última actualización: ${meta.ahora}` + (meta.sync ? ` · ${meta.sync.replace('Sync automático:', 'Excel sincronizado:')}` : '');

    root.querySelectorAll('.ci-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const body = root.querySelector('#ci-body');

    if (tab === 'proximos') {
      body.innerHTML = `<div class="ci-cols">
        ${panel('📍 Hoy (antes ' + HORA_LIMITE + ')', g.hoy)}
        ${panel('⏰ Próximos días (esta semana)', g.dias)}
        ${panel('🗓️ Próxima semana', g.semana)}
      </div>`;
    } else {
      body.innerHTML = `
        <input id="ci-buscar" class="ci-search" type="search" placeholder="Buscar contenedor, orden, proveedor, material o bodega" value="${esc(filtro)}">
        <div class="ci-table-wrap" id="ci-tabla"></div>`;
      renderTabla();
    }
  }

  function panel(titulo, lista) {
    const items = lista.length ? lista.map(r => `
      <li class="ci-item${r.atrasado ? ' ci-late' : ''}">
        <input type="checkbox" class="ci-check" data-key="${esc(r.key)}" aria-label="Marcar ${esc(r.contenedor)} como recepcionado">
        <div>
          <b>${esc(r.contenedor)}</b>${r.atrasado ? ' <em>atrasado</em>' : ''}
          <small>${fCorta(fechaRef(r))}${r.hora ? ' ' + esc(r.hora) : ''}${r.llegada ? '' : ' (ETA)'} · ${esc(r.proveedor)}</small>
          <small>${esc(r.material)} · ${kg(r.peso)}${r.bodega ? ' · ' + esc(r.bodega) : ''}</small>
        </div>
      </li>`).join('') : '<li class="ci-empty">Sin contenedores</li>';
    return `<section class="ci-panel"><h3>${titulo}<span>${lista.length}</span></h3><ul>${items}</ul></section>`;
  }

  function renderTabla() {
    const wrap = root && root.querySelector('#ci-tabla');
    if (!wrap) return;
    const q = filtro.trim().toUpperCase();
    const lista = rows
      .filter(r => !q || [r.contenedor, r.orden, r.proveedor, r.material, r.bodega, r.estado].join(' ').toUpperCase().includes(q))
      .sort((a, b) => ((fechaRef(b) || '') + b.hora).localeCompare((fechaRef(a) || '') + a.hora) || (Number(b.n) - Number(a.n)));

    wrap.innerHTML = `<table class="ci-table">
      <thead><tr><th>Recep.</th><th>N°</th><th>Llegada</th><th>Hora</th><th>Proveedor</th><th>N° Orden</th><th>Contenedor</th><th>Material</th><th class="num">Peso</th><th>Bodega</th><th>Estado</th></tr></thead>
      <tbody>${lista.map(r => {
        const estado = r.recepExcel ? r.estado : (r.recepWeb ? 'RECEPCIONADO (web)' : (r.estado || 'PENDIENTE'));
        const check = r.recepExcel
          ? `<input type="checkbox" checked disabled title="Recepcionado en el Excel">`
          : `<input type="checkbox" class="ci-check" data-key="${esc(r.key)}" ${r.recepWeb ? 'checked' : ''} title="${r.recepWebFecha ? 'Marcado ' + esc(r.recepWebFecha) : 'Marcar recepcionado'}">`;
        return `<tr class="${recep(r) ? '' : 'ci-pend'}">
          <td>${check}</td><td>${esc(r.n)}</td>
          <td>${r.llegada ? fLarga(r.llegada) : fLarga(r.eta) + (r.eta ? ' (ETA)' : '')}</td>
          <td>${esc(r.hora) || '—'}</td><td>${esc(r.proveedor)}</td><td>${esc(r.orden)}</td>
          <td><b>${esc(r.contenedor)}</b></td><td>${esc(r.material)}</td>
          <td class="num">${kg(r.peso)}</td><td>${esc(r.bodega)}</td><td>${esc(estado)}</td></tr>`;
      }).join('') || '<tr><td colspan="11" class="ci-empty">No hay importaciones que coincidan con la búsqueda</td></tr>'}
      </tbody></table>`;
  }

  // ============ UI ============
  function toast(msg, error) {
    const t = document.createElement('div');
    t.className = 'ci-toast' + (error ? ' ci-toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function injectStyles() {
    if (document.getElementById('ci-styles')) return;
    const s = document.createElement('style');
    s.id = 'ci-styles';
    s.textContent = `
      .ci{padding:24px;color:#1f2937}
      .ci-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px}
      .ci-head h1{margin:0;font-size:22px}
      .ci-head p{margin:4px 0 0;color:#6b7280;font-size:13px}
      .ci-btn{background:#1e7b34;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-weight:600;cursor:pointer}
      .ci-btn:hover{background:#17652a}
      .ci-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;background:#f5f7fa;padding:14px;border-radius:10px}
      .ci-kpi{background:#fff;border-left:4px solid #667eea;border-radius:8px;padding:16px}
      .ci-kpi span{display:block;font-size:12px;color:#6b7280}
      .ci-kpi strong{display:block;font-size:26px;margin-top:6px}
      .ci-meta{text-align:center;font-size:12px;color:#6b7280;margin:14px 0}
      .ci-err{color:#b91c1c}
      .ci-tabs{display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:18px}
      .ci-tab{background:none;border:0;border-bottom:3px solid transparent;padding:10px 18px;font-weight:600;color:#6b7280;cursor:pointer}
      .ci-tab.active{color:#4f5bd5;border-bottom-color:#667eea}
      .ci-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
      .ci-panel{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .ci-panel h3{margin:0 0 12px;font-size:15px;display:flex;justify-content:space-between}
      .ci-panel h3 span{color:#667eea}
      .ci-panel ul{list-style:none;margin:0;padding:0;max-height:480px;overflow:auto}
      .ci-item{display:flex;gap:10px;padding:10px 0;border-top:1px solid #f0f1f4}
      .ci-item small{display:block;color:#6b7280;font-size:12px;margin-top:2px}
      .ci-item em{color:#b91c1c;font-style:normal;font-size:11px;font-weight:700}
      .ci-late{background:#fef2f2}
      .ci-check{width:18px;height:18px;cursor:pointer;accent-color:#1e7b34;flex-shrink:0;margin-top:2px}
      .ci-empty{color:#9ca3af;text-align:center;padding:30px 0}
      .ci-search{width:100%;max-width:480px;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:12px;font-size:14px}
      .ci-table-wrap{overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .ci-table{width:100%;border-collapse:collapse;font-size:13px}
      .ci-table th{background:#f5f7fa;text-align:left;padding:10px;position:sticky;top:0;white-space:nowrap}
      .ci-table td{padding:8px 10px;border-top:1px solid #f0f1f4;white-space:nowrap}
      .ci-table .num{text-align:right}
      .ci-pend td{background:#fffbeb}
      .ci-toast{position:fixed;bottom:24px;right:24px;background:#1e7b34;color:#fff;padding:12px 18px;border-radius:8px;z-index:9999;font-size:14px}
      .ci-toast-err{background:#b91c1c}
      button:focus-visible,input:focus-visible{outline:2px solid #667eea;outline-offset:2px}
      @media (max-width:900px){.ci-kpis{grid-template-columns:repeat(2,1fr)}.ci-cols{grid-template-columns:1fr}.ci-head{flex-direction:column}}
    `;
    document.head.appendChild(s);
  }

  return { init };
})();
