// =====================================================
// SECCIÓN: CONTROL DE TRASLADOS (v1)
// Fuente: "Informe de Guías de Salida" de Softland (GS.xls), concepto
// "Transferencia hacia otra Bodega", todas las bodegas.
// Se guarda en Google Sheets vía /api/traslados (Apps Script TrasladosAPI.gs).
// Histórico 2025: solo Viel, sin detalle (data/traslados-2025.json).
// =====================================================

const TrasladosSection = (() => {
  const API_URL = '/api/traslados';
  const HIST_URL = 'data/traslados-2025.json';
  const LOTE = 250;          // guías por envío al guardar
  const PAGINA = 150;        // filas visibles en el listado antes de "Mostrar más"

  const BODEGAS = {
    '09': { n: 'Viel', c: '#eab308' },
    '19': { n: 'Aldunate', c: '#ec4899' },
    '08': { n: 'SF 918', c: '#16a34a' },
    '17': { n: 'Stgo Concha', c: '#ea580c' },
    '02': { n: 'San Ignacio', c: '#2563eb' }
  };
  const ORDEN_BOD = ['Viel', 'Aldunate', 'SF 918', 'Stgo Concha', 'San Ignacio'];
  const colorBod = n => (Object.values(BODEGAS).find(b => b.n === n) || { c: '#9ca3af' }).c;

  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const FERIADOS = new Set([
    '2025-01-01', '2025-04-18', '2025-05-01', '2025-05-21', '2025-06-20', '2025-07-16', '2025-08-15', '2025-09-18', '2025-09-19', '2025-10-31', '2025-12-08', '2025-12-25',
    '2026-01-01', '2026-04-03', '2026-05-01', '2026-05-21', '2026-06-29', '2026-07-16', '2026-09-18', '2026-10-12', '2026-12-08', '2026-12-25'
  ]);

  let root = null;
  let guias = [];            // guardadas (Sheets) + histórico
  let claves = new Set();    // claves guardadas en Sheets
  let tab = 'dashboard';
  let anio = null;
  let filtroOrigen = '';
  let busqueda = '';
  let visibles = PAGINA;
  let abierta = null;        // clave de la guía con detalle abierto
  let pendiente = null;      // resultado del parseo esperando confirmación
  let charts = [];
  let errorCarga = '';

  // ---------- utilidades ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const millones = v => '$' + nf(v / 1e6, 1) + ' M';
  const pad = n => String(n).padStart(2, '0');
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fCorta = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const corto = (t, n = 30) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const esMovil = () => window.matchMedia('(max-width: 700px)').matches;

  function nombreDestino(raw) {
    const u = String(raw || '').toUpperCase();
    if (u.includes('VIEL')) return 'Viel';
    if (u.includes('ALDUNATE')) return 'Aldunate';
    if (u.includes('918')) return 'SF 918';
    if (u.includes('CONCHA')) return 'Stgo Concha';
    if (u.includes('IGNACIO')) return 'San Ignacio';
    return String(raw || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) || '—';
  }

  function nombreOrigen(cod, raw) {
    if (BODEGAS[cod]) return BODEGAS[cod].n;
    const m = String(raw || '').match(/\[\s*(.+?)\s*\]/);
    return m ? nombreDestino(m[1]) : cod;
  }

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

  // =====================================================
  // PARSER del "Informe de Guías de Salida" (Crystal Reports -> .xls)
  // Se ubica por contenido, no por columna fija, para tolerar cambios menores.
  // =====================================================
  function parsearInforme(filas) {
    const txt = c => String(c ?? '').trim();
    const esFecha = s => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
    const esNum = c => typeof c === 'number' || (/^-?\d+([.,]\d+)?$/.test(txt(c)) && txt(c) !== '');
    const aNum = c => typeof c === 'number' ? c : Number(txt(c).replace(',', '.'));

    if (!filas.some(f => f.some(c => /INFORME DE GU[IÍ]AS DE SALIDA/i.test(txt(c))))) {
      throw new Error('El archivo no parece ser el "Informe de Guías de Salida" de Softland');
    }

    const salida = [];
    const indice = new Map();
    let concepto = '', bodRaw = '', bodCod = '', actual = null;
    let ignoradas = 0, periodo = { desde: '', hasta: '' };

    filas.forEach(f => {
      const celdas = f.map(txt);
      const llenas = celdas.map((c, i) => [i, c]).filter(([, c]) => c !== '');
      if (!llenas.length) return;
      const linea = llenas.map(([, c]) => c).join(' ');

      let m;
      if ((m = linea.match(/Desde\s*:\s*(\d{2}\/\d{2}\/\d{4})/))) periodo.desde = m[1];
      if ((m = linea.match(/Hasta\s*:\s*(\d{2}\/\d{2}\/\d{4})/))) periodo.hasta = m[1];
      if ((m = linea.match(/Concepto de despacho\s*:\s*(.+)$/i))) { concepto = m[1].trim(); actual = null; return; }
      if ((m = linea.match(/^Bodega\s*:\s*(\d+)\s*(.*)$/i))) { bodCod = pad(Number(m[1])); bodRaw = m[2].trim(); actual = null; return; }
      if (/Totales\s*:/.test(linea)) return;

      const c0 = celdas[0];
      // Cabecera de guía: fecha en la primera columna
      if (esFecha(c0)) {
        const resto = llenas.filter(([i]) => i > 0).map(([, c]) => c);
        const folio = resto[0] || '';
        const estado = resto.find(c => /^(Vigente|Nula|Anulada)/i.test(c)) || '';
        const destinoRaw = resto[resto.length - 1] || '';
        if (!/transferencia/i.test(concepto)) { ignoradas++; actual = null; return; }
        const [d, mo, y] = c0.split('/');
        const k = `${bodCod}|${folio}`;
        if (indice.has(k)) { actual = indice.get(k); return; } // misma guía repetida por salto de página
        actual = {
          k, fecha: `${y}-${mo}-${d}`, folio, oc: bodCod, origen: nombreOrigen(bodCod, bodRaw),
          destino: nombreDestino(destinoRaw), destinoRaw, estado, tipo: '', lineas: []
        };
        indice.set(k, actual);
        salida.push(actual);
        return;
      }

      // Línea de producto: tiene "ELECTRONICO"/"MANUAL" como tipo de emisión
      const iTipo = celdas.findIndex(c => /^(ELECTRONICO|ELECTRÓNICO|MANUAL)$/i.test(c));
      if (actual && c0 && iTipo > 0) {
        const desc = llenas.find(([i]) => i > 0 && i < iTipo);
        const despues = llenas.filter(([i]) => i > iTipo);
        const um = (despues.find(([, c]) => !esNum(c)) || [, ''])[1];
        const nums = f.filter((c, i) => i > iTipo && txt(c) !== '' && esNum(c)).map(aNum);
        actual.tipo = actual.tipo || celdas[iTipo].toUpperCase().replace('Ó', 'O');
        actual.lineas.push([c0, desc ? desc[1] : '', um, nums[0] || 0, nums[1] || 0, nums.length > 2 ? nums[nums.length - 1] : (nums[0] || 0) * (nums[1] || 0)]);
      }
    });

    salida.forEach(g => { g.valor = g.lineas.reduce((s, l) => s + l[5], 0); });
    return { guias: salida, ignoradas, periodo };
  }

  // =====================================================
  // INIT / DATOS
  // =====================================================
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `
      <div class="tr">
        <div class="tr-head">
          <div>
            <h1>🚚 Control de Traslados</h1>
            <p>Guías de traslado entre bodegas desde Softland (Informe de Guías de Salida)</p>
          </div>
          <div class="tr-head-btns">
            <button class="tr-btn tr-btn-sec" id="tr-recargar">🔄 Actualizar</button>
            <label class="tr-btn">📤 Cargar reporte Softland<input type="file" id="tr-file" accept=".xls,.xlsx" hidden></label>
          </div>
        </div>
        <div id="tr-preview"></div>
        <p class="tr-meta" id="tr-meta">Cargando…</p>
        <div class="tr-filtros">
          <label>Año <select id="tr-anio"></select></label>
          <label>Origen <select id="tr-origen"><option value="">Todas las bodegas</option></select></label>
        </div>
        <div class="tr-tabs" role="tablist">
          <button class="tr-tab" data-tab="dashboard">📊 Dashboard</button>
          <button class="tr-tab" data-tab="guias">📋 Guías</button>
        </div>
        <div id="tr-body"></div>
      </div>`;

    root.querySelector('#tr-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) leerArchivo(f); });
    root.querySelector('#tr-recargar').addEventListener('click', () => cargar());
    root.querySelector('#tr-anio').addEventListener('change', e => { anio = e.target.value; visibles = PAGINA; dibujar(); });
    root.querySelector('#tr-origen').addEventListener('change', e => { filtroOrigen = e.target.value; visibles = PAGINA; dibujar(); });
    root.querySelectorAll('.tr-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; dibujar(); }));
    root.addEventListener('input', e => { if (e.target.id === 'tr-buscar') { busqueda = e.target.value; visibles = PAGINA; renderListado(false); } });
    root.addEventListener('click', onClick);

    cargar();
  }

  let hist = null;
  async function cargarHist() {
    if (hist) return hist;
    try {
      const r = await fetch(HIST_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      hist = d.guias.map(([fecha, folio, destinoRaw]) => ({
        k: `${d.origen}|${folio}`, fecha, folio, oc: d.origen, origen: nombreOrigen(d.origen),
        destino: nombreDestino(destinoRaw), destinoRaw, estado: 'Vigente', tipo: '', lineas: null, valor: null, hist: true
      }));
    } catch (err) {
      console.error('Histórico traslados 2025:', err);
      hist = [];
    }
    return hist;
  }

  async function cargar() {
    const meta = root.querySelector('#tr-meta');
    meta.textContent = 'Cargando…';
    errorCarga = '';
    const [h, guardadas] = await Promise.all([cargarHist(), leerApi()]);
    claves = new Set(guardadas.map(g => g.k));
    const anios = new Set(guardadas.map(g => g.fecha.slice(0, 4)));
    // El histórico solo completa años que no vienen desde Softland
    guias = guardadas.concat(h.filter(g => !anios.has(g.fecha.slice(0, 4)) && !claves.has(g.k)));
    guias.sort((a, b) => b.fecha.localeCompare(a.fecha) || Number(b.folio) - Number(a.folio));
    llenarFiltros();
    dibujar();
  }

  async function leerApi() {
    try {
      const r = await fetch(API_URL, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      return d.guias.map(g => ({ ...g, destino: g.destino || nombreDestino(g.destinoRaw) }));
    } catch (err) {
      console.error(err);
      errorCarga = err.message;
      return [];
    }
  }

  function llenarFiltros() {
    const anios = [...new Set(guias.map(g => g.fecha.slice(0, 4)))].sort().reverse();
    if (!anio || !anios.includes(anio)) anio = anios[0]; // el más reciente
    root.querySelector('#tr-anio').innerHTML = anios.map(y => `<option ${y === anio ? 'selected' : ''}>${y}</option>`).join('') || '<option>—</option>';
    const origenes = ordenar([...new Set(guias.map(g => g.origen))]);
    root.querySelector('#tr-origen').innerHTML = '<option value="">Todas las bodegas</option>' +
      origenes.map(o => `<option ${o === filtroOrigen ? 'selected' : ''}>${esc(o)}</option>`).join('');
  }

  const ordenar = arr => arr.sort((a, b) => {
    const ia = ORDEN_BOD.indexOf(a), ib = ORDEN_BOD.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  // =====================================================
  // CARGA DEL REPORTE (vista previa -> confirmar -> guardar)
  // =====================================================
  async function leerArchivo(file) {
    const prev = root.querySelector('#tr-preview');
    prev.innerHTML = `<div class="tr-card tr-prev">Leyendo <b>${esc(file.name)}</b>…</div>`;
    try {
      if (!window.XLSX) throw new Error('No está cargada la librería para leer Excel');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const res = parsearInforme(filas);
      if (!res.guias.length) throw new Error('No se encontraron guías de traslado en el archivo');
      const nuevas = res.guias.filter(g => !claves.has(g.k));
      pendiente = { archivo: file.name, ...res, nuevas };
      mostrarPreview();
    } catch (err) {
      console.error(err);
      pendiente = null;
      prev.innerHTML = `<div class="tr-card tr-prev tr-prev-err">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function mostrarPreview() {
    const p = pendiente, prev = root.querySelector('#tr-preview');
    const fechas = p.guias.map(g => g.fecha).sort();
    const porOrigen = {};
    p.guias.forEach(g => { porOrigen[g.origen] = (porOrigen[g.origen] || 0) + 1; });
    const nLineas = p.nuevas.reduce((s, g) => s + g.lineas.length, 0);
    const ej = p.nuevas[0] || p.guias[0];
    prev.innerHTML = `<div class="tr-card tr-prev">
      <h3>Vista previa — ${esc(p.archivo)}</h3>
      <div class="tr-prev-grid">
        <div><span>Período del reporte</span><b>${esc(p.periodo.desde || fCorta(fechas[0]))} → ${esc(p.periodo.hasta || fCorta(fechas[fechas.length - 1]))}</b></div>
        <div><span>Guías en el archivo</span><b>${nf(p.guias.length)}</b></div>
        <div><span>Nuevas a guardar</span><b class="tr-ok">${nf(p.nuevas.length)}</b></div>
        <div><span>Ya cargadas (se omiten)</span><b>${nf(p.guias.length - p.nuevas.length)}</b></div>
      </div>
      <p class="tr-sub">Por bodega de origen: ${ordenar(Object.keys(porOrigen)).map(o => `${esc(o)} ${nf(porOrigen[o])}`).join(' · ')}
        · ${nf(nLineas)} líneas nuevas${p.ignoradas ? ` · ${nf(p.ignoradas)} guías de otros conceptos ignoradas` : ''}</p>
      ${ej ? `<p class="tr-sub">Ejemplo: guía <b>${esc(ej.folio)}</b> del ${fCorta(ej.fecha)}, ${esc(ej.origen)} → ${esc(ej.destino)}, ${ej.lineas.length} línea(s), ${millones(ej.valor)}${ej.lineas[0] ? ` — 1ª línea: ${esc(ej.lineas[0][0])} ${esc(corto(ej.lineas[0][1], 40))} · ${nf(ej.lineas[0][3])} ${esc(ej.lineas[0][2])}` : ''}</p>` : ''}
      <div class="tr-prev-btns">
        <button class="tr-btn" data-act="confirmar" ${p.nuevas.length ? '' : 'disabled'}>Guardar ${nf(p.nuevas.length)} guías</button>
        <button class="tr-btn tr-btn-sec" data-act="cancelar">Cancelar</button>
      </div>
      <p class="tr-sub" id="tr-progreso"></p>
    </div>`;
  }

  async function guardar() {
    const p = pendiente; if (!p) return;
    const btns = root.querySelectorAll('.tr-prev-btns button');
    btns.forEach(b => b.disabled = true);
    const prog = root.querySelector('#tr-progreso');
    let guardadas = 0;
    try {
      for (let i = 0; i < p.nuevas.length; i += LOTE) {
        const lote = p.nuevas.slice(i, i + LOTE).map(({ valor, ...g }) => g);
        prog.textContent = `Guardando ${nf(Math.min(i + LOTE, p.nuevas.length))} de ${nf(p.nuevas.length)}…`;
        const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', guias: lote }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error al guardar');
        guardadas += d.nuevas;
      }
      pendiente = null;
      anio = null; // volver al año más reciente después de cargar
      root.querySelector('#tr-preview').innerHTML = `<div class="tr-card tr-prev tr-prev-ok">✅ ${nf(guardadas)} guías guardadas.</div>`;
      await cargar();
    } catch (err) {
      console.error(err);
      prog.innerHTML = `<span class="tr-err">⚠️ ${esc(err.message)}. Se guardaron ${nf(guardadas)} antes del error; puedes volver a subir el archivo y solo se agregarán las que falten.</span>`;
      btns.forEach(b => b.disabled = false);
    }
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'confirmar') guardar();
      if (a === 'cancelar') { pendiente = null; root.querySelector('#tr-preview').innerHTML = ''; }
      if (a === 'mas') { visibles += PAGINA; renderListado(false); }
      return;
    }
    const fila = e.target.closest('tr[data-k]');
    if (fila) { abierta = abierta === fila.dataset.k ? null : fila.dataset.k; renderListado(false); }
  }

  // =====================================================
  // RENDER
  // =====================================================
  function dibujar() {
    if (!root) return;
    const n = guias.filter(g => !g.hist).length;
    root.querySelector('#tr-meta').innerHTML = errorCarga
      ? `<span class="tr-err">No se pudieron leer las guías guardadas: ${esc(errorCarga)}</span>`
      : `${nf(n)} guías guardadas${guias.length > n ? ` · ${nf(guias.length - n)} del histórico 2025 (Viel)` : ''}`;
    root.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    charts.forEach(c => c.destroy()); charts = [];
    const body = root.querySelector('#tr-body');
    if (!guias.length) {
      body.innerHTML = `<div class="tr-card tr-vacio">Todavía no hay guías. Usa <b>📤 Cargar reporte Softland</b> y sube el GS.xls.</div>`;
      return;
    }
    if (tab === 'dashboard') renderDashboard(body);
    else {
      body.innerHTML = `<input id="tr-buscar" class="tr-search" type="search" placeholder="Buscar folio, bodega, código o producto" value="${esc(busqueda)}">
        <div id="tr-lista"></div>`;
      renderListado(true);
    }
  }

  const delAnio = () => guias.filter(g => g.fecha.startsWith(anio) && (!filtroOrigen || g.origen === filtroOrigen));

  // ---------- Listado ----------
  function renderListado() {
    const wrap = root.querySelector('#tr-lista'); if (!wrap) return;
    const q = busqueda.trim().toUpperCase();
    const lista = delAnio().filter(g => !q || [g.folio, g.origen, g.destino, ...(g.lineas || []).map(l => l[0] + ' ' + l[1])].join(' ').toUpperCase().includes(q));
    const vista = lista.slice(0, visibles);
    const filas = vista.map(g => {
      const det = abierta === g.k ? `<tr class="tr-det"><td colspan="7">${detalle(g)}</td></tr>` : '';
      return `<tr data-k="${esc(g.k)}" class="${abierta === g.k ? 'tr-open' : ''}">
        <td class="c-fecha">${fCorta(g.fecha)}</td>
        <td class="c-folio"><b>${esc(g.folio)}</b></td>
        <td class="c-ori">${pill(g.origen)}</td>
        <td class="c-flecha">→</td>
        <td class="c-des">${pill(g.destino)}</td>
        <td class="c-lin num">${g.lineas ? nf(g.lineas.length) + (g.lineas.length === 1 ? ' línea' : ' líneas') : '—'}</td>
        <td class="c-val num">${g.valor != null ? '$' + nf(g.valor) : '—'}</td></tr>${det}`;
    }).join('');
    wrap.innerHTML = `<p class="tr-sub">${nf(lista.length)} guías${q ? ' que coinciden' : ''} · toca una guía para ver sus productos</p>
      <div class="tr-table-wrap"><table class="tr-table">
        <thead><tr><th>Fecha</th><th>Folio</th><th>Origen</th><th></th><th>Destino</th><th class="num">Líneas</th><th class="num">Valor</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="7" class="tr-vacio">Sin guías para este filtro</td></tr>'}</tbody></table></div>
      ${lista.length > visibles ? `<button class="tr-btn tr-btn-sec tr-mas" data-act="mas">Mostrar ${nf(Math.min(PAGINA, lista.length - visibles))} más</button>` : ''}`;
  }

  const pill = b => `<span class="tr-pill" style="--c:${colorBod(b)}">${esc(b)}</span>`;

  function detalle(g) {
    if (!g.lineas) return '<p class="tr-sub">Guía del histórico 2025: sin detalle de productos.</p>';
    return `<table class="tr-lin"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th>U/M</th><th class="num">Total</th></tr></thead>
      <tbody>${g.lineas.map(l => `<tr><td>${esc(l[0])}</td><td>${esc(l[1])}</td><td class="num">${nf(l[3], l[3] % 1 ? 2 : 0)}</td><td>${esc(l[2])}</td><td class="num">$${nf(l[5])}</td></tr>`).join('')}</tbody></table>
      <p class="tr-sub">${esc(g.tipo || '')} · Destino en Softland: ${esc(g.destinoRaw)}</p>`;
  }

  // ---------- Dashboard ----------
  function calcular() {
    const Y = Number(anio);
    const L = delAnio();
    const hoy = hoyIso();
    const esActual = anio === hoy.slice(0, 4);
    const ultimaFecha = L.reduce((m, g) => g.fecha > m ? g.fecha : m, '');
    const hasta = esActual ? (ultimaFecha > hoy ? ultimaFecha : hoy) : null;
    const mesesTrans = esActual ? Number(hasta.slice(5, 7)) : 12;
    const conDetalle = L.filter(g => g.lineas);
    const dimension = filtroOrigen ? 'destino' : 'origen';      // filas de la matriz

    const porMes = Array(12).fill(0), valorMes = Array(12).fill(0);
    const matriz = {}, rutas = {}, prod = {}, porDia = Array(7).fill(0);
    L.forEach(g => {
      const m = Number(g.fecha.slice(5, 7)) - 1;
      porMes[m]++; valorMes[m] += g.valor || 0;
      const key = g[dimension];
      (matriz[key] = matriz[key] || Array(12).fill(0))[m]++;
      const rk = g.origen + '→' + g.destino;
      const r = rutas[rk] = rutas[rk] || { o: g.origen, d: g.destino, n: 0, v: 0, l: 0 };
      r.n++; r.v += g.valor || 0; r.l += g.lineas ? g.lineas.length : 0;
      porDia[new Date(g.fecha + 'T12:00:00').getDay()]++;
      (g.lineas || []).forEach(l => {
        const p = prod[l[0]] = prod[l[0]] || { c: l[0], d: l[1], n: 0, v: 0, q: 0, um: l[2] };
        p.n++; p.v += l[5]; p.q += l[3];
      });
    });

    const dl = Array.from({ length: 12 }, (_, m) => diasLaborales(Y, m));
    const dlTrans = Array.from({ length: 12 }, (_, m) => diasLaborales(Y, m, hasta)).reduce((a, b) => a + b, 0);

    // Comparación con el año anterior, mismo período y mismo filtro
    const prevY = String(Y - 1);
    const prev = guias.filter(g => g.fecha.startsWith(prevY) && (!filtroOrigen || g.origen === filtroOrigen));
    const corte = hasta ? prevY + hasta.slice(4) : null;
    const prevMismo = corte ? prev.filter(g => g.fecha <= corte).length : prev.length;
    const prevMes = Array(12).fill(0); prev.forEach(g => prevMes[Number(g.fecha.slice(5, 7)) - 1]++);
    // Si el año anterior solo tiene histórico de Viel, la comparación vale solo para Viel
    const prevSoloViel = prev.length && prev.every(g => g.hist);
    const comparable = prev.length && (!prevSoloViel || filtroOrigen === 'Viel');

    return {
      L, total: L.length, nDet: conDetalle.length, valor: conDetalle.reduce((s, g) => s + g.valor, 0),
      lineas: conDetalle.reduce((s, g) => s + g.lineas.length, 0), porMes, valorMes, dl, dlTrans, mesesTrans,
      matriz, dimension, rutas: Object.values(rutas).sort((a, b) => b.n - a.n),
      prod: Object.values(prod), porDia, prevY, prevMismo, prevMes, comparable, hasta, prevExiste: prev.length > 0
    };
  }

  function renderDashboard(body) {
    const D = calcular();
    if (!D.total) { body.innerHTML = '<div class="tr-card tr-vacio">Sin guías para este filtro</div>'; return; }
    const tot = a => a.reduce((x, y) => x + y, 0);
    const kpi = (l, v, s) => `<div class="tr-kpi"><span>${l}</span><strong>${v}</strong>${s ? `<small>${s}</small>` : ''}</div>`;
    const variacion = D.comparable && D.prevMismo ? (D.total / D.prevMismo - 1) * 100 : null;
    const filasM = ordenar(Object.keys(D.matriz));
    const sinDetalle = D.total - D.nDet;

    body.innerHTML = `
      ${sinDetalle ? `<p class="tr-note">ℹ️ ${nf(sinDetalle)} guías de ${anio} vienen del histórico (solo Viel, sin productos ni valor).</p>` : ''}
      <div class="tr-kpis">
        ${kpi('Guías', nf(D.total), filtroOrigen ? 'emitidas por ' + esc(filtroOrigen) : 'todas las bodegas')}
        ${kpi('Promedio diario', nf(D.total / (D.dlTrans || 1), 2), `${D.dlTrans} días laborales${D.hasta ? ' a la fecha' : ''}`)}
        ${kpi('Promedio mensual', nf(D.total / D.mesesTrans, 1), `${D.mesesTrans} meses`)}
        ${kpi('Valor trasladado', D.nDet ? millones(D.valor) : '—', D.nDet ? `${nf(D.lineas)} líneas de producto` : 'sin detalle')}
        ${kpi('Líneas por guía', D.nDet ? nf(D.lineas / D.nDet, 1) : '—', 'promedio')}
        ${kpi('vs ' + D.prevY, variacion == null ? '—' : (variacion > 0 ? '+' : '') + nf(variacion, 0) + '%',
          variacion == null ? (!D.prevExiste ? 'sin datos de ' + D.prevY : filtroOrigen ? 'sin datos comparables' : 'elige origen Viel para comparar') : `${nf(D.prevMismo)} guías mismo período`)}
      </div>

      <div class="tr-card tr-mt">
        <h3>Guías por ${D.dimension === 'origen' ? 'bodega de origen' : 'destino'} y mes — ${anio}${filtroOrigen ? ' · desde ' + esc(filtroOrigen) : ''}</h3>
        <div class="tr-table-wrap tr-flat"><table class="tr-mtx">
          <thead><tr><th>${D.dimension === 'origen' ? 'Origen' : 'Destino'}</th>${MESES.map(m => `<th>${m}</th>`).join('')}<th>Total</th><th>%</th></tr></thead>
          <tbody>
            ${filasM.map(k => `<tr><td><span class="tr-sw" style="background:${colorBod(k)}"></span>${esc(k)}</td>${D.matriz[k].map(v => `<td>${v || ''}</td>`).join('')}<td class="tot">${tot(D.matriz[k])}</td><td class="tot">${nf(tot(D.matriz[k]) / D.total * 100, 1)}%</td></tr>`).join('')}
            <tr class="sum"><td>Total guías</td>${D.porMes.map(v => `<td>${v || ''}</td>`).join('')}<td>${D.total}</td><td>100%</td></tr>
            <tr><td>Días laborales</td>${D.dl.map(v => `<td>${v}</td>`).join('')}<td class="tot">${tot(D.dl)}</td><td></td></tr>
            <tr><td>Guías diarias</td>${D.porMes.map((v, m) => `<td>${v ? nf(v / D.dl[m], 2) : ''}</td>`).join('')}<td class="tot">${nf(D.total / (D.dlTrans || 1), 2)}</td><td></td></tr>
            ${D.nDet ? `<tr><td>Valor ($ M)</td>${D.valorMes.map(v => `<td>${v ? nf(v / 1e6, 1) : ''}</td>`).join('')}<td class="tot">${nf(D.valor / 1e6, 1)}</td><td></td></tr>` : ''}
          </tbody></table></div>
      </div>

      <div class="tr-grid2">
        <div class="tr-card"><h3>Guías por mes</h3><p class="tr-sub">Por ${D.dimension === 'origen' ? 'bodega de origen' : 'destino'}</p><div class="tr-chart"><canvas id="trc-mes"></canvas></div></div>
        <div class="tr-card"><h3>${anio} vs ${D.prevY}</h3><p class="tr-sub">${D.comparable ? 'Guías por mes, mismo filtro' : 'Sin datos comparables del año anterior para este filtro'}</p><div class="tr-chart"><canvas id="trc-comp"></canvas></div></div>

        <div class="tr-card"><h3>Rutas</h3>
          <div class="tr-table-wrap tr-flat tr-scroll"><table class="tr-mtx">
            <thead><tr><th>Ruta</th><th>Guías</th><th>%</th><th>Valor ($ M)</th><th>Líneas/guía</th></tr></thead>
            <tbody>${D.rutas.map(r => `<tr><td>${esc(r.o)} → ${esc(r.d)}</td><td>${nf(r.n)}</td><td>${nf(r.n / D.total * 100, 1)}%</td><td>${r.v ? nf(r.v / 1e6, 1) : '—'}</td><td>${r.l ? nf(r.l / r.n, 1) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
        ${D.nDet ? `<div class="tr-card"><h3>Valor trasladado por mes</h3><p class="tr-sub">Millones de pesos (precio del informe)</p><div class="tr-chart"><canvas id="trc-valor"></canvas></div></div>` : `<div class="tr-card"><h3>Guías por día de la semana</h3><div class="tr-chart"><canvas id="trc-dia"></canvas></div></div>`}

        ${D.nDet ? `<div class="tr-card"><h3>Productos más trasladados</h3><p class="tr-sub">Top 12 por cantidad de guías en que aparecen</p><div class="tr-chart tr-chart-alta"><canvas id="trc-prodn"></canvas></div></div>
        <div class="tr-card"><h3>Productos por valor trasladado</h3><p class="tr-sub">Top 12, millones de pesos</p><div class="tr-chart tr-chart-alta"><canvas id="trc-prodv"></canvas></div></div>

        <div class="tr-card"><h3>Guías por día de la semana</h3><div class="tr-chart"><canvas id="trc-dia"></canvas></div></div>` : ''}
        <div class="tr-card"><h3>Distribución por ${D.dimension === 'origen' ? 'origen' : 'destino'}</h3><div class="tr-chart"><canvas id="trc-dona"></canvas></div></div>
      </div>`;

    cargarChart().then(() => { if (tab === 'dashboard' && document.body.contains(body)) graficos(D); })
      .catch(err => body.insertAdjacentHTML('afterbegin', `<p class="tr-err">${esc(err.message)}</p>`));
  }

  let chartPromise = null;
  function cargarChart() {
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

  function graficos(D) {
    const mk = (id, cfg) => { const el = root.querySelector('#' + id); if (el) charts.push(new Chart(el, cfg)); };
    // Funciones (no objetos compartidos): Chart.js escribe "scales" dentro del objeto de opciones que recibe
    const baseF = () => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } });
    const sinLeyendaF = () => ({ ...baseF(), plugins: { legend: { display: false } } });
    const filasM = ordenar(Object.keys(D.matriz));

    mk('trc-mes', {
      type: 'bar',
      data: { labels: MESES, datasets: filasM.map(k => ({ label: k, data: D.matriz[k], backgroundColor: colorBod(k) })) },
      options: { ...baseF(), scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    mk('trc-comp', {
      type: 'line',
      data: {
        labels: MESES, datasets: [
          { label: anio, data: D.porMes.map((v, m) => m < D.mesesTrans ? v : null), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: .3 },
          ...(D.comparable ? [{ label: D.prevY, data: D.prevMes, borderColor: '#9ca3af', backgroundColor: '#9ca3af', borderDash: [5, 4], tension: .3 }] : [])
        ]
      },
      options: { ...baseF(), scales: { y: { beginAtZero: true } } }
    });

    mk('trc-valor', { type: 'bar', data: { labels: MESES, datasets: [{ label: '$ M', data: D.valorMes.map(v => v ? +(v / 1e6).toFixed(1) : null), backgroundColor: '#0d9488' }] }, options: sinLeyendaF() });

    const tooltipProd = lista => ({ callbacks: { title: it => lista[it[0].dataIndex].c + ' · ' + lista[it[0].dataIndex].d } });
    const pn = [...D.prod].sort((a, b) => b.n - a.n).slice(0, 12);
    mk('trc-prodn', { type: 'bar', data: { labels: pn.map(p => corto(p.d, 32)), datasets: [{ label: 'Guías', data: pn.map(p => p.n), backgroundColor: '#0891b2' }] }, options: { ...sinLeyendaF(), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: tooltipProd(pn) } } });
    const pv = [...D.prod].sort((a, b) => b.v - a.v).slice(0, 12);
    mk('trc-prodv', { type: 'bar', data: { labels: pv.map(p => corto(p.d, 32)), datasets: [{ label: '$ M', data: pv.map(p => +(p.v / 1e6).toFixed(1)), backgroundColor: '#ea580c' }] }, options: { ...sinLeyendaF(), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: tooltipProd(pv) } } });

    const ord = [1, 2, 3, 4, 5, 6, 0];
    mk('trc-dia', { type: 'bar', data: { labels: ord.map(d => DIAS_SEM[d]), datasets: [{ label: 'Guías', data: ord.map(d => D.porDia[d]), backgroundColor: '#4f46e5' }] }, options: sinLeyendaF() });

    const tots = filasM.map(k => D.matriz[k].reduce((a, b) => a + b, 0));
    mk('trc-dona', {
      type: 'doughnut',
      data: { labels: filasM, datasets: [{ data: tots, backgroundColor: filasM.map(colorBod), borderWidth: 1 }] },
      options: { ...baseF(), cutout: '55%', plugins: { legend: { position: esMovil() ? 'bottom' : 'right', labels: { boxWidth: 12, generateLabels: ch => filasM.map((l, i) => ({ text: `${l} (${nf(tots[i] / D.total * 100, 1)}%)`, fillStyle: colorBod(l), strokeStyle: colorBod(l), index: i })) } } } }
    });
  }

  // =====================================================
  // ESTILOS
  // =====================================================
  function injectStyles() {
    if (document.getElementById('tr-styles')) return;
    const s = document.createElement('style');
    s.id = 'tr-styles';
    s.textContent = `
      .tr{padding:24px;color:#1f2937}
      .tr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
      .tr-head h1{margin:0;font-size:22px}
      .tr-head p{margin:4px 0 0;color:#6b7280;font-size:13px}
      .tr-head-btns{display:flex;gap:8px;flex-wrap:wrap}
      .tr-btn{display:inline-flex;align-items:center;gap:6px;background:#1e7b34;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap}
      .tr-btn:hover{background:#17652a}
      .tr-btn:disabled{opacity:.5;cursor:default}
      .tr-btn-sec{background:#fff;color:#374151;border:1px solid #d1d5db}
      .tr-btn-sec:hover{background:#f3f4f6}
      .tr-meta{font-size:12px;color:#6b7280;margin:0 0 12px}
      .tr-err{color:#b91c1c}
      .tr-filtros{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:14px}
      .tr-filtros select{margin-left:6px;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;background:#fff}
      .tr-tabs{display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:16px;overflow-x:auto}
      .tr-tab{background:none;border:0;border-bottom:3px solid transparent;padding:10px 18px;font-weight:600;color:#6b7280;cursor:pointer;white-space:nowrap}
      .tr-tab.active{color:#4f5bd5;border-bottom-color:#667eea}
      .tr-card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08);min-width:0}
      .tr-card h3{margin:0 0 10px;font-size:15px}
      .tr-sub{margin:6px 0;font-size:12px;color:#6b7280}
      .tr-card .tr-sub:first-of-type{margin-top:-4px}
      .tr-mt{margin-top:16px}
      .tr-vacio{color:#6b7280;text-align:center;padding:30px}
      .tr-note{background:#eff6ff;color:#1e40af;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 14px}
      .tr-prev{margin-bottom:14px;border-left:4px solid #667eea}
      .tr-prev-err{border-left-color:#dc2626;color:#991b1b}
      .tr-prev-ok{border-left-color:#16a34a;color:#166534}
      .tr-prev-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:6px}
      .tr-prev-grid div{background:#f5f7fa;border-radius:8px;padding:10px 12px}
      .tr-prev-grid span{display:block;font-size:12px;color:#6b7280}
      .tr-prev-grid b{display:block;font-size:18px;margin-top:2px}
      .tr-ok{color:#15803d}
      .tr-prev-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      .tr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;background:#f5f7fa;padding:12px;border-radius:10px}
      .tr-kpi{background:#fff;border-left:4px solid #667eea;border-radius:8px;padding:14px}
      .tr-kpi span{display:block;font-size:12px;color:#6b7280}
      .tr-kpi strong{display:block;font-size:24px;margin-top:4px}
      .tr-kpi small{display:block;font-size:11px;color:#9ca3af;margin-top:4px}
      .tr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
      .tr-chart{position:relative;height:280px}
      .tr-chart-alta{height:340px}
      .tr-table-wrap{overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .tr-flat{box-shadow:none}
      .tr-scroll{max-height:300px;overflow:auto}
      .tr-mtx{width:100%;border-collapse:collapse;font-size:13px}
      .tr-mtx th,.tr-mtx td{padding:7px 8px;border:1px solid #eef0f3;text-align:center;white-space:nowrap}
      .tr-mtx th{background:#f5f7fa;position:sticky;top:0}
      .tr-mtx td:first-child,.tr-mtx th:first-child{text-align:left;font-weight:600}
      .tr-mtx .tot{font-weight:700;background:#f5f7fa}
      .tr-mtx tr.sum td{font-weight:700;background:#eef2ff}
      .tr-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
      .tr-search{width:100%;max-width:480px;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:6px;font-size:14px}
      .tr-table{width:100%;border-collapse:collapse;font-size:13px}
      .tr-table th{background:#f5f7fa;text-align:left;padding:10px;white-space:nowrap}
      .tr-table td{padding:9px 10px;border-top:1px solid #f0f1f4;white-space:nowrap}
      .tr-table tbody tr[data-k]{cursor:pointer}
      .tr-table tbody tr[data-k]:hover td{background:#f9fafb}
      .tr-table tr.tr-open td{background:#eef2ff}
      .tr-table .num,.tr-lin .num{text-align:right}
      .tr-table .c-flecha{color:#9ca3af;padding:9px 0}
      .tr-pill{display:inline-block;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:600;color:#1f2937;background:color-mix(in srgb,var(--c) 18%,#fff);border:1px solid color-mix(in srgb,var(--c) 45%,#fff)}
      .tr-det td{background:#f9fafb;padding:10px 14px;white-space:normal}
      .tr-lin{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:6px}
      .tr-lin th{text-align:left;padding:6px 8px;background:#eef0f3}
      .tr-lin td{padding:6px 8px;border-top:1px solid #f0f1f4}
      .tr-mas{margin:12px auto 0;display:block}
      @media (max-width:900px){.tr-grid2{grid-template-columns:1fr}.tr-head{flex-direction:column}.tr-prev-grid{grid-template-columns:1fr 1fr}}
      @media (max-width:700px){
        .tr{padding:0}
        .tr-head h1{font-size:19px}
        .tr-head-btns{width:100%}
        .tr-head-btns .tr-btn{flex:1;justify-content:center;padding:12px}
        .tr-filtros{gap:8px}
        .tr-filtros label{flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6b7280}
        .tr-filtros select{margin:0;font-size:16px}
        .tr-kpis{grid-template-columns:1fr 1fr;gap:8px;padding:8px}
        .tr-kpi{padding:10px 12px}
        .tr-kpi strong{font-size:20px}
        .tr-card{padding:14px}
        .tr-chart{height:250px}
        .tr-chart-alta{height:320px}
        .tr-search{max-width:none;font-size:16px}
        #tr-lista .tr-table-wrap{background:none;box-shadow:none;overflow:visible}
        .tr-table>thead{display:none}
        .tr-table,.tr-table>tbody{display:block}
        .tr-table tr[data-k]{display:grid;grid-template-columns:auto auto 1fr;grid-template-areas:"folio folio fecha" "ori flecha des" "lin lin val";gap:4px 8px;align-items:center;background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
        .tr-table tr[data-k] td{border:0;padding:0;background:none!important;font-size:13px}
        .tr-table tr.tr-open{outline:2px solid #667eea}
        .tr-table .c-folio{grid-area:folio;font-size:15px}
        .tr-table .c-fecha{grid-area:fecha;text-align:right;color:#6b7280}
        .tr-table .c-ori{grid-area:ori}.tr-table .c-flecha{grid-area:flecha;padding:0}.tr-table .c-des{grid-area:des}
        .tr-table .c-lin{grid-area:lin;text-align:left;color:#6b7280}
        .tr-table .c-val{grid-area:val;font-weight:600}
        .tr-table tr.tr-det{display:block;margin:-4px 0 10px}
        .tr-table tr.tr-det td{display:block;border-radius:0 0 10px 10px;overflow-x:auto}
        .tr-lin thead{display:none}
        .tr-lin,.tr-lin tbody{display:block}
        .tr-lin tr{display:grid;grid-template-columns:auto auto 1fr;grid-template-areas:"cod cod tot" "prod prod prod" "cant um um";gap:2px 6px;padding:8px 10px;border-top:1px solid #eef0f3}
        .tr-lin td{border:0;padding:0}
        .tr-lin td:nth-child(1){grid-area:cod;color:#6b7280}
        .tr-lin td:nth-child(2){grid-area:prod}
        .tr-lin td:nth-child(3){grid-area:cant;text-align:left;font-weight:600}
        .tr-lin td:nth-child(4){grid-area:um;color:#6b7280}
        .tr-lin td:nth-child(5){grid-area:tot;font-weight:600}
        .tr-det td{padding:0 4px!important}
        .tr-prev-grid b{font-size:16px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render, _parsearInforme: parsearInforme };
})();
