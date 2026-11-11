// =====================================================
// SECCIÓN: COMPRAS NACIONALES — v2 (mercadería, sin digitar nada; vista por año con comparación año a año)
// Se alimenta del "Informe de Guías de Recepción" de Softland (concepto Compra con Factura), que se carga
// una vez al mes y queda compartido en Drive (Apps Script anexo, /api/despachos?m=inf&tipo=compras).
// Une todos los informes cargados (sin duplicar guías) y muestra: resumen del mes, proveedores, recepciones y productos.
// =====================================================
const ComprasNacionalesSection = (() => {
  const API = '/api/despachos';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let docs = [], informes = [], cargado = false, error = '', root = null;
  const st = { vista: 'anio', anio: '', mes: '', tab: 'resumen', q: '', bodega: '' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plata = v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL');
  const nf = v => (Number(v) || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y.slice(2)}`; };
  const mesLbl = ym => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}`; };
  const mesAnt = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const sum = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const var_ = (a, b) => b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '';

  // ============ CARGA ============
  async function cargar() {
    error = '';
    try {
      const r = await fetch(`${API}?m=inf&tipo=compras&todos=1`, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      informes = d.informes || [];
      // une todos los informes: una guía de recepción (folio) aparece una sola vez, la del informe más nuevo
      const porFolio = new Map();
      informes.slice().sort((a, b) => (a.cargado || 0) - (b.cargado || 0)).forEach(inf => (inf.docs || []).forEach(x => porFolio.set(x.folio + '|' + x.bodega, x)));
      docs = [...porFolio.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
      const meses = [...new Set(docs.map(x => x.fecha.slice(0, 7)))].sort().reverse();
      if (!meses.includes(st.mes)) st.mes = meses[0] || '';
      const anios = [...new Set(docs.map(x => x.fecha.slice(0, 4)))].sort().reverse();
      if (!anios.includes(st.anio)) st.anio = anios[0] || '';
      cargado = true;
    } catch (e) { console.error('Compras nacionales:', e); error = e.message; }
    dibujar();
  }

  async function subir(file) {
    try {
      if (typeof XLSX === 'undefined' || typeof SoftlandRecepciones === 'undefined') throw new Error('No se cargó el lector de Excel');
      const res = SoftlandRecepciones.parse(XLSX.read(await file.arrayBuffer(), { type: 'array' }), XLSX);
      const compras = res.docs.filter(x => !/devoluci/i.test(x.concepto));
      if (!compras.length) throw new Error('El informe no trae recepciones de compras (solo devoluciones)');
      let quien = '';
      try { quien = localStorage.getItem('wl_nc_quien') || localStorage.getItem('wl_rc_quien') || ''; } catch (e) {}
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inf_guardar', tipo: 'compras', quien, informe: { periodo: res.periodo, docs: compras, archivo: file.name, cargado: Date.now() } }) });
      const d = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
      if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
      toast(`Informe cargado: ${compras.length} recepciones del ${fCorta(res.periodo.desde)} al ${fCorta(res.periodo.hasta)}`);
      st.mes = (res.periodo.hasta || compras[0].fecha).slice(0, 7);
      st.anio = st.mes.slice(0, 4);
      await cargar();
    } catch (e) { toast('No se pudo cargar el informe: ' + e.message, true); }
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="cn">
      <div class="section-header cn-head">
        <div><h1>Compras nacionales</h1><p>Mercadería recibida con factura, según los informes de Softland. No se digita nada: se carga el informe del mes.</p></div>
        <div class="cn-acts"><label class="cn-b cn-pri">📥 Cargar informe Softland<input type="file" accept=".xls,.xlsx" id="cn-file" hidden></label></div>
      </div>
      <div id="cn-body"><p class="cn-empty">Cargando…</p></div>
    </div>`;
    root.querySelector('#cn-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) subir(f); });
    root.querySelector('#cn-body').addEventListener('click', e => {
      const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; dibujar(); return; }
      const v = e.target.closest('[data-vista]'); if (v) { st.vista = v.dataset.vista; if (st.vista === 'mes' && !st.mes.startsWith(st.anio)) st.mes = mesesDe(st.anio)[0] || st.mes; dibujar(); return; }
      const c = e.target.closest('[data-ir-mes]'); if (c) { st.vista = 'mes'; st.mes = c.dataset.irMes; st.anio = st.mes.slice(0, 4); dibujar(); return; }
      const p = e.target.closest('[data-prov]'); if (p) { st.tab = 'recepciones'; st.q = p.dataset.prov; dibujar(); }
    });
    root.querySelector('#cn-body').addEventListener('change', e => {
      if (e.target.id === 'cn-mes') { st.mes = e.target.value; st.anio = st.mes.slice(0, 4); dibujar(); }
      if (e.target.id === 'cn-anio') { st.anio = e.target.value; dibujar(); }
      if (e.target.id === 'cn-bod') { st.bodega = e.target.value; dibujar(); }
    });
    root.querySelector('#cn-body').addEventListener('input', e => { if (e.target.id === 'cn-q') { st.q = e.target.value; dibujarTab(); } });
    dibujar();
    cargar();
  }

  // sirve para un mes ('2026-10') o un año entero ('2026')
  const delMes = ym => docs.filter(x => x.fecha.startsWith(ym) && (!st.bodega || x.bodega === st.bodega));
  const per = () => st.vista === 'anio' ? st.anio : st.mes;
  const mesesDe = y => [...new Set(docs.filter(x => x.fecha.startsWith(y)).map(x => x.fecha.slice(0, 7)))].sort().reverse();
  const MES3 = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const millones = v => v ? '$' + (v / 1e6).toFixed(1).replace('.', ',') + ' M' : '';
  // mismo tramo del año anterior: si el año va hasta octubre, se compara contra ene–oct del año anterior
  function tramoAnterior(y) {
    const hasta = mesesDe(y)[0]; if (!hasta) return { lista: [], hasta: '12' };
    const mm = hasta.slice(5, 7), ya = String(Number(y) - 1);
    return { lista: delMes(ya).filter(x => x.fecha.slice(5, 7) <= mm), hasta: mm, ya };
  }
  function agrupar(lista, key, val) {
    const g = new Map();
    lista.forEach(x => { const k = key(x); const o = g.get(k) || { k, total: 0, n: 0 }; o.total += val(x); o.n++; g.set(k, o); });
    return [...g.values()].sort((a, b) => b.total - a.total);
  }
  const barras = (arr, conClick) => { const max = Math.max(1, ...arr.map(a => a.total)); return arr.map(a => `<div class="cn-bar-row${conClick ? ' cn-click' : ''}"${conClick ? ` data-prov="${esc(a.k)}"` : ''}><span title="${esc(a.k)}">${esc(a.k)}</span><div class="cn-bar"><i style="width:${a.total / max * 100}%"></i></div><b>${plata(a.total)}</b><em>${a.n}</em></div>`).join(''); };

  function dibujar() {
    const body = root && root.querySelector('#cn-body'); if (!body) return;
    if (error) { body.innerHTML = `<p class="cn-err">No se pudieron cargar los informes: ${esc(error)}</p>`; return; }
    if (!cargado) return;
    if (!docs.length) { body.innerHTML = `<div class="cn-card cn-empty"><b>Aún no hay informes cargados.</b><br>Exporta de Softland el <i>Informe de Guías de Recepción</i> con concepto <i>Compra con Factura</i> y cárgalo con el botón de arriba. Cada mes que cargues se suma al historial.</div>`; return; }
    const meses = [...new Set(docs.map(x => x.fecha.slice(0, 7)))].sort().reverse();
    const bodegas = [...new Set(docs.map(x => x.bodega))].sort();
    const anios = [...new Set(docs.map(x => x.fecha.slice(0, 4)))].sort().reverse();
    const esAnio = st.vista === 'anio';
    const act = delMes(per());
    let ant, cmp;
    if (esAnio) {
      const t = tramoAnterior(st.anio); ant = t.lista;
      cmp = t.hasta === '12' ? `vs ${t.ya}` : `vs ene–${MES3[Number(t.hasta) - 1].toLowerCase()} ${t.ya}`;
    } else { ant = delMes(mesAnt(st.mes)); cmp = `vs ${mesLbl(mesAnt(st.mes)).split(' ')[0]}`; }
    const tot = sum(act, x => x.total), totAnt = sum(ant, x => x.total);
    const mismoMesAA = !esAnio ? sum(delMes(`${Number(st.mes.slice(0, 4)) - 1}${st.mes.slice(4)}`), x => x.total) : 0;
    const ult = informes.slice().sort((a, b) => (b.cargado || 0) - (a.cargado || 0))[0];
    body.innerHTML = `
      <div class="cn-bar-top">
        <div class="cn-tabs cn-seg">${[['anio', 'Por año'], ['mes', 'Por mes']].map(([k, l]) => `<button data-vista="${k}" class="${st.vista === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${esAnio
          ? `<select class="cn-in" id="cn-anio">${anios.map(a => `<option${a === st.anio ? ' selected' : ''}>${a}</option>`).join('')}</select>`
          : `<select class="cn-in cn-sel" id="cn-mes">${meses.map(m => `<option value="${m}"${m === st.mes ? ' selected' : ''}>${mesLbl(m)}</option>`).join('')}</select>`}
        <select class="cn-in" id="cn-bod"><option value="">Todas las bodegas</option>${bodegas.map(b => `<option${b === st.bodega ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <span class="cn-meta">${informes.length} ${informes.length === 1 ? 'informe cargado' : 'informes cargados'}${ult ? ` · último ${new Date(ult.cargado).toLocaleDateString('es-CL')}${ult.cargadoPor ? ' por ' + esc(ult.cargadoPor) : ''}` : ''}</span>
      </div>
      <div class="cn-kpis">
        <div class="cn-kpi"><span>Compras ${esAnio ? 'del año' : 'del mes'} (neto)</span><strong>${plata(tot)}</strong>${totAnt ? `<small class="${tot >= totAnt ? 'cn-up' : 'cn-down'}">${var_(tot, totAnt)} ${cmp}</small>` : (esAnio ? '<small>Sin datos del año anterior</small>' : '')}${mismoMesAA ? `<small class="${tot >= mismoMesAA ? 'cn-up' : 'cn-down'}">${var_(tot, mismoMesAA)} vs ${mesLbl(st.mes).split(' ')[0]} ${Number(st.mes.slice(0, 4)) - 1}</small>` : ''}</div>
        <div class="cn-kpi"><span>Recepciones</span><strong>${act.length}</strong>${ant.length ? `<small>${ant.length} ${esAnio ? cmp.replace('vs ', 'en ') : 'el mes anterior'}</small>` : ''}</div>
        <div class="cn-kpi"><span>Proveedores</span><strong>${new Set(act.map(x => x.origen)).size}</strong></div>
        <div class="cn-kpi"><span>Productos distintos</span><strong>${new Set(act.flatMap(x => x.lineas.map(l => l.codigo))).size}</strong></div>
      </div>
      <div class="cn-tabs">${[['resumen', 'Resumen'], ['recepciones', 'Recepciones'], ['productos', 'Productos']].map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="cn-tab"></div>`;
    dibujarTab();
  }

  function dibujarTab() {
    const el = root.querySelector('#cn-tab'); if (!el) return;
    const act = delMes(per());
    if (!act.length) { el.innerHTML = `<p class="cn-empty">Sin recepciones en este ${st.vista === 'anio' ? 'año' : 'mes'} con el filtro elegido.</p>`; return; }
    if (st.tab === 'resumen' && st.vista === 'anio') {
      // año vs año: cada mes con la barra del año elegido (azul) y la del año anterior (gris)
      const y = st.anio, ya = String(Number(y) - 1);
      const cols = MES3.map((l, i) => { const mm = String(i + 1).padStart(2, '0'); return { l, mm, a: sum(delMes(`${y}-${mm}`), x => x.total), b: sum(delMes(`${ya}-${mm}`), x => x.total) }; });
      const max = Math.max(1, ...cols.flatMap(c => [c.a, c.b]));
      const porAnio = agrupar(docs.filter(x => !st.bodega || x.bodega === st.bodega), x => x.fecha.slice(0, 4), x => x.total).sort((a, b) => b.k.localeCompare(a.k));
      el.innerHTML = `<div class="cn-grid">
        <div class="cn-card cn-wide"><h3>Compras por mes · ${y} vs ${ya}</h3>
          <div class="cn-ley"><span><i class="cn-ley-a"></i>${y}</span><span><i class="cn-ley-b"></i>${ya}</span></div>
          <div class="cn-cols">${cols.map(c => `<div class="cn-col cn-col2${c.a ? ' cn-click' : ''}"${c.a ? ` data-ir-mes="${y}-${c.mm}" title="Ver ${c.l} ${y}"` : ''}><b>${millones(c.a)}</b><div class="cn-colbar"><i class="cn-b2" style="height:${c.b / max * 100}%" title="${c.l} ${ya}: ${plata(c.b)}"></i><i class="cn-a2" style="height:${c.a / max * 100}%" title="${c.l} ${y}: ${plata(c.a)}"></i></div><span>${c.l}</span></div>`).join('')}</div>
          <p class="cn-hint">Clic en un mes para ver su detalle.</p></div>
        <div class="cn-card"><h3>Por proveedor · ${y}</h3>${barras(agrupar(act, x => x.origen, x => x.total).slice(0, 10), true)}<p class="cn-hint">Clic en un proveedor para ver sus recepciones.</p></div>
        <div class="cn-card"><h3>Por bodega · ${y}</h3>${barras(agrupar(act, x => x.bodega, x => x.total))}<h3 style="margin-top:18px">Total por año</h3>${barras(porAnio)}</div>
      </div>`;
    } else if (st.tab === 'resumen') {
      // evolución mensual (todos los meses cargados)
      const meses = [...new Set(docs.map(x => x.fecha.slice(0, 7)))].sort().slice(-12);
      const porMes = meses.map(m => ({ k: m, total: sum(delMes(m), x => x.total) }));
      const max = Math.max(1, ...porMes.map(m => m.total));
      el.innerHTML = `<div class="cn-grid">
        <div class="cn-card"><h3>Por proveedor</h3>${barras(agrupar(act, x => x.origen, x => x.total).slice(0, 10), true)}<p class="cn-hint">Clic en un proveedor para ver sus recepciones.</p></div>
        <div class="cn-card"><h3>Por bodega</h3>${barras(agrupar(act, x => x.bodega, x => x.total))}</div>
        <div class="cn-card cn-wide"><h3>Compras por mes</h3><div class="cn-cols">${porMes.map(m => `<div class="cn-col${m.k === st.mes ? ' on' : ''}"><b>${m.total ? '$' + (m.total / 1e6).toFixed(1).replace('.', ',') + ' M' : ''}</b><div class="cn-colbar"><i style="height:${m.total / max * 100}%"></i></div><span>${mesLbl(m.k).slice(0, 3)} ${m.k.slice(2, 4)}</span></div>`).join('')}</div></div>
      </div>`;
    } else if (st.tab === 'recepciones') {
      const q = txt(st.q);
      const lista = act.filter(x => !q || txt([x.origen, x.dcto, x.folio, x.bodega, ...x.lineas.map(l => l.codigo + ' ' + l.descripcion)].join(' ')).includes(q));
      el.innerHTML = `<input class="cn-in cn-q" id="cn-q" type="search" placeholder="Buscar proveedor, N° factura, código o producto" value="${esc(st.q)}">
        ${lista.map(x => `<details class="cn-card cn-rec"><summary>
          <div><b>${esc(x.origen)}</b><small>Factura N° ${esc(x.dcto)} · recepción N° ${esc(x.folio)} · ${fCorta(x.fecha)} · ${esc(x.bodega)}</small></div>
          <div class="cn-r"><b>${plata(x.total)}</b><small>${x.lineas.length} ${x.lineas.length === 1 ? 'producto' : 'productos'}</small></div></summary>
          <div class="cn-tw"><table class="cn-t"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th>Un.</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
          <tbody>${x.lineas.map(l => `<tr><td><b>${esc(l.codigo)}</b></td><td>${esc(l.descripcion)}</td><td class="num">${nf(l.cantidad)}</td><td>${esc(l.um)}</td><td class="num">${plata(l.precio)}</td><td class="num">${plata(l.total)}</td></tr>`).join('')}</tbody></table></div></details>`).join('') || '<p class="cn-empty">Nada coincide.</p>'}`;
      const q2 = el.querySelector('#cn-q'); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length);
    } else {
      const g = new Map();
      act.forEach(x => x.lineas.forEach(l => { const o = g.get(l.codigo) || { codigo: l.codigo, desc: l.descripcion, um: l.um, cant: 0, total: 0, provs: new Set() }; o.cant += Number(l.cantidad) || 0; o.total += Number(l.total) || 0; o.provs.add(x.origen); g.set(l.codigo, o); }));
      const arr = [...g.values()].sort((a, b) => b.total - a.total);
      el.innerHTML = `<div class="cn-card cn-pad0"><div class="cn-tw"><table class="cn-t"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th>Un.</th><th class="num">Total neto</th><th>Proveedor(es)</th></tr></thead>
        <tbody>${arr.map(o => `<tr><td><b>${esc(o.codigo)}</b></td><td>${esc(o.desc)}</td><td class="num">${nf(o.cant)}</td><td>${esc(o.um)}</td><td class="num">${plata(o.total)}</td><td>${esc([...o.provs].join(', '))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="num">${plata(sum(arr, o => o.total))}</td><td></td></tr></tfoot></table></div></div>`;
    }
  }

  function toast(msg, err) {
    document.querySelectorAll('.cn-toast').forEach(x => x.remove());
    const t = document.createElement('div'); t.className = 'cn-toast' + (err ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
  }

  function injectStyles() {
    if (document.getElementById('cn-styles')) return;
    const s = document.createElement('style');
    s.id = 'cn-styles';
    s.textContent = `
      .cn{color:#1c2733}
      .cn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .cn-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:9px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
      .cn-pri{background:#1565c0;border-color:#1565c0;color:#fff}.cn-pri:hover{background:#0f529e}
      .cn-bar-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      .cn-in{box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#1c2733}
      .cn-sel{text-transform:capitalize}.cn-q{width:100%;margin-bottom:10px}
      .cn-meta{font-size:12px;color:#8a97a5;margin-left:auto}
      .cn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}
      .cn-kpi{background:#fff;border:1px solid #e1e5ea;border-left:4px solid #1565c0;border-radius:10px;padding:12px 14px}
      .cn-kpi span{display:block;font-size:12px;color:#5b6b7a}.cn-kpi strong{display:block;font-size:22px;margin-top:2px}.cn-kpi small{display:block;font-size:12px;color:#5b6b7a;margin-top:2px}
      .cn-up{color:#b45309!important;font-weight:700}.cn-down{color:#15803d!important;font-weight:700}
      .cn-tabs{display:inline-flex;gap:2px;padding:4px;background:#fff;border:1px solid #e1e5ea;border-radius:10px;margin-bottom:12px}
      .cn-tabs button{border:0;background:none;padding:8px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:600;color:#5b6b7a;cursor:pointer}
      .cn-tabs button.on{background:#1565c0;color:#fff}
      .cn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
      .cn-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:16px}.cn-pad0{padding:0;overflow:hidden}
      .cn-card h3{font-size:14px;margin:0 0 10px}.cn-wide{grid-column:1/-1}
      .cn-bar-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(60px,1fr) 100px 28px;gap:8px;align-items:center;font-size:13px;padding:4px 0}
      .cn-bar-row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cn-bar-row b{text-align:right}.cn-bar-row em{font-style:normal;color:#8a97a5;font-size:12px;text-align:right}
      .cn-click{cursor:pointer;border-radius:6px}.cn-click:hover{background:#f5f7fa}
      .cn-bar{height:8px;background:#eef0f3;border-radius:99px;overflow:hidden}.cn-bar i{display:block;height:100%;background:#1565c0;border-radius:99px}
      .cn-cols{display:flex;gap:8px;align-items:flex-end;height:180px;padding-top:6px}
      .cn-col{flex:1;max-width:96px;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;min-width:0}
      .cn-col b{font-size:10.5px;color:#5b6b7a;white-space:nowrap}
      .cn-colbar{flex:1;width:70%;max-width:56px;display:flex;align-items:flex-end}.cn-colbar i{display:block;width:100%;background:#cbd5e1;border-radius:4px 4px 0 0;min-height:2px}
      .cn-col.on .cn-colbar i{background:#1565c0}
      .cn-seg{margin-bottom:0}.cn-seg button{padding:6px 12px;font-size:13px}
      .cn-col2 .cn-colbar{gap:3px;width:80%}.cn-col2 .cn-colbar i{flex:1;width:auto}.cn-col2 .cn-colbar i.cn-a2{background:#1565c0}
      .cn-ley{display:flex;gap:14px;font-size:12px;color:#5b6b7a;margin:-4px 0 6px}.cn-ley i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
      .cn-ley-a{background:#1565c0}.cn-ley-b{background:#cbd5e1}.cn-col span{font-size:11.5px;color:#5b6b7a;text-transform:capitalize}
      .cn-rec{margin-bottom:8px;padding:0}.cn-rec summary{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;list-style:none}
      .cn-rec summary::-webkit-details-marker{display:none}.cn-rec[open] summary{border-bottom:1px solid #eef0f3}
      .cn-rec summary small{display:block;color:#5b6b7a;font-size:12px;margin-top:2px}.cn-r{text-align:right;flex-shrink:0}
      .cn-tw{overflow-x:auto}.cn-t{width:100%;border-collapse:collapse;font-size:13px}
      .cn-t th{text-align:left;background:#f5f7fa;color:#5b6b7a;font-size:11px;text-transform:uppercase;padding:8px 10px;white-space:nowrap}
      .cn-t td{padding:8px 10px;border-top:1px solid #eef0f3}.cn-t .num{text-align:right;white-space:nowrap}.cn-t tfoot td{font-weight:700;background:#f5f7fa}
      .cn-empty{color:#8a97a5;padding:24px;text-align:center;margin:0}.cn-err{color:#b91c1c}.cn-hint{font-size:12px;color:#8a97a5;margin:8px 0 0}
      .cn-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2733;color:#fff;padding:11px 18px;border-radius:8px;font-size:14px;z-index:9999}.cn-toast.err{background:#b91c1c}
      @media (max-width:700px){.cn-meta{margin-left:0;flex-basis:100%}.cn-grid{grid-template-columns:1fr}.cn-bar-row{grid-template-columns:minmax(0,1fr) 50px 90px 24px}}
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
