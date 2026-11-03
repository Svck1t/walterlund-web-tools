// =====================================================
// SECCIÓN: PRÓXIMAS LLEGADAS — v1 (área comercial, solo lectura)
// Fuente: /api/llegadas (Importaciones pendientes + Packing Lists, sin costos ni GE)
// Se usa dentro de web tools (LlegadasSection.render(content)) y en el link aparte llegadas.html
// =====================================================

const LlegadasSection = (() => {
  const API = '/api/llegadas';
  const FASES = [
    ['todas', 'Todas'],
    ['confirmada', 'Fecha confirmada'],
    ['puerto', 'En puerto'],
    ['transito', 'En tránsito']
  ];
  const st = { vista: 'producto', q: '', fase: 'todas' };
  let data = null, root = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v === null || v === undefined || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fCorta = iso => { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  const dia = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const fechaRef = c => c.llegada || c.eta || '';
  const cap = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';

  // "hoy", "mañana", "en 5 días", "hace 3 días"
  function relativo(iso) {
    if (!iso || !data) return '';
    const n = dia(iso) - dia(data.hoy);
    if (n === 0) return 'hoy';
    if (n === 1) return 'mañana';
    if (n === -1) return 'ayer';
    return n > 0 ? `en ${n} días` : `hace ${-n} días`;
  }
  function cuando(c) {
    if (c.fase === 'confirmada') return `Llega ${fCorta(c.llegada)}${c.hora ? ' ' + esc(c.hora) : ''} · ${relativo(c.llegada)}`;
    if (c.fase === 'puerto') return `En puerto${c.eta ? ' desde ' + fCorta(c.eta) : ''} · fecha por confirmar`;
    if (c.fase === 'transito') return `ETA ${fCorta(c.eta)} · ${relativo(c.eta)}`;
    return 'Sin fecha';
  }
  const faseLbl = { confirmada: 'Fecha confirmada', puerto: 'En puerto', transito: 'En tránsito', sinfecha: 'Sin fecha' };
  const badge = f => `<span class="ll-fase ll-fase-${f}">${faseLbl[f]}</span>`;
  const ordenFase = { confirmada: 0, puerto: 1, transito: 2, sinfecha: 3 };
  const ordenC = (a, b) => ordenFase[a.fase] - ordenFase[b.fase] || (fechaRef(a) + a.hora).localeCompare(fechaRef(b) + b.hora);

  // ============ CARGA ============
  async function cargar() {
    const meta = root.querySelector('#ll-meta');
    meta.textContent = 'Cargando…';
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      data = d;
      data.conts.sort(ordenC);
      meta.textContent = `Actualizado ${d.sync || new Date().toLocaleString('es-CL')} · fechas sujetas a cambio`;
      dibujar();
    } catch (err) {
      console.error('Próximas llegadas:', err);
      meta.innerHTML = `<span class="ll-err">No se pudieron cargar los datos: ${esc(err.message)}</span>`;
    }
  }

  // ============ SECCIÓN ============
  function render(container, opts = {}) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="ll${opts.standalone ? ' ll-solo' : ''}">
      <div class="ll-head">
        <div><h1>🚢 Próximas llegadas</h1><p>Importaciones pendientes de recepción · solo lectura</p></div>
        <button class="ll-btn" id="ll-ref">🔄 Actualizar</button>
      </div>
      <div class="ll-kpis" id="ll-kpis"></div>
      <div class="ll-bar">
        <div class="ll-tabs" role="tablist">
          <button class="ll-tab" data-v="producto" role="tab">📦 Por producto</button>
          <button class="ll-tab" data-v="contenedor" role="tab">🚢 Por contenedor</button>
        </div>
        <input class="ll-search" id="ll-q" type="search" placeholder="Buscar producto, código, contenedor o proveedor" value="${esc(st.q)}">
      </div>
      <div class="ll-chips" id="ll-chips"></div>
      <p class="ll-meta" id="ll-meta"></p>
      <div id="ll-body"></div>
    </div>`;
    // Los listeners van sobre elementos recién creados: no se acumulan al volver a entrar
    root.querySelector('#ll-ref').addEventListener('click', cargar);
    root.querySelector('.ll-tabs').addEventListener('click', e => { const t = e.target.closest('[data-v]'); if (t) { st.vista = t.dataset.v; dibujar(); } });
    root.querySelector('#ll-chips').addEventListener('click', e => { const t = e.target.closest('[data-f]'); if (t) { st.fase = t.dataset.f; dibujar(); } });
    root.querySelector('#ll-q').addEventListener('input', e => { st.q = e.target.value; dibujarCuerpo(); });
    dibujar();
    cargar();
  }

  // ============ FILTROS ============
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const porFase = () => !data ? [] : data.conts.filter(c => st.fase === 'todas' || c.fase === st.fase);

  // Agrupa las líneas de todos los packing lists por producto
  function productos(conts) {
    const m = new Map();
    conts.forEach(c => (c.lineas || []).forEach(l => {
      const [cod, prod, ca, bu, kg] = l;
      const k = (cod || prod) + '|' + c.unidad;
      if (!m.has(k)) m.set(k, { cod, prod, unidad: c.unidad, bulto: c.bulto, ca: 0, bu: 0, kg: 0, conts: new Map() });
      const p = m.get(k);
      p.ca += ca || 0; p.bu += bu || 0; p.kg += kg || 0;
      const e = p.conts.get(c.c) || { c, ca: 0, bu: 0 };
      e.ca += ca || 0; e.bu += bu || 0;
      p.conts.set(c.c, e);
    }));
    return [...m.values()].map(p => {
      const cs = [...p.conts.values()].sort((a, b) => ordenC(a.c, b.c));
      return { ...p, conts: cs, primero: cs[0].c };
    }).sort((a, b) => ordenC(a.primero, b.primero) || String(a.prod).localeCompare(String(b.prod)));
  }

  // ============ RENDER ============
  function dibujar() {
    if (!root) return;
    root.querySelectorAll('.ll-tab').forEach(b => b.classList.toggle('on', b.dataset.v === st.vista));
    const n = f => !data ? 0 : f === 'todas' ? data.conts.length : data.conts.filter(c => c.fase === f).length;
    root.querySelector('#ll-chips').innerHTML = FASES.map(([k, l]) => `<button class="ll-chip${st.fase === k ? ' on' : ''}" data-f="${k}">${l} <b>${n(k)}</b></button>`).join('');
    if (data) {
      const cs = data.conts, conPL = cs.filter(c => c.lineas);
      const kg = cs.reduce((s, c) => s + (c.peso || 0), 0);
      const sem = cs.filter(c => { const f = fechaRef(c); return c.fase === 'puerto' || (f && dia(f) - dia(data.hoy) <= 7); }).length;
      root.querySelector('#ll-kpis').innerHTML = [
        ['Contenedores pendientes', nf(cs.length)],
        ['Llegan en 7 días o ya en puerto', nf(sem)],
        ['Toneladas aprox.', kg ? nf(kg / 1000, 1) : '—'],
        ['Con detalle de productos', `${nf(conPL.length)} de ${nf(cs.length)}`]
      ].map(([l, v]) => `<div class="ll-kpi"><span>${l}</span><strong>${v}</strong></div>`).join('');
    }
    dibujarCuerpo();
  }

  function dibujarCuerpo() {
    const body = root && root.querySelector('#ll-body');
    if (!body) return;
    if (!data) { body.innerHTML = '<p class="ll-empty">Cargando…</p>'; return; }
    const q = txt(st.q.trim());
    const conts = porFase();
    if (st.vista === 'producto') {
      const ps = productos(conts).filter(p => !q || txt([p.cod, p.prod, ...p.conts.map(e => e.c.c + ' ' + e.c.proveedor)].join(' ')).includes(q));
      const sinPL = conts.filter(c => !c.lineas && (!q || txt([c.c, c.material, c.detalle, c.proveedor].join(' ')).includes(q)));
      body.innerHTML = (ps.length ? `<div class="ll-list">${ps.map(prodHtml).join('')}</div>` : '<p class="ll-empty">Ningún producto coincide</p>') +
        (sinPL.length ? `<h3 class="ll-sub">Aún sin detalle de productos (${sinPL.length})</h3>
          <div class="ll-list">${sinPL.map(c => `<div class="ll-row ll-row-sin"><div><b>${esc(c.material || 'Sin material')}</b><small>${esc(c.detalle)}</small></div>
            <div class="ll-r"><span>${esc(c.c)}</span>${badge(c.fase)}<small>${cuando(c)}</small></div></div>`).join('')}</div>` : '');
    } else {
      const cs = conts.filter(c => !q || txt([c.c, c.material, c.detalle, c.proveedor, ...(c.lineas || []).map(l => l[0] + ' ' + l[1])].join(' ')).includes(q));
      body.innerHTML = cs.length ? `<div class="ll-grid">${cs.map(contHtml).join('')}</div>` : '<p class="ll-empty">Ningún contenedor coincide</p>';
    }
  }

  function prodHtml(p) {
    const c0 = p.primero;
    return `<details class="ll-prod">
      <summary class="ll-row">
        <div><b>${esc(p.prod || 'Sin descripción')}</b><small>${esc(p.cod || 'Sin código')}</small></div>
        <div class="ll-r"><strong>${nf(p.ca)} <em>${esc(String(p.unidad).toLowerCase())}</em></strong>
          <small>${p.bu ? nf(p.bu) + ' ' + esc(String(p.bulto).toLowerCase()) + ' · ' : ''}${p.conts.length} ${p.conts.length === 1 ? 'contenedor' : 'contenedores'}</small>
          <small class="ll-next">Primero: ${cuando(c0)}</small></div>
      </summary>
      <table class="ll-tbl"><tbody>${p.conts.map(e => `<tr>
        <td><b>${esc(e.c.c)}</b> ${badge(e.c.fase)}</td>
        <td>${cuando(e.c)}</td>
        <td class="num">${nf(e.ca)} ${esc(String(p.unidad).toLowerCase())}</td></tr>`).join('')}</tbody></table>
    </details>`;
  }

  function contHtml(c) {
    const tot = k => (c.lineas || []).reduce((s, l) => s + (l[k] || 0), 0);
    return `<section class="ll-card">
      <header>
        <div><b class="ll-c">${esc(c.c)}</b> ${badge(c.fase)}</div>
        <small>${cuando(c)}</small>
        <small>${esc(c.proveedor)}${c.material ? ' · ' + esc(c.material) : ''}${c.peso ? ' · ' + nf(c.peso) + ' kg' : ''}${c.bodega ? ' · ' + esc(cap(c.bodega)) : ''}</small>
      </header>
      ${c.lineas ? `<table class="ll-tbl"><thead><tr><th>Producto</th>${c.bulto ? `<th class="num">${esc(cap(c.bulto))}</th>` : ''}<th class="num">${esc(cap(c.unidad))}</th></tr></thead>
        <tbody>${c.lineas.map(l => `<tr><td>${esc(l[1] || l[0])}<small>${esc(l[1] ? l[0] : '')}</small></td>${c.bulto ? `<td class="num">${nf(l[3])}</td>` : ''}<td class="num">${nf(l[2])}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td>${c.bulto ? `<td class="num">${nf(tot(3))}</td>` : ''}<td class="num">${nf(tot(2))}</td></tr></tfoot></table>`
        : `<p class="ll-pend">Detalle de productos pendiente${c.detalle ? ': ' + esc(c.detalle) : ''}</p>`}
    </section>`;
  }

  function injectStyles() {
    if (document.getElementById('ll-styles')) return;
    const s = document.createElement('style');
    s.id = 'll-styles';
    s.textContent = `
      .ll{color:#1c2733;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
      .ll-solo{max-width:1200px;margin:0 auto;padding:20px 16px calc(32px + env(safe-area-inset-bottom))}
      .ll-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}
      .ll-head h1{margin:0;font-size:24px}
      .ll-head p{margin:4px 0 0;color:#5b6b7a;font-size:14px}
      .ll-btn{border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer;white-space:nowrap;font-size:13px;color:#1f2937}
      .ll-btn:hover{background:#f5f7fa}
      .ll-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:16px}
      .ll-kpi{background:#fff;border-left:4px solid #1565c0;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .ll-kpi span{display:block;font-size:12px;color:#5b6b7a}
      .ll-kpi strong{display:block;font-size:22px;margin-top:4px}
      .ll-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
      .ll-tabs{display:flex;background:#fff;border-radius:8px;padding:3px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .ll-tab{border:0;background:none;padding:8px 14px;border-radius:6px;font-weight:600;font-size:14px;cursor:pointer;color:#5b6b7a}
      .ll-tab.on{background:#1565c0;color:#fff}
      .ll-search{flex:1;min-width:220px;border:1px solid #d1d5db;border-radius:8px;padding:9px 12px;font:inherit;font-size:14px}
      .ll-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
      .ll-chip{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:4px 12px;font-size:13px;cursor:pointer;color:#4b5563}
      .ll-chip b{margin-left:3px}
      .ll-chip.on{background:#1c2733;border-color:#1c2733;color:#fff}
      .ll-meta{font-size:12px;color:#7c8a99;margin:0 0 12px}
      .ll-err{color:#b91c1c}
      .ll-empty{color:#7c8a99;padding:24px;text-align:center;background:#fff;border-radius:10px}
      .ll-sub{font-size:15px;margin:22px 0 8px;color:#5b6b7a}
      .ll-list{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}
      .ll-row{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #eef0f3}
      .ll-row>div{min-width:0}
      .ll-row b{display:block;font-size:15px}
      .ll-row small{display:block;color:#5b6b7a;font-size:12px;margin-top:2px}
      .ll-r{text-align:right;flex-shrink:0}
      .ll-r strong{font-size:17px}
      .ll-r em{font-style:normal;font-size:12px;font-weight:500;color:#5b6b7a}
      .ll-r span{font-weight:600;font-size:13px;margin-right:6px}
      .ll-next{color:#1565c0!important}
      .ll-prod summary{cursor:pointer;list-style:none}
      .ll-prod summary::-webkit-details-marker{display:none}
      .ll-prod summary:hover{background:#f8fafc}
      .ll-prod[open] summary{background:#eef4fd}
      .ll-prod .ll-tbl{margin:0;background:#fafbfc;border-bottom:1px solid #eef0f3}
      .ll-row-sin b{color:#5b6b7a}
      .ll-fase{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap}
      .ll-fase-confirmada{background:#dcfce7;color:#166534}
      .ll-fase-puerto{background:#fef3c7;color:#92400e}
      .ll-fase-transito{background:#e0e7ff;color:#3730a3}
      .ll-fase-sinfecha{background:#f3f4f6;color:#6b7280}
      .ll-tbl{width:100%;border-collapse:collapse;font-size:13px}
      .ll-tbl th{text-align:left;background:#f5f7fa;padding:7px 10px;font-size:12px;color:#5b6b7a}
      .ll-tbl td{padding:7px 10px;border-top:1px solid #eef0f3;vertical-align:top}
      .ll-tbl td small{display:block;color:#7c8a99;font-size:11px}
      .ll-tbl .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .ll-tbl tfoot td{font-weight:700;background:#f5f7fa}
      .ll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
      .ll-card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}
      .ll-card header{padding:12px 14px}
      .ll-card header small{display:block;color:#5b6b7a;font-size:12px;margin-top:3px}
      .ll-c{font-size:17px;margin-right:6px}
      .ll-pend{margin:0;padding:12px 14px;background:#fafbfc;border-top:1px solid #eef0f3;color:#5b6b7a;font-size:13px}
      @media (max-width:700px){
        .ll-head h1{font-size:20px}
        .ll-grid{grid-template-columns:1fr}
        .ll-search{min-width:0;width:100%}
        .ll-tabs{width:100%}.ll-tab{flex:1}
        .ll-kpi strong{font-size:18px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
