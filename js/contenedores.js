// =====================================================
// SECCIÓN: COLA DE CONTENEDORES (v9 — pestaña Packing lists + sección Packing Lists, js/packingLists.js)
// Fuente: pestaña "Importaciones" (espejo del Excel Control Contenedores 2026)
// Solo lectura: el estado se marca en el Excel
// =====================================================

const ContendedoresSection = (() => {
  const API_URL = 'https://script.google.com/macros/s/AKfycbx7bJ0YhnRKBF7pEO3OgOUcBPq82C4yO37TC2FmQFwNCZmOG_uDt5uzDkWiNFkWAr-GBQ/exec'; // termina en /exec
  const HORA_LIMITE = '14:00';
  const REFRESH_MS = 60000;
  const HIST_URL = 'data/importaciones-2025.json'; // histórico estático (Excel 2025)
  const ORDEN_ESTADO = { 'PENDIENTE': 0, 'GUARDADO': 1, 'EN PUERTO': 2, 'PREINGRESADO': 3, 'RECEPCIONADO': 4 };

  let hist = null;        // { rows, resumen } del histórico
  let histError = '';

  let rows = [];
  let meta = { hoy: '', ahora: '', sync: '' };
  let tab = 'proximos';
  let filtro = '';
  let timer = null;
  let root = null;
  let lastSig = '';
  let lastSigPL = '';
  let dashYear = null;
  let charts = [];
  let pendiente = null;   // contenedor a mostrar al entrar desde Packing Lists

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fCorta = iso => { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${+d}-${MESES[+m - 1]}`; };
  const fLarga = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const kg = n => n ? n.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' kg' : '—';
  const isoToDay = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const recep = r => r.recepExcel; // solo manda el Excel
  const fechaRef = r => r.llegada || r.eta;
  const normCont = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const estadoDe = r => String(r.estado || '').trim().toUpperCase() || 'PENDIENTE';
  const ordenEstado = e => (e in ORDEN_ESTADO ? ORDEN_ESTADO[e] : 3);
  const bodCls = b => { const u = String(b || '').toUpperCase(); return u.includes('ALDUNATE') ? 'ald' : u.includes('VIEL') ? 'viel' : ''; };
  const corto = (t, n = 28) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const esMovil = () => window.matchMedia('(max-width: 700px)').matches;

  // ============ INIT ============
  function init(container) {
    if (!container) { console.error('ContendedoresSection.init(): falta container'); return; }
    root = container;
    injectStyles();
    root.innerHTML = `
      <div class="ci">
        <div class="ci-head">
          <div>
            <h1>📦 Control Importaciones</h1>
            <p>Importaciones desde el Excel Control Contenedores 2026 (límite ${HORA_LIMITE})</p>
          </div>
          <button class="ci-btn" id="ci-refresh">🔄 Actualizar ahora</button>
        </div>
        <div class="ci-kpis" id="ci-kpis"></div>
        <p class="ci-meta" id="ci-meta">Cargando…</p>
        <div class="ci-tabs" role="tablist">
          <button class="ci-tab" data-tab="proximos" role="tab">📅 Próximos</button>
          <button class="ci-tab" data-tab="todas" role="tab">📋 Todas<span class="ci-hide-sm"> las importaciones</span></button>
          <button class="ci-tab" data-tab="packing" role="tab">📦 Packing<span class="ci-hide-sm"> lists</span></button>
          <button class="ci-tab" data-tab="dashboard" role="tab">📊 Dashboard</button>
        </div>
        <div id="ci-body"></div>
      </div>`;

    root.querySelector('#ci-refresh').addEventListener('click', () => cargar(true));
    root.querySelectorAll('.ci-tab').forEach(b => b.addEventListener('click', () => irTab(b.dataset.tab)));
    root.addEventListener('click', e => {
      const ver = e.target.closest('[data-pl]');
      if (ver) { PackingLists.seleccionar(ver.dataset.pl); irTab('packing', true); return; }
      const nuevo = e.target.closest('[data-plnew]');
      if (nuevo) { irTab('packing'); PackingLists.formNuevo(nuevo.dataset.plnew); return; }
      const pdf = e.target.closest('[data-plpdf]');
      if (pdf) { PackingLists.pdfContenedores(pdf.dataset.plpdf.split(',')); return; }
    });
    root.addEventListener('input', e => {
      if (e.target.id === 'ci-buscar') { filtro = e.target.value; renderTabla(); }
    });

    if (pendiente) { tab = 'todas'; filtro = pendiente; pendiente = null; }
    cargar(true);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!root.querySelector('.ci')) { clearInterval(timer); return; } // salió de la sección
      cargar(false);
    }, REFRESH_MS);
  }

  // ============ DATOS ============
  async function cargar(mostrarCarga) {
    const metaEl = root.querySelector('#ci-meta');
    if (mostrarCarga && metaEl) metaEl.textContent = 'Cargando…';
    try {
      const [res] = await Promise.all([fetch(API_URL, { cache: 'no-store' }), cargarHist(), PackingLists.cargar(false)]);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Respuesta inválida');
      meta = { hoy: data.hoy, ahora: data.ahora, sync: data.sync };
      const sig = JSON.stringify(data.rows);
      const sigPL = PackingLists.firma();
      if (sig === lastSig && sigPL === lastSigPL && !mostrarCarga) { renderMeta(); return; } // sin cambios: no redibuja
      lastSigPL = sigPL;
      lastSig = sig;
      rows = unir(data.rows, hist ? hist.rows : []);
      render();
    } catch (err) {
      console.error(err);
      if (metaEl) metaEl.innerHTML = `<span class="ci-err">No se pudieron cargar los datos: ${esc(err.message)}. Revisa API_URL y que el Web App esté implementado con acceso "Cualquier usuario".</span>`;
    }
  }

  async function cargarHist() {
    if (hist || histError) return;
    try {
      const r = await fetch(HIST_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      hist = await r.json();
    } catch (err) {
      console.error('Histórico 2025:', err);
      histError = err.message;
    }
  }

  // Agrega el histórico sin duplicar lo que ya venga en el Excel 2026
  function unir(actual, viejas) {
    const ya = new Set(actual.map(r => normCont(r.contenedor) + '|' + (r.llegada || '')));
    return actual.concat(viejas.filter(r => !ya.has(normCont(r.contenedor) + '|' + (r.llegada || ''))));
  }

  // ============ CLASIFICACIÓN ============
  function clasificar(lista = rows, hoyIso = meta.hoy) {
    const hoy = isoToDay(hoyIso);
    const dow = (new Date(hoy * 86400000).getUTCDay() + 6) % 7; // 0 = lunes
    const finSemana = hoy + (6 - dow);
    const finProx = finSemana + 7;
    const out = { hoy: [], dias: [], semana: [] };

    lista.filter(r => !recep(r) && fechaRef(r)).forEach(r => {
      if (r.llegada) {
        const dl = isoToDay(r.llegada);
        // HOY: llega hoy antes del límite, o llegada pasada sin recepcionar
        if (dl < hoy) return out.hoy.push({ ...r, tag: 'atrasado', tagCls: 'late' });
        if (dl === hoy && (!r.hora || r.hora < HORA_LIMITE)) return out.hoy.push(r);
        // Llega hoy después del límite o mañana -> "Mañana"
        const tag = (dl === hoy || dl === hoy + 1) ? { tag: 'mañana', tagCls: 'next' } : {};
        if (dl === hoy || dl <= finSemana) return out.dias.push({ ...r, ...tag });
        if (dl <= finProx) return out.semana.push({ ...r, ...tag });
        return;
      }
      // Sin Fecha de Llegada: se usa la ETA
      const d = isoToDay(r.eta);
      // ETA hoy o pasada = ya está en puerto, falta que informen la salida
      if (d <= hoy) return out.dias.push({ ...r, tag: 'por informar', tagCls: 'pend' });
      if (d <= finSemana) return out.dias.push(r);
      if (d <= finProx) return out.semana.push(r);
    });
    // Orden: mañana, atrasados, llegada confirmada, "por informar" y al final los que solo tienen ETA
    const rango = r => r.tagCls === 'next' ? 0 : r.tagCls === 'late' ? 1 : r.llegada ? 2 : r.tagCls === 'pend' ? 3 : 4;
    const orden = (a, b) => rango(a) - rango(b) || (fechaRef(a) + a.hora).localeCompare(fechaRef(b) + b.hora);
    Object.values(out).forEach(l => l.sort(orden));
    return out;
  }

  // ============ RENDER ============
  function render() {
    if (!root) return;
    const g = clasificar();
    const yHoy = meta.hoy.slice(0, 4);
    const nRecep = rows.filter(r => recep(r) && String(fechaRef(r) || '').startsWith(yHoy)).length;
    const nPend = rows.filter(r => !recep(r)).length;

    root.querySelector('#ci-kpis').innerHTML = [
      ['Hoy (antes ' + HORA_LIMITE + ')', g.hoy.length],
      ['Próximos días', g.dias.length],
      ['Próxima semana', g.semana.length],
      ['✅ Recepcionados ' + yHoy, nRecep],
      ['⏳ Pendientes', nPend]
    ].map(([l, v]) => `<div class="ci-kpi"><span>${l}</span><strong>${v}</strong></div>`).join('');

    renderMeta();

    root.querySelectorAll('.ci-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const body = root.querySelector('#ci-body');

    charts.forEach(c => c.destroy()); charts = [];
    if (tab === 'packing') {
      PackingLists.render(body, rows);
    } else if (tab === 'dashboard') {
      renderDashboard(body);
    } else if (tab === 'proximos') {
      body.innerHTML = `<div class="ci-legend"><span class="ci-sw-ald"></span>Aldunate <span class="ci-sw-viel"></span>Viel</div>
      <div class="ci-cols">
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

  // Indicador de packing list: 📦 abre el detalle, ＋ crea uno (solo pendientes)
  function badgePL(r) {
    const c = normCont(r.contenedor);
    if (!c) return '';
    if (PackingLists.tiene(c)) return `<button class="ci-pl" data-pl="${esc(c)}" title="Ver packing list">📦 PL</button>`;
    if (!recep(r) && /^[A-Z]{4}\d{7}$/.test(c)) return `<button class="ci-pl ci-pl-no" data-plnew="${esc(c)}" title="Crear packing list">＋ PL</button>`;
    return '';
  }

  // Cambia de pestaña (force: redibuja aunque ya esté en ella, ej. para mostrar otro packing list)
  function irTab(t, force) {
    if (tab === t && !force) return;
    tab = t;
    root.querySelector('#ci-body').innerHTML = '';
    render();
  }

  function panel(titulo, lista) {
    const items = lista.length ? lista.map(r => `
      <li class="ci-item${bodCls(r.bodega) ? ' ci-b-' + bodCls(r.bodega) : ''}${r.tagCls === 'late' ? ' ci-late' : ''}">
        <div>
          <b>${esc(r.contenedor)}</b>${r.tag ? ` <em class="ci-tag ci-tag-${r.tagCls}">${r.tag}</em>` : ''} ${badgePL(r)}
          <small>${fCorta(fechaRef(r))}${r.hora ? ' ' + esc(r.hora) : ''}${r.llegada ? '' : ' (ETA)'} · ${esc(r.proveedor)}</small>
          <small>${esc(r.material)} · ${kg(r.peso)}${r.bodega ? ' · ' + esc(r.bodega) : ''}</small>
        </div>
      </li>`).join('') : '<li class="ci-empty">Sin contenedores</li>';
    const conPL = lista.map(r => normCont(r.contenedor)).filter(c => PackingLists.tiene(c));
    const btnPdf = conPL.length ? `<button class="ci-pl ci-pl-pdf" data-plpdf="${esc(conPL.join(','))}" title="Descargar los packing lists de esta lista">📄 PDF (${conPL.length})</button>` : '';
    return `<section class="ci-panel"><h3>${titulo}<span>${btnPdf}${lista.length}</span></h3><ul>${items}</ul></section>`;
  }

  function renderTabla() {
    const wrap = root && root.querySelector('#ci-tabla');
    if (!wrap) return;
    const q = filtro.trim().toUpperCase();
    const lista = rows
      .filter(r => !q || [r.contenedor, r.orden, r.proveedor, r.material, r.detalle, r.bodega, estadoDe(r)].join(' ').toUpperCase().includes(q))
      .sort((a, b) =>
        ordenEstado(estadoDe(a)) - ordenEstado(estadoDe(b)) ||
        ((fechaRef(b) || '') + b.hora).localeCompare((fechaRef(a) || '') + a.hora) ||
        (Number(b.n) - Number(a.n)));

    const cuenta = {};
    lista.forEach(r => { const e = estadoDe(r); cuenta[e] = (cuenta[e] || 0) + 1; });

    let grupo = null;
    const filas = lista.map(r => {
      const estado = estadoDe(r);
      const bc = bodCls(r.bodega);
      let head = '';
      if (estado !== grupo) {
        grupo = estado;
        head = `<tr class="ci-grp ci-grp-${ordenEstado(estado)}"><td colspan="10">${esc(estado)} <span>${cuenta[estado]}</span></td></tr>`;
      }
      return head + `<tr class="${recep(r) ? '' : 'ci-pend'}">
          <td class="c-n">${esc(r.n)}</td>
          <td class="c-lleg">${r.llegada ? fLarga(r.llegada) : fLarga(r.eta) + (r.eta ? ' (ETA)' : '')}</td>
          <td class="c-hora">${esc(r.hora) || '—'}</td>
          <td class="c-prov">${esc(r.proveedor) || '—'}</td>
          <td class="c-orden">${esc(r.orden)}</td>
          <td class="c-cont"><b>${esc(r.contenedor)}</b> ${badgePL(r)}</td>
          <td class="c-mat" title="${esc(r.detalle || r.material)}">${esc(r.material)}</td>
          <td class="c-peso num">${kg(r.peso)}</td>
          <td class="c-bod">${r.bodega ? `<span class="ci-bod${bc ? ' ci-bod-' + bc : ''}">${esc(r.bodega)}</span>` : '—'}</td>
          <td class="c-est"><span class="ci-est ci-est-${ordenEstado(estado)}">${esc(estado)}</span></td></tr>`;
    }).join('');

    wrap.innerHTML = `<table class="ci-table">
      <thead><tr><th>N°</th><th>Llegada</th><th>Hora</th><th>Proveedor</th><th>N° Orden</th><th>Contenedor</th><th>Material</th><th class="num">Peso</th><th>Bodega</th><th>Estado</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="10" class="ci-empty">No hay importaciones que coincidan con la búsqueda</td></tr>'}
      </tbody></table>`;
  }

  // ============ DASHBOARD ============
  const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const FERIADOS = new Set([
    '2025-01-01', '2025-04-18', '2025-05-01', '2025-05-21', '2025-06-20', '2025-07-16', '2025-08-15', '2025-09-18', '2025-09-19', '2025-10-31', '2025-12-08', '2025-12-25',
    '2026-01-01', '2026-04-03', '2026-05-01', '2026-05-21', '2026-06-29', '2026-07-16', '2026-09-18', '2026-10-12', '2026-12-08', '2026-12-25'
  ]);
  const BODEGAS = [
    { k: 'VIEL', l: 'Viel', c: '#2563eb' },
    { k: 'ALDUNATE', l: 'Aldunate', c: '#dc2626' },
    { k: 'SAN FRANCISCO', l: 'San Francisco', c: '#16a34a' },
    { k: 'CLIENTE', l: 'Cliente', c: '#9333ea' },
    { k: 'CONCHA', l: 'Stgo Concha', c: '#ea580c' },
    { k: 'OTRA', l: 'Otra / sin asignar', c: '#9ca3af' }
  ];
  const PALETA = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#65a30d', '#0d9488', '#9ca3af'];
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const normBod = b => { const u = String(b || '').toUpperCase(); const f = BODEGAS.find(x => x.k !== 'OTRA' && u.includes(x.k)); return f ? f.k : 'OTRA'; };
  const pad = n => String(n).padStart(2, '0');

  function diasLaborales(y, m, hastaIso) {
    let n = 0;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
      if (hastaIso && iso > hastaIso) break;
      const w = new Date(Date.UTC(y, m, d)).getUTCDay();
      if (w !== 0 && w !== 6 && !FERIADOS.has(iso)) n++;
    }
    return n;
  }

  let chartPromise = null;
  function loadChart() {
    if (window.Chart) return Promise.resolve();
    if (!chartPromise) chartPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = res;
      s.onerror = () => { chartPromise = null; rej(new Error('No se pudo cargar la librería de gráficos')); };
      document.head.appendChild(s);
    });
    return chartPromise;
  }

  function calcDashboard() {
    const rec = rows.filter(recep).map(r => ({ ...r, f: r.llegada || r.eta, bod: normBod(r.bodega) })).filter(r => r.f);
    const years = [...new Set(rec.map(r => r.f.slice(0, 4)))].sort().reverse();
    const yHoy = meta.hoy.slice(0, 4);
    if (!dashYear || !years.includes(dashYear)) dashYear = years.includes(yHoy) ? yHoy : years[0];
    const Y = Number(dashYear);
    const ry = rec.filter(r => r.f.startsWith(dashYear));
    const esActual = dashYear === yHoy;
    const mesHoy = Number(meta.hoy.slice(5, 7)) - 1;
    const mesesTrans = esActual ? mesHoy + 1 : 12;

    const porMes = Array(12).fill(0), kgMes = Array(12).fill(0);
    const bodMes = {}; BODEGAS.forEach(b => bodMes[b.k] = Array(12).fill(0));
    const antes = Array(12).fill(0), despues = Array(12).fill(0), sinHora = Array(12).fill(0);
    const porHora = Array(24).fill(0), porDia = Array(7).fill(0);
    const prov = {}, mat = {};
    const puerto = [], puertoMes = Array.from({ length: 12 }, () => []);
    let conPeso = 0, kgTotal = 0;

    ry.forEach(r => {
      const m = Number(r.f.slice(5, 7)) - 1;
      porMes[m]++; kgMes[m] += r.peso; kgTotal += r.peso; if (r.peso > 0) conPeso++;
      bodMes[r.bod][m]++;
      const p = prov[r.proveedor || 'Sin proveedor'] = prov[r.proveedor || 'Sin proveedor'] || { n: 0, kg: 0, dias: [] };
      p.n++; p.kg += r.peso;
      const mt = mat[r.material || 'Sin material'] = mat[r.material || 'Sin material'] || { n: 0, kg: 0 };
      mt.n++; mt.kg += r.peso;
      if (/^\d{2}:\d{2}$/.test(r.hora)) {
        (r.hora < HORA_LIMITE ? antes : despues)[m]++;
        porHora[Number(r.hora.slice(0, 2))]++;
      } else sinHora[m]++;
      if (r.llegada) porDia[new Date(isoToDay(r.llegada) * 86400000).getUTCDay()]++;
      if (r.llegada && r.eta) {
        const d = isoToDay(r.llegada) - isoToDay(r.eta);
        if (d >= 0 && d <= 90) { puerto.push({ d, r }); puertoMes[m].push(d); p.dias.push(d); }
      }
    });

    // Meses sin detalle: se completan con el resumen mensual por bodega (ej. ene–may 2025)
    const nDet = ry.length;
    const resumen = hist && hist.resumen && hist.resumen[dashYear];
    const soloResumen = [];
    if (resumen) {
      for (let m = 0; m < mesesTrans; m++) {
        if (porMes[m]) continue;
        let s = 0;
        Object.entries(resumen).forEach(([b, arr]) => { const v = Number(arr[m]) || 0; bodMes[normBod(b)][m] += v; s += v; });
        if (s) { porMes[m] = s; soloResumen.push(m); }
      }
    }
    const total = porMes.reduce((a, b) => a + b, 0);

    const dl = Array.from({ length: 12 }, (_, m) => diasLaborales(Y, m));
    const dlTrans = Array.from({ length: 12 }, (_, m) => diasLaborales(Y, m, esActual ? meta.hoy : null)).reduce((a, b) => a + b, 0);
    const prom = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const mesesActivos = porMes.slice(0, mesesTrans);
    const maxM = mesesActivos.indexOf(Math.max(...mesesActivos));
    const minM = mesesActivos.indexOf(Math.min(...mesesActivos));
    const top = o => Object.entries(o).sort((a, b) => b[1].n - a[1].n);
    const totBod = BODEGAS.map(b => ({ ...b, n: bodMes[b.k].reduce((x, y) => x + y, 0) })).filter(b => b.n);
    const conHora = antes.reduce((a, b) => a + b, 0) + despues.reduce((a, b) => a + b, 0);
    const maxPuerto = puerto.sort((a, b) => b.d - a.d)[0];

    // Pendientes actuales (todas, sin filtro de año)
    const hoyD = isoToDay(meta.hoy);
    const pend = { 'Por informar (en puerto)': 0, 'En tránsito (ETA futura)': 0, 'Llegada programada': 0, 'Atrasados': 0, 'Sin fechas': 0 };
    rows.filter(r => !recep(r)).forEach(r => {
      if (r.llegada) pend[isoToDay(r.llegada) < hoyD ? 'Atrasados' : 'Llegada programada']++;
      else if (r.eta) pend[isoToDay(r.eta) <= hoyD ? 'Por informar (en puerto)' : 'En tránsito (ETA futura)']++;
      else pend['Sin fechas']++;
    });

    return {
      years, Y, total, nDet, soloResumen, kgTotal, conPeso, porMes, kgMes, bodMes, dl, dlTrans, mesesTrans,
      antes, despues, sinHora, porHora, porDia, prov: top(prov), mat: top(mat), totBod,
      puertoProm: prom(puerto.map(x => x.d)), puertoN: puerto.length, puertoMes: puertoMes.map(prom), puertoArr: puerto.map(x => x.d),
      maxPuerto, maxM, minM, conHora, pend
    };
  }

  function renderDashboard(body) {
    if (!rows.length) { body.innerHTML = '<p class="ci-empty">Sin datos todavía</p>'; return; }
    const D = calcDashboard();
    if (!D.total) { body.innerHTML = '<p class="ci-empty">No hay contenedores recepcionados para mostrar</p>'; return; }
    const pctAntes = D.conHora ? D.antes.reduce((a, b) => a + b, 0) / D.conHora * 100 : 0;
    const bodUsadas = BODEGAS.filter(b => D.bodMes[b.k].some(v => v));
    const meses = MESES_L.map(m => m.slice(0, 3));
    const pendTot = Object.values(D.pend).reduce((a, b) => a + b, 0);

    const kpi = (l, v, sub) => `<div class="ci-kpi"><span>${l}</span><strong>${v}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const mtxRow = (label, arr, fmt, cls = '', sw = '') =>
      `<tr class="${cls}"><td>${sw}${label}</td>${arr.map(v => `<td>${fmt(v)}</td>`).join('')}</tr>`;
    const tot = a => a.reduce((x, y) => x + y, 0);

    body.innerHTML = `
      <div class="ci-dash-bar">
        <label>Año <select id="ci-year">${D.years.map(y => `<option ${y === dashYear ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <small>Contenedores con Estado RECEPCIONADO, agrupados por mes de Fecha de Llegada (o ETA si no tiene)</small>
      </div>
      ${D.soloResumen.length ? `<p class="ci-note">ℹ️ ${D.soloResumen.map(m => MESES_L[m]).join(', ')}: solo hay totales por bodega (sin detalle de contenedor, peso ni proveedor). Los gráficos de detalle consideran ${nf(D.nDet)} contenedores.</p>` : ''}

      <div class="ci-kpis ci-kpis-auto">
        ${kpi('Contenedores recepcionados', nf(D.total))}
        ${kpi('Toneladas recepcionadas', nf(D.kgTotal / 1000, 1), D.conPeso < D.total ? `${D.total - D.conPeso} sin peso registrado` : '')}
        ${kpi('Promedio diario', nf(D.total / (D.dlTrans || 1), 2), `${D.dlTrans} días laborales${D.mesesTrans < 12 ? ' a la fecha' : ''}`)}
        ${kpi('Promedio mensual', nf(D.total / D.mesesTrans, 1), `${D.mesesTrans} meses`)}
        ${kpi('Días en puerto (prom.)', nf(D.puertoProm, 1), `ETA → Llegada, ${D.puertoN} contenedores`)}
        ${kpi('Llegadas antes de ' + HORA_LIMITE, D.conHora ? nf(pctAntes, 0) + '%' : '—', `${D.conHora} con hora registrada`)}
        ${kpi('Peso promedio', D.conPeso ? nf(D.kgTotal / D.conPeso) + ' kg' : '—', 'por contenedor')}
        ${kpi('Pendientes hoy', nf(pendTot), 'todos los años')}
      </div>

      <div class="ci-card" style="margin-top:18px">
        <h3>Contenedores recepcionados por bodega y mes — ${dashYear}</h3>
        <div class="ci-table-wrap"><table class="ci-mtx">
          <thead><tr><th>Bodega</th>${meses.map(m => `<th>${m}</th>`).join('')}<th>Total</th><th>%</th></tr></thead>
          <tbody>
            ${bodUsadas.map(b => `<tr><td><span class="ci-sw" style="background:${b.c}"></span>${b.l}</td>${D.bodMes[b.k].map(v => `<td>${v || ''}</td>`).join('')}<td class="tot">${tot(D.bodMes[b.k])}</td><td class="tot">${nf(tot(D.bodMes[b.k]) / D.total * 100, 1)}%</td></tr>`).join('')}
            <tr class="sum"><td>Total contenedores</td>${D.porMes.map(v => `<td>${v}</td>`).join('')}<td>${D.total}</td><td>100%</td></tr>
            <tr><td>Días laborales</td>${D.dl.map(v => `<td>${v}</td>`).join('')}<td class="tot">${tot(D.dl)}</td><td></td></tr>
            <tr><td>Contenedores diarios</td>${D.porMes.map((v, m) => `<td>${nf(v / D.dl[m], 2)}</td>`).join('')}<td class="tot">${nf(D.total / (D.dlTrans || 1), 2)}</td><td></td></tr>
            <tr><td>Toneladas</td>${D.kgMes.map(v => `<td>${v ? nf(v / 1000, 1) : ''}</td>`).join('')}<td class="tot">${nf(D.kgTotal / 1000, 1)}</td><td></td></tr>
            <tr><td>Días en puerto (prom.)</td>${D.puertoMes.map(v => `<td>${v ? nf(v, 1) : ''}</td>`).join('')}<td class="tot">${nf(D.puertoProm, 1)}</td><td></td></tr>
          </tbody>
        </table></div>
      </div>

      <div class="ci-grid2">
        <div class="ci-card"><h3>Contenedores y toneladas por mes</h3><div class="ci-chart"><canvas id="ch-mes"></canvas></div></div>
        <div class="ci-card"><h3>Distribución por bodega</h3><div class="ci-chart"><canvas id="ch-bod"></canvas></div></div>

        <div class="ci-card"><h3>Contenedores por bodega cada mes</h3><div class="ci-chart"><canvas id="ch-bodmes"></canvas></div></div>
        <div class="ci-card"><h3>Datos destacados — ${dashYear}</h3>
          <div class="ci-ins">
            <div><span>Mes con más actividad</span><strong>${MESES_L[D.maxM]} (${D.porMes[D.maxM]})</strong></div>
            <div><span>Mes con menos actividad</span><strong>${MESES_L[D.minM]} (${D.porMes[D.minM]})</strong></div>
            <div><span>Proveedor principal</span><strong>${esc(D.prov[0][0])} (${D.prov[0][1].n})</strong></div>
            <div><span>Material principal</span><strong>${esc(D.mat[0][0])} (${D.mat[0][1].n})</strong></div>
            <div><span>Bodega principal</span><strong>${D.totBod.sort((a, b) => b.n - a.n)[0].l} (${nf(D.totBod[0].n / D.total * 100, 0)}%)</strong></div>
            <div><span>Mayor tiempo en puerto</span><strong>${D.maxPuerto ? `${D.maxPuerto.d} días (${esc(D.maxPuerto.r.contenedor)})` : '—'}</strong></div>
            <div><span>Proveedores distintos</span><strong>${D.prov.length}</strong></div>
            <div><span>Materiales distintos</span><strong>${D.mat.length}</strong></div>
          </div>
        </div>

        <div class="ci-card"><h3>Toneladas por proveedor</h3><div class="ci-chart"><canvas id="ch-prov"></canvas></div></div>
        <div class="ci-card"><h3>Resumen por proveedor</h3>
          <div class="ci-table-wrap"><table class="ci-mtx">
            <thead><tr><th>Proveedor</th><th>Cont.</th><th>%</th><th>Toneladas</th><th>Días puerto</th></tr></thead>
            <tbody>${D.prov.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${nf(v.n / (D.nDet || 1) * 100, 1)}%</td><td>${nf(v.kg / 1000, 1)}</td><td>${v.dias.length ? nf(v.dias.reduce((a, b) => a + b, 0) / v.dias.length, 1) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="ci-card"><h3>Materiales más recepcionados</h3><p class="ci-sub">Top 12 por cantidad de contenedores</p><div class="ci-chart"><canvas id="ch-mat"></canvas></div></div>
        <div class="ci-card"><h3>Toneladas por material</h3><p class="ci-sub">Top 12 por peso</p><div class="ci-chart"><canvas id="ch-matkg"></canvas></div></div>

        <div class="ci-card"><h3>Hora de llegada por mes</h3><p class="ci-sub">Antes y después de las ${HORA_LIMITE}</p><div class="ci-chart"><canvas id="ch-hora"></canvas></div></div>
        <div class="ci-card"><h3>Llegadas por hora del día</h3><div class="ci-chart"><canvas id="ch-horadia"></canvas></div></div>

        <div class="ci-card"><h3>Días en puerto promedio por mes</h3><p class="ci-sub">Desde la ETA hasta la Fecha de Llegada a bodega</p><div class="ci-chart"><canvas id="ch-puerto"></canvas></div></div>
        <div class="ci-card"><h3>Distribución de días en puerto</h3><div class="ci-chart"><canvas id="ch-puertodist"></canvas></div></div>

        <div class="ci-card"><h3>Llegadas por día de la semana</h3><div class="ci-chart"><canvas id="ch-dia"></canvas></div></div>
        <div class="ci-card"><h3>Pendientes actuales</h3><p class="ci-sub">Todo lo que aún no figura como RECEPCIONADO en el Excel</p><div class="ci-chart"><canvas id="ch-pend"></canvas></div></div>
      </div>`;

    body.querySelector('#ci-year').addEventListener('change', e => { dashYear = e.target.value; render(); });

    loadChart().then(() => {
      if (tab !== 'dashboard' || !document.body.contains(body)) return;
      dibujar(D, meses);
    }).catch(err => {
      body.insertAdjacentHTML('afterbegin', `<p class="ci-err">${esc(err.message)}</p>`);
    });
  }

  function dibujar(D, meses) {
    const mk = (id, cfg) => { const el = root.querySelector('#' + id); if (el) charts.push(new Chart(el, cfg)); };
    // Funciones (no objetos compartidos): Chart.js escribe "scales" dentro del objeto de opciones que recibe
    const baseF = () => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } });
    const sinLeyendaF = () => ({ ...baseF(), plugins: { legend: { display: false } } });
    const pct = (v, t) => t ? ` (${nf(v / t * 100, 1)}%)` : '';
    const dona = (labels, data, colors, unidad) => ({
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
      options: {
        ...baseF(), cutout: '55%',
        plugins: {
          legend: { position: esMovil() ? 'bottom' : 'right', labels: { boxWidth: 12, generateLabels: ch => {
            const t = data.reduce((a, b) => a + b, 0);
            return labels.map((l, i) => ({ text: `${l}${pct(data[i], t)}`, fillStyle: colors[i], strokeStyle: colors[i], index: i }));
          } } },
          tooltip: { callbacks: { label: c => `${c.label}: ${nf(c.raw, unidad === 't' ? 1 : 0)}${unidad === 't' ? ' t' : ''}` } }
        }
      }
    });

    mk('ch-mes', {
      data: {
        labels: meses,
        datasets: [
          { type: 'bar', label: 'Contenedores', data: D.porMes, backgroundColor: '#2563eb', yAxisID: 'y' },
          { type: 'line', label: 'Toneladas', data: D.kgMes.map(v => v ? +(v / 1000).toFixed(1) : null), spanGaps: false, borderColor: '#ea580c', backgroundColor: '#ea580c', tension: .3, yAxisID: 'y1' }
        ]
      },
      options: { ...baseF(), scales: { y: { beginAtZero: true, title: { display: true, text: 'Contenedores' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Toneladas' } } } }
    });

    const tb = D.totBod;
    mk('ch-bod', dona(tb.map(b => b.l), tb.map(b => b.n), tb.map(b => b.c)));

    mk('ch-bodmes', {
      type: 'bar',
      data: { labels: meses, datasets: BODEGAS.filter(b => D.bodMes[b.k].some(v => v)).map(b => ({ label: b.l, data: D.bodMes[b.k], backgroundColor: b.c })) },
      options: { ...baseF(), scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    const pv = D.prov.filter(([, v]) => v.kg > 0);
    mk('ch-prov', dona(pv.map(p => p[0]), pv.map(p => +(p[1].kg / 1000).toFixed(1)), pv.map((_, i) => PALETA[i % PALETA.length]), 't'));

    const m12 = D.mat.slice(0, 12);
    mk('ch-mat', { type: 'bar', data: { labels: m12.map(m => corto(m[0])), datasets: [{ label: 'Contenedores', data: m12.map(m => m[1].n), backgroundColor: '#0891b2' }] }, options: { ...sinLeyendaF(), indexAxis: 'y' } });
    const mkg = [...D.mat].sort((a, b) => b[1].kg - a[1].kg).filter(m => m[1].kg > 0).slice(0, 12);
    mk('ch-matkg', { type: 'bar', data: { labels: mkg.map(m => corto(m[0])), datasets: [{ label: 'Toneladas', data: mkg.map(m => +(m[1].kg / 1000).toFixed(1)), backgroundColor: '#ea580c' }] }, options: { ...sinLeyendaF(), indexAxis: 'y' } });

    mk('ch-hora', {
      type: 'bar',
      data: {
        labels: meses, datasets: [
          { label: 'Antes de ' + HORA_LIMITE, data: D.antes, backgroundColor: '#16a34a' },
          { label: 'Después de ' + HORA_LIMITE, data: D.despues, backgroundColor: '#ca8a04' },
          { label: 'Sin hora', data: D.sinHora, backgroundColor: '#d1d5db' }
        ]
      },
      options: { ...baseF(), scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    const h0 = D.porHora.findIndex(v => v), h1 = 23 - [...D.porHora].reverse().findIndex(v => v);
    const horas = h0 < 0 ? [] : Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    mk('ch-horadia', {
      type: 'bar',
      data: { labels: horas.map(h => pad(h) + ':00'), datasets: [{ label: 'Contenedores', data: horas.map(h => D.porHora[h]), backgroundColor: horas.map(h => pad(h) + ':00' < HORA_LIMITE ? '#16a34a' : '#ca8a04') }] },
      options: sinLeyendaF()
    });

    mk('ch-puerto', { type: 'bar', data: { labels: meses, datasets: [{ label: 'Días promedio', data: D.puertoMes.map(v => +v.toFixed(1)), backgroundColor: '#9333ea' }] }, options: { ...sinLeyendaF(), scales: { y: { beginAtZero: true, title: { display: true, text: 'Días' } } } } });

    const tramos = [['0–2', 0, 2], ['3–5', 3, 5], ['6–10', 6, 10], ['11–15', 11, 15], ['16–30', 16, 30], ['+30', 31, 999]];
    mk('ch-puertodist', { type: 'bar', data: { labels: tramos.map(t => t[0] + ' días'), datasets: [{ label: 'Contenedores', data: tramos.map(([, a, b]) => D.puertoArr.filter(d => d >= a && d <= b).length), backgroundColor: '#4f46e5' }] }, options: sinLeyendaF() });

    const ordenDias = [1, 2, 3, 4, 5, 6, 0];
    mk('ch-dia', { type: 'bar', data: { labels: ordenDias.map(d => DIAS_SEM[d]), datasets: [{ label: 'Contenedores', data: ordenDias.map(d => D.porDia[d]), backgroundColor: '#0d9488' }] }, options: sinLeyendaF() });

    const pe = Object.entries(D.pend).filter(([, v]) => v);
    mk('ch-pend', dona(pe.map(p => p[0]), pe.map(p => p[1]), pe.map(([k]) => ({ 'Por informar (en puerto)': '#ca8a04', 'En tránsito (ETA futura)': '#2563eb', 'Llegada programada': '#16a34a', 'Atrasados': '#dc2626', 'Sin fechas': '#9ca3af' }[k]))));
  }

  function renderMeta() {
    const el = root && root.querySelector('#ci-meta');
    if (el) el.textContent = `Última actualización: ${meta.ahora}` +
      (meta.sync ? ` · ${meta.sync.replace('Sync automático:', 'Excel sincronizado:')}` : '') +
      (histError ? ` · ⚠️ Histórico 2025 no disponible (${histError})` : '');
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
      .ci-item{display:flex;gap:10px;padding:10px 12px;margin-top:6px;border-radius:8px;border-left:4px solid transparent;background:#f9fafb}
      .ci-item b{font-size:15px}
      .ci-b-ald{background:#fce7f3;border-left-color:#ec4899}
      .ci-b-viel{background:#fef9c3;border-left-color:#eab308}
      .ci-legend{display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;margin:-6px 0 12px}
      .ci-legend span{display:inline-block;width:12px;height:12px;border-radius:3px;margin-left:8px}
      .ci-legend span:first-child{margin-left:0}
      .ci-sw-ald{background:#fce7f3;border:2px solid #ec4899}
      .ci-sw-viel{background:#fef9c3;border:2px solid #eab308}
      .ci-item small{display:block;color:#6b7280;font-size:12px;margin-top:2px}
      .ci-pl{border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;border-radius:10px;font-size:11px;font-weight:700;padding:1px 8px;cursor:pointer;margin-left:4px;white-space:nowrap;font-family:inherit}
      .ci-pl:hover{background:#e0e7ff}
      .ci-pl-no{background:#fff;border-style:dashed;color:#6b7280;border-color:#d1d5db}
      .ci-pl-pdf{margin:0 8px 0 0;font-size:11px}
      .ci-tag{font-style:normal;font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px}
      .ci-tag-late{color:#b91c1c;background:#fee2e2}
      .ci-tag-pend{color:#92400e;background:#fef3c7}
      .ci-tag-next{color:#1e40af;background:#dbeafe}
      .ci-late{border-left-color:#dc2626}
      .ci-late:not(.ci-b-ald):not(.ci-b-viel){background:#fef2f2}
      .ci-empty{color:#9ca3af;text-align:center;padding:30px 0}
      .ci-search{width:100%;max-width:480px;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:12px;font-size:14px}
      .ci-table-wrap{overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .ci-table{width:100%;border-collapse:collapse;font-size:13px}
      .ci-table th{background:#f5f7fa;text-align:left;padding:10px;position:sticky;top:0;white-space:nowrap}
      .ci-table td{padding:8px 10px;border-top:1px solid #f0f1f4;white-space:nowrap}
      .ci-table .num{text-align:right}
      .ci-table .c-mat{max-width:190px;overflow:hidden;text-overflow:ellipsis}
      .ci-table .c-orden{max-width:150px;overflow:hidden;text-overflow:ellipsis}
      .ci-pend td{background:#fffbeb}
      .ci-grp td{background:#eef2ff;font-weight:700;font-size:12px;letter-spacing:.04em;color:#3730a3;padding:7px 10px}
      .ci-grp td span{background:#fff;border-radius:10px;padding:1px 8px;margin-left:6px;font-size:11px}
      .ci-grp-0 td{background:#fee2e2;color:#991b1b}
      .ci-grp-1 td{background:#e0e7ff;color:#3730a3}
      .ci-grp-2 td{background:#fef3c7;color:#92400e}
      .ci-grp-4 td{background:#dcfce7;color:#166534}
      .ci-bod{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:#f3f4f6}
      .ci-bod-ald{background:#fce7f3;color:#9d174d}
      .ci-bod-viel{background:#fef9c3;color:#854d0e}
      .ci-est{font-size:12px;font-weight:600}
      .ci-est-0{color:#b91c1c}.ci-est-1{color:#4338ca}.ci-est-2{color:#b45309}.ci-est-4{color:#15803d}
      .ci-note{background:#eff6ff;color:#1e40af;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 14px}
      .ci-toast{position:fixed;bottom:24px;right:24px;background:#1e7b34;color:#fff;padding:12px 18px;border-radius:8px;z-index:9999;font-size:14px}
      .ci-toast-err{background:#b91c1c}
      button:focus-visible,input:focus-visible{outline:2px solid #667eea;outline-offset:2px}
      .ci-kpis-auto{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
      .ci-kpi small{display:block;font-size:11px;color:#9ca3af;margin-top:4px}
      .ci-dash-bar{display:flex;align-items:center;gap:14px;margin-bottom:14px;font-size:14px;flex-wrap:wrap}
      .ci-dash-bar select{padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;margin-left:6px}
      .ci-dash-bar small{color:#6b7280}
      .ci-mtx{width:100%;border-collapse:collapse;font-size:13px}
      .ci-mtx th,.ci-mtx td{padding:7px 8px;border:1px solid #eef0f3;text-align:center;white-space:nowrap}
      .ci-mtx th{background:#f5f7fa}
      .ci-mtx td:first-child,.ci-mtx th:first-child{text-align:left;font-weight:600}
      .ci-mtx .tot{font-weight:700;background:#f5f7fa}
      .ci-mtx tr.sum td{font-weight:700;background:#eef2ff}
      .ci-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
      .ci-grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
      .ci-card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08);min-width:0}
      .ci-card h3{margin:0 0 12px;font-size:15px}
      .ci-card .ci-sub{margin:-8px 0 12px;font-size:12px;color:#6b7280}
      .ci-card .ci-table-wrap{box-shadow:none;max-height:300px;overflow:auto}
      .ci-chart{position:relative;height:290px}
      .ci-ins{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ci-ins div{background:#f5f7fa;border-radius:8px;padding:12px}
      .ci-ins span{display:block;font-size:12px;color:#6b7280}
      .ci-ins strong{display:block;font-size:15px;margin-top:4px}
      .ci-tabs{overflow-x:auto;scrollbar-width:none}
      .ci-tab{white-space:nowrap}
      @media (max-width:900px){.ci-kpis{grid-template-columns:repeat(2,1fr)}.ci-cols{grid-template-columns:1fr}.ci-head{flex-direction:column}.ci-grid2,.ci-ins{grid-template-columns:1fr}.ci-panel ul{max-height:none}}
      @media (max-width:700px){
        .ci{padding:0}
        .ci-head{gap:12px;margin-bottom:14px}
        .ci-head h1{font-size:19px}
        .ci-btn{width:100%;padding:12px}
        .ci-kpis{gap:8px;padding:8px}
        .ci-kpis-auto{grid-template-columns:repeat(2,1fr)}
        .ci-kpi{padding:10px 12px}
        .ci-kpi span{font-size:11px}
        .ci-kpi strong{font-size:22px;margin-top:2px}
        .ci-tab{padding:10px 12px;font-size:14px}
        .ci-hide-sm{display:none}
        .ci-panel,.ci-card{padding:14px}
        .ci-search{max-width:none;font-size:16px}
        .ci-chart{height:260px}
        /* Tabla -> tarjetas */
        #ci-tabla.ci-table-wrap{background:none;box-shadow:none;overflow:visible}
        .ci-table thead{display:none}
        .ci-table,.ci-table tbody{display:block}
        .ci-table tr{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:"cont cont est" "lleg hora bod" "mat mat peso" "prov orden orden";gap:3px 10px;background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
        .ci-table tr.ci-pend{background:#fffbeb}
        .ci-table td{border:0;padding:0;white-space:normal;font-size:13px;min-width:0}
        .ci-table tr:not(.ci-grp) td{background:none}
        .ci-table .c-n{display:none}
        .ci-table .c-cont{grid-area:cont;font-size:15px}
        .ci-table .c-est{grid-area:est;text-align:right}
        .ci-table .c-lleg{grid-area:lleg}
        .ci-table .c-hora{grid-area:hora;color:#6b7280}
        .ci-table .c-bod{grid-area:bod;text-align:right}
        .ci-table .c-mat{grid-area:mat;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ci-table .c-peso{grid-area:peso}
        .ci-table .c-prov{grid-area:prov;color:#6b7280;font-size:12px}
        .ci-table .c-orden{grid-area:orden;color:#6b7280;font-size:12px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ci-table tr.ci-grp{display:block;background:none;box-shadow:none;padding:0;margin:14px 0 6px}
        .ci-table tr.ci-grp td{display:block;border-radius:8px;padding:8px 12px}
        .ci-table td.ci-empty{grid-column:1/-1}
        .ci-toast{left:16px;right:16px;bottom:16px;text-align:center}
      }
    `;
    document.head.appendChild(s);
  }

  // Para Inicio: trae los datos y los clasifica con las mismas reglas de esta sección
  async function obtenerResumen() {
    const res = await fetch(API_URL, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Respuesta inválida');
    return { ...clasificar(data.rows, data.hoy), fechaHoy: data.hoy, sync: data.sync, horaLimite: HORA_LIMITE };
  }

  // Para Packing Lists: filas de Importaciones (2026 + histórico) sin depender de que esta sección esté abierta
  async function obtenerFilas() {
    if (rows.length) return rows;
    const [res] = await Promise.all([fetch(API_URL, { cache: 'no-store' }), cargarHist()]);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Respuesta inválida');
    if (!meta.hoy) meta = { hoy: data.hoy, ahora: data.ahora, sync: data.sync };
    rows = unir(data.rows, hist ? hist.rows : []);
    return rows;
  }

  // Navega a esta sección mostrando un contenedor en "Todas las importaciones"
  function abrir(contenedor) {
    if (root && root.isConnected && root.querySelector('.ci')) {
      filtro = normCont(contenedor);
      irTab('todas', true);
      window.scrollTo(0, 0);
      return;
    }
    pendiente = normCont(contenedor);
    const nav = document.querySelector('.nav-item[data-section="cola-contenedores"]');
    if (nav) nav.click();
  }

  return { init, obtenerResumen, obtenerFilas, abrir, estilos: injectStyles };
})();
