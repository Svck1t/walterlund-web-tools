// =====================================================
// SECCIÓN: PRODUCCIÓN / KAO CHIMIGRAF (v1)
// Reemplaza los Excel "FORMULAS KAO CHIMIGRAF" y "Costeo Kao Engatel".
//  - Maestro único de materias primas (código, origen, costo U$/kg)
//  - Colores con su fórmula (%), cliente, precio de venta y estado
//  - Calculadora: kg a producir → cantidades, descontar de stock (+merma), costo y margen
//  - Producciones: desde el "Informe de Guías de Recepción" de Softland
//    (concepto Producto Terminado de Producción a Bodega), solo códigos con fórmula
// Datos: Google Sheets vía /api/kao (gas/ProduccionKaoAPI.gs).
// Si la API aún no está configurada, carga data/kao-seed.json en modo vista previa.
// =====================================================

const ProduccionKaoSection = (() => {
  const API_URL = '/api/kao';
  const SEED_URL = 'data/kao-seed.json';
  const PAGINA = 150;
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const ENVASES_STD = ['TAMBOR 200', 'BIDON 5 LITROS CON TAPA', 'IBC', 'BALDES CON TAPA'];

  let root = null;
  let D = { config: {}, materias: [], colores: [], producciones: [] };
  let modo = 'api';          // 'api' | 'local' (vista previa sin guardar)
  let errorCarga = '';
  let tab = 'resumen';
  let anio = '';
  let fCliente = '';
  let busqueda = '';
  let fEstado = 'activos';
  let visibles = PAGINA;
  let colorAbierto = null;   // id del color en la ficha
  let editando = false;      // ficha en modo edición
  let borrador = null;       // copia del color mientras se edita
  let kgCalc = null;         // kg a producir en la calculadora
  let envCalc = {};          // mp_id -> unidades de envase en la calculadora
  let pendiente = null;      // importación esperando confirmación
  let charts = [];

  // ---------- utilidades ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const clp = n => '$' + nf(n);
  const usd = (n, d = 2) => 'US$ ' + nf(n, d);
  const pct = (n, d = 1) => nf(n * 100, d) + '%';
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  // acepta 1.234,5 · 1234,5 · 1234.5 · 1.000 (miles)
  const numIn = v => {
    let s = String(v ?? '').trim().replace(/\s|\$|%/g, '');
    if (s === '') return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s); return isFinite(n) ? n : null;
  };
  const cfg = () => ({ tipoCambio: Number(D.config.tipoCambio) || 950, merma: D.config.merma === undefined || D.config.merma === '' ? 0.03 : Number(D.config.merma), inactivoDesde: String(D.config.inactivoDesde || '2025-01-01').slice(0, 10) });

  // ---------- índices derivados ----------
  let MP = new Map();        // id -> materia
  let STATS = new Map();     // codigo -> { n, kg, total, ultima, clientes:Set }
  function indexar() {
    MP = new Map(D.materias.map(m => [m.id, m]));
    STATS = new Map();
    D.producciones.forEach(p => {
      const s = STATS.get(p.codigo) || { n: 0, kg: 0, total: 0, ultima: '', porAnio: {} };
      s.n++; s.kg += num(p.kg); s.total += num(p.total);
      if (p.fecha > s.ultima) s.ultima = p.fecha;
      const y = String(p.fecha).slice(0, 4); s.porAnio[y] = (s.porAnio[y] || 0) + num(p.kg);
      STATS.set(p.codigo, s);
    });
  }
  const colorDe = codigo => D.colores.find(c => c.codigo && c.codigo === codigo);
  const nombreProd = p => { const c = colorDe(p.codigo); return c ? c.nombre : (norm(p.descripcion) === 'ZZ' ? '(sin nombre)' : p.descripcion); };
  const clienteProd = p => p.cliente || (colorDe(p.codigo) || {}).cliente || '';
  function activo(c) {
    if (c.estado === 'activo') return true;
    if (c.estado === 'inactivo') return false;
    const s = c.codigo && STATS.get(c.codigo);
    return !!(s && s.ultima >= cfg().inactivoDesde);
  }
  const clientes = () => [...new Set([...D.colores.map(c => c.cliente), ...D.producciones.map(p => p.cliente)].filter(Boolean))].sort();
  const anios = () => [...new Set(D.producciones.map(p => String(p.fecha).slice(0, 4)))].sort().reverse();

  // ---------- datos ----------
  async function cargar() {
    errorCarga = '';
    try {
      const r = await fetch(API_URL, { cache: 'no-store' });
      const d = await r.json().catch(() => ({ ok: false, sinConfigurar: r.status === 404, error: 'Respuesta no válida (' + r.status + ')' }));
      if (d.sinConfigurar || r.status === 404) throw Object.assign(new Error(d.error || 'API sin configurar'), { local: true });
      if (!d.ok) throw new Error(d.error || 'Error al leer la base');
      modo = 'api';
      D = { config: d.config || {}, materias: d.materias || [], colores: d.colores || [], producciones: d.producciones || [] };
    } catch (err) {
      if (!err.local) errorCarga = err.message;
      modo = 'local';
      const s = await (await fetch(SEED_URL, { cache: 'no-store' })).json();
      D = { config: s.config, materias: s.materias, colores: s.colores, producciones: s.producciones.map((p, i) => ({ id: 'L' + i, ...p })) };
    }
    indexar();
    if (!anio || !anios().includes(anio)) anio = anios()[0] || '';
  }

  async function api(action, payload) {
    if (modo !== 'api') return { ok: true, local: true };
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Error al guardar');
    return d;
  }

  async function cargarSeedEnBase() {
    if (!confirm('Esto carga en la Google Sheet el maestro, las fórmulas de los dos Excel y las producciones 2026. ¿Continuar?')) return;
    aviso('Cargando datos iniciales…');
    try {
      const s = await (await fetch(SEED_URL, { cache: 'no-store' })).json();
      await api('seed', { data: s });
      await cargar(); dibujar(); aviso('✅ Datos iniciales cargados.', 'ok');
    } catch (err) { aviso('⚠️ ' + err.message, 'err'); }
  }

  function aviso(txt, tipo = '') {
    const el = root && root.querySelector('#pk-aviso');
    if (!el) return;
    el.className = 'pk-aviso ' + tipo; el.innerHTML = txt; el.hidden = !txt;
    if (tipo === 'ok') setTimeout(() => { if (el.innerHTML === txt) el.hidden = true; }, 4000);
  }

  // =====================================================
  // CÁLCULO DE UNA FÓRMULA
  // =====================================================
  function calcular(color, kg, envases) {
    const { merma, tipoCambio } = cfg();
    const filas = (color.formula || []).map(f => {
      const m = MP.get(f.mp) || { descripcion: '(materia prima no encontrada)', codigo: '', origen: '', usd: 0 };
      const teo = kg * f.pct;
      const u = Number(m.usd) || 0;
      return { mp: f.mp, m, pct: f.pct, teo, usd: u, total: teo * u, descontar: Math.round(teo * (1 + merma) * 10) / 10 };
    });
    const sumPct = filas.reduce((a, f) => a + f.pct, 0);
    const costoMP = filas.reduce((a, f) => a + f.total, 0);
    const env = Object.entries(envases || {}).filter(([, n]) => n > 0).map(([id, n]) => {
      const m = MP.get(id) || { descripcion: id, usd: 0 };
      return { mp: id, m, n, usd: Number(m.usd) || 0, total: n * (Number(m.usd) || 0) };
    });
    const costoEnv = env.reduce((a, e) => a + e.total, 0);
    const costoMerma = costoMP * merma;
    const costoTotal = costoMP + costoMerma + costoEnv;
    const costoKg = kg > 0 ? costoTotal / kg : 0;
    const precio = color.precio === null || color.precio === undefined || color.precio === '' ? null : Number(color.precio);
    return { filas, sumPct, costoMP, costoMerma, env, costoEnv, costoTotal, costoKg, costoKgClp: costoKg * tipoCambio, precio, margen: precio && costoKg ? precio / costoKg - 1 : null };
  }

  // =====================================================
  // PARSER del "Informe de Guías de Recepción" (Softland → .xls)
  // =====================================================
  function parsearInforme(filas) {
    const txt = c => String(c ?? '').trim();
    if (!filas.some(f => f.some(c => /GU[IÍ]AS DE RECEPCI[OÓ]N/i.test(txt(c))))) throw new Error('El archivo no parece ser el "Informe de Guías de Recepción" de Softland');
    const out = []; let concepto = '', fecha = '', folio = '';
    filas.forEach(f => {
      const c1 = txt(f[1]);
      if (/^Concepto/i.test(c1)) { concepto = c1.split(':').slice(1).join(':').trim(); return; }
      if (/^Bodega/i.test(c1)) return;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(c1)) { const [d, m, y] = c1.split('/'); fecha = `${y}-${m}-${d}`; folio = txt(f[2]); return; }
      if (!c1 || !fecha) return;
      const resto = f.slice(2);
      const desc = txt(resto.find(c => typeof c === 'string' && txt(c) && !/^(KG|UN|BID|LT|MT)$/i.test(txt(c))));
      const nums = resto.map((c, i) => [i, c]).filter(([, c]) => c !== '' && c !== null && !isNaN(typeof c === 'number' ? c : Number(txt(c).replace(/,/g, ''))));
      if (!desc || nums.length < 3) return;
      const v = nums.slice(-3).map(([, c]) => typeof c === 'number' ? c : Number(txt(c).replace(/,/g, '')));
      out.push({ fecha, folio, concepto, codigo: c1.replace(/\.0$/, ''), descripcion: desc, kg: v[0], pu: v[1], total: Math.round(v[2] * 100) / 100 });
    });
    return out;
  }

  async function leerArchivo(file) {
    aviso('Leyendo ' + esc(file.name) + '…');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const lineas = parsearInforme(filas).filter(l => /PRODUCCI[OÓ]N/i.test(l.concepto) || !l.concepto);
      const codigos = new Set(D.colores.map(c => c.codigo).filter(Boolean));
      const ya = new Set(D.producciones.map(p => [p.folio, p.codigo, num(p.kg)].join('|')));
      const kao = lineas.filter(l => codigos.has(l.codigo));
      const nuevas = kao.filter(l => !ya.has([l.folio, l.codigo, num(l.kg)].join('|'))).map(l => ({ ...l, cliente: '', origen: 'informe', obs: '' }));
      const revisar = lineas.filter(l => !codigos.has(l.codigo) && /KAO|CHIMIGRAF|^ZZ$/i.test(norm(l.descripcion)) && !/HC MT|BARNIZ|RESINA|ADITIVO|ANTIESPUM|MICROCAR/.test(norm(l.descripcion)));
      pendiente = { archivo: file.name, total: lineas.length, kao: kao.length, nuevas, repetidas: kao.length - nuevas.length, ignoradas: lineas.length - kao.length, revisar };
      aviso('');
      tab = 'producciones'; dibujar();
    } catch (err) { console.error(err); aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  async function confirmarImport() {
    const p = pendiente; if (!p) return;
    aviso('Guardando ' + nf(p.nuevas.length) + ' producciones…');
    try {
      let n = 0;
      for (let i = 0; i < p.nuevas.length; i += 300) {
        const lote = p.nuevas.slice(i, i + 300).map(({ concepto, ...x }) => x);
        const d = await api('importarProducciones', { items: lote });
        n += d.nuevas ?? lote.length;
      }
      if (modo === 'local') p.nuevas.forEach((x, i) => D.producciones.push({ id: 'L' + Date.now() + i, ...x }));
      else await cargar();
      pendiente = null; indexar();
      anio = anios()[0] || anio;
      dibujar(); aviso(`✅ ${nf(n)} producciones agregadas${modo === 'local' ? ' (vista previa, no se guardan)' : ''}.`, 'ok');
    } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  // =====================================================
  // RENDER
  // =====================================================
  async function render(container) {
    injectStyles();
    root = container;
    root.innerHTML = `<div class="pk">
      <div class="pk-head">
        <div><h1>Producción · Kao Chimigraf</h1><p id="pk-meta">Cargando…</p></div>
        <div class="pk-head-btns">
          <label class="pk-btn pk-btn-sec">📤 Cargar informe Softland<input type="file" id="pk-file" accept=".xls,.xlsx" hidden></label>
          <button class="pk-btn" data-act="nuevo-color">＋ Nuevo color</button>
        </div>
      </div>
      <div id="pk-aviso" class="pk-aviso" hidden></div>
      <div class="pk-tabs">
        ${[['resumen', 'Resumen'], ['producciones', 'Producciones'], ['colores', 'Colores y fórmulas'], ['maestro', 'Maestro']].map(([k, t]) => `<button class="pk-tab" data-tab="${k}">${t}</button>`).join('')}
      </div>
      <div id="pk-body"><div class="pk-card pk-vacio">Cargando datos…</div></div>
    </div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    await cargar();
    dibujar();
  }

  function dibujar() {
    if (!root) return;
    const nAct = D.colores.filter(activo).length;
    root.querySelector('#pk-meta').innerHTML = `${nf(D.colores.length)} colores (${nf(nAct)} activos) · ${nf(D.materias.length)} materias primas · ${nf(D.producciones.length)} producciones registradas`;
    const banner = modo === 'local'
      ? `<div class="pk-note">👀 <b>Vista previa:</b> todavía no está conectada la Google Sheet${errorCarga ? ' (' + esc(errorCarga) + ')' : ''}. Puedes revisar y probar todo, pero los cambios <b>no se guardan</b>. Para activarlo: publica <code>gas/ProduccionKaoAPI.gs</code> y pega la URL en <code>api/kao.js</code>.</div>`
      : (!D.colores.length ? `<div class="pk-note">La base está vacía. <button class="pk-btn" data-act="seed">Cargar datos iniciales</button></div>` : '');
    root.querySelectorAll('.pk-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab && !colorAbierto));
    charts.forEach(c => c.destroy()); charts = [];
    const body = root.querySelector('#pk-body');
    if (colorAbierto) { body.innerHTML = banner + fichaColor(); return; }
    if (tab === 'resumen') { body.innerHTML = banner + resumen(); graficosResumen(); }
    if (tab === 'producciones') body.innerHTML = banner + producciones();
    if (tab === 'colores') body.innerHTML = banner + listaColores();
    if (tab === 'maestro') body.innerHTML = banner + maestro();
  }

  const selAnio = (todos = false) => `<label>Año<select data-f="anio">${todos ? `<option value="">Todos</option>` : ''}${anios().map(y => `<option ${y === anio ? 'selected' : ''}>${y}</option>`).join('')}</select></label>`;
  const selCliente = () => `<label>Cliente<select data-f="cliente"><option value="">Todos</option><option value="__sin" ${fCliente === '__sin' ? 'selected' : ''}>Sin cliente</option>${clientes().map(c => `<option ${c === fCliente ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
  const pasaCliente = cli => !fCliente || (fCliente === '__sin' ? !cli : cli === fCliente);
  const prodsFiltradas = () => D.producciones.filter(p => (!anio || String(p.fecha).startsWith(anio)) && pasaCliente(clienteProd(p)));

  // ---------- Resumen ----------
  function resumen() {
    const ps = prodsFiltradas();
    if (!D.producciones.length) return `<div class="pk-card pk-vacio">Aún no hay producciones. Usa <b>📤 Cargar informe Softland</b>.</div>`;
    const kg = ps.reduce((a, p) => a + num(p.kg), 0), tot = ps.reduce((a, p) => a + num(p.total), 0);
    const cods = new Set(ps.map(p => p.codigo));
    const sinCli = ps.filter(p => !clienteProd(p)).length;
    return `<div class="pk-filtros">${selAnio()}${selCliente()}</div>
      <div class="pk-kpis">
        <div class="pk-kpi"><span>Kg producidos</span><strong>${nf(kg)}</strong><small>${anio || 'total'}</small></div>
        <div class="pk-kpi"><span>Producciones</span><strong>${nf(ps.length)}</strong><small>${nf(new Set(ps.map(p => p.folio)).size)} guías de recepción</small></div>
        <div class="pk-kpi"><span>Colores producidos</span><strong>${nf(cods.size)}</strong><small>de ${nf(D.colores.filter(activo).length)} activos</small></div>
        <div class="pk-kpi"><span>Valor ingresado</span><strong>${clp(tot)}</strong><small>${kg ? clp(tot / kg) + ' por kg' : ''}</small></div>
      </div>
      ${sinCli ? `<p class="pk-sub">ℹ️ ${nf(sinCli)} producciones sin cliente asignado. Se completan con los correos de solicitud o desde la pestaña Producciones.</p>` : ''}
      <div class="pk-grid2">
        <div class="pk-card"><h3>Kg producidos por mes</h3><div class="pk-chart"><canvas id="pkc-mes"></canvas></div></div>
        <div class="pk-card"><h3>Kg por cliente</h3><div class="pk-chart"><canvas id="pkc-cli"></canvas></div></div>
      </div>
      <div class="pk-card pk-mt"><h3>Colores más producidos</h3><div class="pk-chart pk-chart-alta"><canvas id="pkc-top"></canvas></div></div>`;
  }

  function graficosResumen() {
    if (!D.producciones.length) return;
    cargarChart().then(() => {
      if (tab !== 'resumen' || colorAbierto) return;
      const ps = prodsFiltradas();
      const mk = (id, cfgc) => { const el = root.querySelector('#' + id); if (el) charts.push(new Chart(el, cfgc)); };
      const porMes = Array(12).fill(0); ps.forEach(p => { porMes[Number(String(p.fecha).slice(5, 7)) - 1] += num(p.kg); });
      mk('pkc-mes', { type: 'bar', data: { labels: MESES, datasets: [{ data: porMes, backgroundColor: '#667eea', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
      const porCli = {}; ps.forEach(p => { const c = clienteProd(p) || 'Sin cliente'; porCli[c] = (porCli[c] || 0) + num(p.kg); });
      const cl = Object.entries(porCli).sort((a, b) => b[1] - a[1]);
      mk('pkc-cli', { type: 'bar', data: { labels: cl.map(x => x[0]), datasets: [{ data: cl.map(x => x[1]), backgroundColor: cl.map(x => x[0] === 'Sin cliente' ? '#cbd5e1' : '#1e7b34'), borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
      const porCod = {}; ps.forEach(p => { porCod[p.codigo] = (porCod[p.codigo] || 0) + num(p.kg); });
      const top = Object.entries(porCod).sort((a, b) => b[1] - a[1]).slice(0, 15);
      mk('pkc-top', { type: 'bar', data: { labels: top.map(([c]) => { const col = colorDe(c); return col ? col.nombre : c; }), datasets: [{ data: top.map(x => x[1]), backgroundColor: '#4f5bd5', borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }).catch(err => aviso('⚠️ ' + esc(err.message), 'err'));
  }

  let chartPromise = null;
  function cargarChart() {
    if (window.Chart) return Promise.resolve();
    if (!chartPromise) chartPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = res; s.onerror = () => { chartPromise = null; rej(new Error('No se pudo cargar la librería de gráficos')); };
      document.head.appendChild(s);
    });
    return chartPromise;
  }

  // ---------- Producciones ----------
  function preview() {
    const p = pendiente; if (!p) return '';
    return `<div class="pk-card pk-prev">
      <h3>📄 ${esc(p.archivo)}</h3>
      <div class="pk-prev-grid">
        <div><span>Líneas de producción</span><b>${nf(p.total)}</b></div>
        <div><span>Con fórmula Kao</span><b>${nf(p.kao)}</b></div>
        <div><span>Nuevas</span><b class="pk-ok">${nf(p.nuevas.length)}</b></div>
        <div><span>Ya registradas</span><b>${nf(p.repetidas)}</b></div>
      </div>
      <p class="pk-sub">Se ignoran ${nf(p.ignoradas)} líneas de productos sin fórmula (barnices de otras marcas, tintas MA, materias primas, etc.).</p>
      ${p.revisar.length ? `<details><summary class="pk-sub">⚠️ ${nf(p.revisar.length)} líneas parecen Kao pero su código no tiene fórmula</summary>
        <table class="pk-table pk-mini"><thead><tr><th>Fecha</th><th>Folio</th><th>Código</th><th>Descripción</th><th class="num">Kg</th></tr></thead><tbody>
        ${p.revisar.map(l => `<tr><td>${fCorta(l.fecha)}</td><td>${esc(l.folio)}</td><td>${esc(l.codigo)}</td><td>${esc(l.descripcion)}</td><td class="num">${nf(l.kg, 1)}</td></tr>`).join('')}</tbody></table></details>` : ''}
      <div class="pk-prev-btns"><button class="pk-btn" data-act="confirmar" ${p.nuevas.length ? '' : 'disabled'}>Guardar ${nf(p.nuevas.length)} producciones</button><button class="pk-btn pk-btn-sec" data-act="cancelar">Cancelar</button></div>
    </div>`;
  }

  function producciones() {
    const q = norm(busqueda);
    const lista = prodsFiltradas().filter(p => !q || norm([p.folio, p.codigo, nombreProd(p), clienteProd(p)].join(' ')).includes(q))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.folio).localeCompare(String(a.folio)));
    const kg = lista.reduce((a, p) => a + num(p.kg), 0);
    const opts = clientes();
    const filas = lista.slice(0, visibles).map(p => {
      const cDef = (colorDe(p.codigo) || {}).cliente || '';
      return `<tr>
        <td>${fCorta(p.fecha)}</td><td>${esc(p.folio)}</td>
        <td><a href="#" data-act="abrir-codigo" data-cod="${esc(p.codigo)}">${esc(p.codigo)}</a></td>
        <td>${esc(nombreProd(p))}</td>
        <td class="num">${nf(p.kg, 1)}</td><td class="num">${clp(p.total)}</td>
        <td><input class="pk-in pk-in-cli" list="pk-clientes" data-prod="${esc(p.id)}" value="${esc(p.cliente)}" placeholder="${esc(cDef || 'Sin cliente')}"></td>
      </tr>`;
    }).join('');
    return preview() + `<div class="pk-filtros">${selAnio(true)}${selCliente()}
        <input id="pk-buscar" class="pk-search" type="search" placeholder="Buscar folio, código, color o cliente" value="${esc(busqueda)}">
        <button class="pk-btn pk-btn-sec" data-act="nueva-prod">＋ Producción manual</button></div>
      <datalist id="pk-clientes">${opts.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="pk-sub">${nf(lista.length)} producciones · ${nf(kg, 1)} kg · el cliente se guarda al salir del campo (en gris: cliente por defecto del color)</p>
      <div class="pk-table-wrap"><table class="pk-table">
        <thead><tr><th>Fecha</th><th>Folio</th><th>Código</th><th>Color</th><th class="num">Kg</th><th class="num">Total</th><th>Cliente</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="7" class="pk-vacio">Sin producciones para este filtro</td></tr>'}</tbody></table></div>
      ${lista.length > visibles ? `<button class="pk-btn pk-btn-sec pk-mas" data-act="mas">Mostrar ${nf(Math.min(PAGINA, lista.length - visibles))} más</button>` : ''}`;
  }

  // ---------- Colores ----------
  function listaColores() {
    const q = norm(busqueda);
    const lista = D.colores.filter(c => (fEstado === 'todos' || (fEstado === 'activos') === activo(c)) && pasaCliente(c.cliente)
      && (!q || norm([c.codigo, c.nombre, c.cliente, c.archivo].join(' ')).includes(q)))
      .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
    const filas = lista.map(c => {
      const s = (c.codigo && STATS.get(c.codigo)) || null;
      const est = activo(c) ? '<span class="pk-badge ok">Activo</span>' : '<span class="pk-badge off">Inactivo</span>';
      return `<tr data-color="${esc(c.id)}">
        <td>${esc(c.codigo || '—')}</td><td><b>${esc(c.nombre)}</b>${c.estado ? ' <small class="pk-gris">(manual)</small>' : ''}</td>
        <td>${esc(c.cliente || '—')}</td><td>${esc(c.archivo || '')}</td>
        <td class="num">${s ? nf(s.n) : '0'}</td><td class="num">${s ? nf(s.kg, 1) : '0'}</td><td>${s ? fCorta(s.ultima) : '—'}</td><td>${est}</td></tr>`;
    }).join('');
    return `<div class="pk-filtros">
        <label>Estado<select data-f="estado">${[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']].map(([k, t]) => `<option value="${k}" ${k === fEstado ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${selCliente()}
        <input id="pk-buscar" class="pk-search" type="search" placeholder="Buscar código, color o cliente" value="${esc(busqueda)}"></div>
      <p class="pk-sub">${nf(lista.length)} colores · inactivo = sin producción desde ${fCorta(cfg().inactivoDesde)} (se puede forzar a mano en la ficha) · toca un color para abrir su fórmula</p>
      <div class="pk-table-wrap"><table class="pk-table pk-click">
        <thead><tr><th>Código</th><th>Color</th><th>Cliente</th><th>Origen</th><th class="num">Prod.</th><th class="num">Kg</th><th>Última</th><th>Estado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="8" class="pk-vacio">Sin colores para este filtro</td></tr>'}</tbody></table></div>`;
  }

  // ---------- Ficha de color (calculadora + editor) ----------
  function fichaColor() {
    const c = editando ? borrador : D.colores.find(x => x.id === colorAbierto);
    if (!c) { colorAbierto = null; return ''; }
    const kg = kgCalc ?? 100;
    const R = calcular(c, kg, envCalc);
    const s = (c.codigo && STATS.get(c.codigo)) || null;
    const optsMP = (sel, tipo) => D.materias.filter(m => (tipo ? m.tipo === tipo : m.tipo !== 'ENVASE')).sort((a, b) => norm(a.descripcion).localeCompare(norm(b.descripcion)))
      .map(m => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.descripcion)}${m.codigo ? ' · ' + esc(m.codigo) : ''}</option>`).join('');
    const envases = D.materias.filter(m => m.tipo === 'ENVASE');

    const cabecera = editando ? `
      <div class="pk-form">
        <label>Código<input class="pk-in" data-e="codigo" value="${esc(c.codigo)}"></label>
        <label class="pk-ancho">Nombre<input class="pk-in" data-e="nombre" value="${esc(c.nombre)}"></label>
        <label>Cliente<input class="pk-in" list="pk-clientes" data-e="cliente" value="${esc(c.cliente)}"></label>
        <label>Precio venta U$/kg<input class="pk-in" data-e="precio" inputmode="decimal" value="${c.precio ?? ''}"></label>
        <label>Estado<select class="pk-in" data-e="estado">${[['', 'Automático'], ['activo', 'Activo (forzado)'], ['inactivo', 'Inactivo (forzado)']].map(([k, t]) => `<option value="${k}" ${k === (c.estado || '') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="pk-ancho">Notas<input class="pk-in" data-e="notas" value="${esc(c.notas || '')}"></label>
      </div><datalist id="pk-clientes">${clientes().map(x => `<option value="${esc(x)}">`).join('')}</datalist>`
      : `<div class="pk-ficha-info">
          <div><span>Código</span><b>${esc(c.codigo || '—')}</b></div>
          <div><span>Cliente</span><b>${esc(c.cliente || '—')}</b></div>
          <div><span>Precio venta</span><b>${R.precio ? usd(R.precio) + '/kg' : '—'}</b></div>
          <div><span>Estado</span><b>${activo(c) ? 'Activo' : 'Inactivo'}${c.estado ? ' (manual)' : ''}</b></div>
          <div><span>Producciones</span><b>${s ? nf(s.n) + ' · ' + nf(s.kg, 1) + ' kg' : '0'}</b></div>
        </div>${c.notas ? `<p class="pk-sub">📝 ${esc(c.notas)}</p>` : ''}`;

    const filasF = R.filas.map((f, i) => editando ? `<tr>
        <td colspan="3"><select class="pk-in" data-fi="${i}" data-k="mp">${optsMP(f.mp)}</select></td>
        <td class="num"><input class="pk-in pk-in-num" data-fi="${i}" data-k="pct" inputmode="decimal" value="${nf(f.pct * 100, 2)}"></td>
        <td class="num">${nf(f.teo, 2)}</td><td class="num">${nf(f.usd, 2)}</td><td class="num">${nf(f.total, 2)}</td><td class="num">${nf(f.descontar, 1)}</td>
        <td><button class="pk-x" data-act="quitar-fila" data-i="${i}" title="Quitar">✕</button></td></tr>`
      : `<tr><td>${esc(f.m.codigo || '—')}</td><td>${esc(f.m.origen || '')}</td><td>${esc(f.m.descripcion)}</td>
        <td class="num">${pct(f.pct, 2)}</td><td class="num">${nf(f.teo, 2)}</td><td class="num">${nf(f.usd, 2)}</td><td class="num">${nf(f.total, 2)}</td><td class="num pk-desc">${nf(f.descontar, 1)}</td></tr>`).join('');

    const sumOk = Math.abs(R.sumPct - 1) < 0.0005;
    const envFilas = envases.map(m => `<tr><td>${esc(m.codigo || '—')}</td><td>${esc(m.origen || '')}</td><td>${esc(m.descripcion)}</td>
        <td class="num"><input class="pk-in pk-in-num" data-env="${esc(m.id)}" inputmode="numeric" value="${envCalc[m.id] || ''}" placeholder="0"></td>
        <td class="num">${nf(m.usd, 2)}</td><td class="num">${nf((envCalc[m.id] || 0) * (Number(m.usd) || 0), 2)}</td><td class="num pk-desc">${envCalc[m.id] ? nf(envCalc[m.id]) : ''}</td></tr>`).join('');

    const hist = D.producciones.filter(p => c.codigo && p.codigo === c.codigo).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 30);

    return `<div class="pk-ficha-head">
        <button class="pk-btn pk-btn-sec" data-act="volver">← Volver</button>
        <h2>${esc(c.nombre)}</h2>
        <div class="pk-head-btns">${editando
          ? `<button class="pk-btn pk-btn-sec" data-act="cancelar-edicion">Cancelar</button><button class="pk-btn" data-act="guardar-color">Guardar</button>`
          : `<button class="pk-btn pk-btn-sec" data-act="copiar-stock">📋 Copiar descuento de stock</button><button class="pk-btn pk-btn-sec" data-act="duplicar-color">Duplicar</button><button class="pk-btn" data-act="editar-color">✏️ Editar fórmula</button>`}</div>
      </div>
      ${cabecera}
      <div class="pk-card pk-mt">
        <div class="pk-calc-top"><h3>Formulación</h3>
          <label>Cantidad a producir <input class="pk-in pk-in-kg" id="pk-kg" inputmode="decimal" value="${String(kg).replace('.', ',')}"> kg</label></div>
        <div class="pk-table-wrap pk-flat"><table class="pk-table pk-form-table">
          <thead><tr><th>Código</th><th>Origen</th><th>Materia prima</th><th class="num">%</th><th class="num">Teórico kg</th><th class="num">U$/kg</th><th class="num">Total U$</th><th class="num">Descontar stock<br><small>+${pct(cfg().merma, 0)} merma</small></th>${editando ? '<th></th>' : ''}</tr></thead>
          <tbody>${filasF}
            ${editando ? `<tr><td colspan="9"><button class="pk-btn pk-btn-sec" data-act="agregar-fila">＋ Agregar materia prima</button></td></tr>` : ''}
            <tr class="pk-tot"><td colspan="3">TOTAL</td><td class="num ${sumOk ? '' : 'pk-mal'}">${pct(R.sumPct, 2)}</td><td class="num">${nf(kg * R.sumPct, 2)}</td><td></td><td class="num">${nf(R.costoMP, 2)}</td><td class="num">${nf(R.filas.reduce((a, f) => a + f.descontar, 0), 1)}</td>${editando ? '<td></td>' : ''}</tr>
          </tbody></table></div>
        ${sumOk ? '' : `<p class="pk-mal">⚠️ Los porcentajes suman ${pct(R.sumPct, 2)}, no 100%.</p>`}
        <h3 class="pk-mt">Envases <small class="pk-gris">(se ajustan a mano)</small></h3>
        <div class="pk-table-wrap pk-flat"><table class="pk-table">
          <thead><tr><th>Código</th><th>Origen</th><th>Envase</th><th class="num">Unidades</th><th class="num">U$/unid.</th><th class="num">Total U$</th><th class="num">Descontar stock</th></tr></thead>
          <tbody>${envFilas}</tbody></table></div>
        ${editando ? `<p class="pk-sub">Envase sugerido al abrir la calculadora: <select class="pk-in" data-e="envase"><option value="">Ninguno</option>${optsMP(c.envase ? c.envase.mp : '', 'ENVASE')}</select>
          kg por envase <input class="pk-in pk-in-num" data-e="envase_kg" inputmode="decimal" value="${c.envase ? c.envase.kg : ''}"></p>` : ''}
      </div>
      <div class="pk-grid2">
        <div class="pk-card"><h3>Costo</h3><table class="pk-res">
          <tr><td>Materias primas</td><td>${usd(R.costoMP)}</td></tr>
          <tr><td>Merma ${pct(cfg().merma, 0)}</td><td>${usd(R.costoMerma)}</td></tr>
          <tr><td>Envases</td><td>${usd(R.costoEnv)}</td></tr>
          <tr class="pk-tot"><td>Costo total</td><td>${usd(R.costoTotal)}</td></tr>
          <tr class="pk-tot"><td>Costo por kg</td><td>${usd(R.costoKg)} · ${clp(R.costoKgClp)}</td></tr>
          <tr><td>Precio venta</td><td>${R.precio ? usd(R.precio) + '/kg' : '—'}</td></tr>
          <tr class="pk-tot"><td>Margen</td><td class="${R.margen !== null && R.margen < 0 ? 'pk-mal' : 'pk-ok'}">${R.margen === null ? '—' : pct(R.margen)}</td></tr>
        </table><p class="pk-sub">Tipo de cambio ${clp(cfg().tipoCambio)} (se cambia en Maestro)</p></div>
        <div class="pk-card"><h3>Últimas producciones</h3>${hist.length ? `<div class="pk-scroll"><table class="pk-table pk-mini">
          <thead><tr><th>Fecha</th><th>Folio</th><th class="num">Kg</th><th class="num">CLP/kg</th><th>Cliente</th></tr></thead>
          <tbody>${hist.map(p => `<tr><td>${fCorta(p.fecha)}</td><td>${esc(p.folio)}</td><td class="num">${nf(p.kg, 1)}</td><td class="num">${clp(p.pu)}</td><td>${esc(clienteProd(p) || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="pk-vacio">Sin producciones registradas</p>'}</div>
      </div>
      ${editando ? `<p class="pk-mt"><button class="pk-btn pk-btn-peligro" data-act="borrar-color">Eliminar color</button></p>` : ''}`;
  }

  function abrirColor(id) {
    const c = D.colores.find(x => x.id === id); if (!c) return;
    colorAbierto = id; editando = false; borrador = null;
    kgCalc = c.envase ? c.envase.kg * 6 : 100;
    envCalc = {};
    if (c.envase) envCalc[c.envase.mp] = Math.ceil(kgCalc / (c.envase.kg || 1));
    dibujar(); window.scrollTo(0, 0);
  }

  async function guardarColor() {
    const c = borrador;
    if (!c.nombre.trim()) { aviso('⚠️ El color necesita un nombre', 'err'); return; }
    c.formula = c.formula.filter(f => f.mp && f.pct > 0);
    try {
      aviso('Guardando…');
      await api('guardarColor', { item: c });
      const i = D.colores.findIndex(x => x.id === c.id);
      if (i >= 0) D.colores[i] = c; else D.colores.push(c);
      editando = false; borrador = null; indexar(); dibujar();
      aviso('✅ Color guardado' + (modo === 'local' ? ' (vista previa, no se guarda)' : ''), 'ok');
    } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  function copiarStock() {
    const c = D.colores.find(x => x.id === colorAbierto); if (!c) return;
    const R = calcular(c, kgCalc ?? 100, envCalc);
    const lineas = [...R.filas.map(f => [f.m.codigo || '', f.m.descripcion, nf(f.descontar, 1)]), ...R.env.map(e => [e.m.codigo || '', e.m.descripcion, nf(e.n)])];
    const txt = lineas.map(l => l.join('\t')).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => aviso('📋 Copiado: ' + lineas.length + ' líneas (código, descripción, cantidad). Pégalo en Excel o Softland.', 'ok'))
      .catch(() => { prompt('Copia este texto:', txt); });
  }

  // ---------- Maestro ----------
  function maestro() {
    const q = norm(busqueda);
    const uso = {}; D.colores.forEach(c => (c.formula || []).forEach(f => { uso[f.mp] = (uso[f.mp] || 0) + 1; }));
    const lista = D.materias.filter(m => !q || norm([m.codigo, m.descripcion, m.origen].join(' ')).includes(q))
      .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'ENVASE' ? 1 : -1) || norm(a.descripcion).localeCompare(norm(b.descripcion)));
    const k = cfg();
    return `<div class="pk-card"><h3>Parámetros</h3><div class="pk-form">
        <label>Tipo de cambio CLP/US$<input class="pk-in" data-cfg="tipoCambio" inputmode="decimal" value="${k.tipoCambio}"></label>
        <label>Merma (%)<input class="pk-in" data-cfg="merma" inputmode="decimal" value="${nf(k.merma * 100, 1)}"></label>
        <label>Inactivo si no se produce desde<input class="pk-in" type="date" data-cfg="inactivoDesde" value="${k.inactivoDesde}"></label>
      </div></div>
      <div class="pk-filtros pk-mt"><input id="pk-buscar" class="pk-search" type="search" placeholder="Buscar código o materia prima" value="${esc(busqueda)}">
        <button class="pk-btn pk-btn-sec" data-act="nueva-mp">＋ Materia prima / envase</button></div>
      <p class="pk-sub">Corrige aquí un código o un costo y se actualiza en todas las fórmulas. Cambios se guardan al salir del campo.</p>
      <div class="pk-table-wrap"><table class="pk-table">
        <thead><tr><th>Código</th><th>Origen</th><th>Descripción</th><th class="num">Costo U$</th><th>Tipo</th><th class="num">En fórmulas</th></tr></thead>
        <tbody>${lista.map(m => `<tr>
          <td><input class="pk-in" data-mp="${esc(m.id)}" data-k="codigo" value="${esc(m.codigo)}"></td>
          <td><input class="pk-in" data-mp="${esc(m.id)}" data-k="origen" value="${esc(m.origen)}"></td>
          <td><input class="pk-in pk-in-desc" data-mp="${esc(m.id)}" data-k="descripcion" value="${esc(m.descripcion)}"></td>
          <td class="num"><input class="pk-in pk-in-num" data-mp="${esc(m.id)}" data-k="usd" inputmode="decimal" value="${m.usd ?? ''}"></td>
          <td><select class="pk-in" data-mp="${esc(m.id)}" data-k="tipo"><option ${m.tipo === 'MP' ? 'selected' : ''} value="MP">Materia prima</option><option ${m.tipo === 'ENVASE' ? 'selected' : ''} value="ENVASE">Envase</option></select></td>
          <td class="num">${nf(uso[m.id] || 0)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function guardarMP(id, k, v) {
    const m = D.materias.find(x => x.id === id); if (!m) return;
    const nuevo = k === 'usd' ? numIn(v) : String(v).trim();
    if (m[k] === nuevo) return;
    m[k] = nuevo;
    try { await api('guardarMateria', { item: m }); indexar(); aviso('✅ ' + esc(m.descripcion) + ' actualizado', 'ok'); }
    catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  // =====================================================
  // EVENTOS
  // =====================================================
  async function onClick(e) {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; colorAbierto = null; editando = false; busqueda = ''; visibles = PAGINA; dibujar(); return; }
    const fila = e.target.closest('tr[data-color]');
    if (fila) { abrirColor(fila.dataset.color); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (a.tagName === 'A') e.preventDefault();
    if (act === 'seed') cargarSeedEnBase();
    if (act === 'confirmar') confirmarImport();
    if (act === 'cancelar') { pendiente = null; dibujar(); }
    if (act === 'mas') { visibles += PAGINA; dibujar(); }
    if (act === 'abrir-codigo') { const c = colorDe(a.dataset.cod); if (c) abrirColor(c.id); }
    if (act === 'volver') { colorAbierto = null; editando = false; dibujar(); }
    if (act === 'editar-color') { borrador = JSON.parse(JSON.stringify(D.colores.find(c => c.id === colorAbierto))); editando = true; dibujar(); }
    if (act === 'cancelar-edicion') { editando = false; borrador = null; if (!D.colores.some(c => c.id === colorAbierto)) colorAbierto = null; dibujar(); }
    if (act === 'guardar-color') guardarColor();
    if (act === 'agregar-fila') { borrador.formula.push({ mp: '', pct: 0 }); const mp = D.materias.find(m => m.tipo !== 'ENVASE'); if (mp) borrador.formula[borrador.formula.length - 1].mp = mp.id; dibujar(); }
    if (act === 'quitar-fila') { borrador.formula.splice(Number(a.dataset.i), 1); dibujar(); }
    if (act === 'copiar-stock') copiarStock();
    if (act === 'nuevo-color' || act === 'duplicar-color') {
      const orig = act === 'duplicar-color' ? D.colores.find(c => c.id === colorAbierto) : null;
      const nuevo = orig ? { ...JSON.parse(JSON.stringify(orig)), id: 'C' + Date.now(), nombre: orig.nombre + ' (copia)', estado: '' }
        : { id: 'C' + Date.now(), codigo: '', nombre: 'NUEVO COLOR', archivo: 'Web', cliente: '', precio: null, estado: 'activo', notas: '', envase: null, formula: [] };
      colorAbierto = nuevo.id; borrador = nuevo; editando = true; // se agrega a la lista al guardar
      kgCalc = 100; envCalc = {}; dibujar();
    }
    if (act === 'borrar-color') {
      if (!confirm('¿Eliminar este color y su fórmula? Las producciones registradas no se borran.')) return;
      try { await api('borrarColor', { id: colorAbierto }); D.colores = D.colores.filter(c => c.id !== colorAbierto); colorAbierto = null; editando = false; indexar(); dibujar(); aviso('Color eliminado', 'ok'); }
      catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
    }
    if (act === 'nueva-mp') {
      const des = prompt('Descripción de la materia prima o envase:'); if (!des) return;
      const m = { id: 'MP' + Date.now(), codigo: '', origen: '', descripcion: des.trim().toUpperCase(), usd: null, tipo: /TAMBOR|BIDON|IBC|BALDE|FRASCO|ENVASE/i.test(des) ? 'ENVASE' : 'MP', activo: true };
      try { await api('guardarMateria', { item: m }); D.materias.push(m); indexar(); dibujar(); } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
    }
    if (act === 'nueva-prod') nuevaProduccion();
  }

  async function nuevaProduccion() {
    const cod = prompt('Código del color producido:'); if (!cod) return;
    const c = colorDe(cod.trim()); if (!c) { aviso('⚠️ No hay un color con el código ' + esc(cod), 'err'); return; }
    const kg = numIn(prompt(`Kg producidos de ${c.nombre}:`)); if (!kg) return;
    const fecha = prompt('Fecha (AAAA-MM-DD):', new Date().toISOString().slice(0, 10)); if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return;
    const folio = prompt('Folio de la guía de recepción (opcional):') || '';
    const p = { fecha, folio, codigo: c.codigo, descripcion: c.nombre, kg, pu: 0, total: 0, cliente: c.cliente || '', origen: 'manual', obs: '' };
    try { const d = await api('guardarProduccion', { item: p }); D.producciones.push({ id: d.id || 'L' + Date.now(), ...p }); indexar(); dibujar(); aviso('✅ Producción registrada', 'ok'); }
    catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  async function onChange(e) {
    const el = e.target;
    if (el.id === 'pk-file' && el.files[0]) { leerArchivo(el.files[0]); el.value = ''; return; }
    if (el.dataset.f === 'anio') { anio = el.value; visibles = PAGINA; dibujar(); return; }
    if (el.dataset.f === 'cliente') { fCliente = el.value; visibles = PAGINA; dibujar(); return; }
    if (el.dataset.f === 'estado') { fEstado = el.value; dibujar(); return; }
    if (el.dataset.prod) {
      const p = D.producciones.find(x => x.id === el.dataset.prod); if (!p) return;
      p.cliente = el.value.trim();
      try { await api('asignarClientes', { items: [{ id: p.id, cliente: p.cliente }] }); aviso('✅ Cliente guardado', 'ok'); } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
      return;
    }
    if (el.dataset.mp) { guardarMP(el.dataset.mp, el.dataset.k, el.value); return; }
    if (el.dataset.cfg) {
      let v = el.value;
      if (el.dataset.cfg === 'merma') v = (numIn(v) ?? 3) / 100;
      if (el.dataset.cfg === 'tipoCambio') v = numIn(v) ?? 950;
      D.config[el.dataset.cfg] = v;
      try { await api('guardarConfig', { config: { [el.dataset.cfg]: v } }); indexar(); dibujar(); aviso('✅ Parámetro guardado', 'ok'); } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
      return;
    }
    if (editando && el.dataset.fi !== undefined) {
      const f = borrador.formula[Number(el.dataset.fi)];
      if (el.dataset.k === 'mp') f.mp = el.value;
      if (el.dataset.k === 'pct') f.pct = (numIn(el.value) ?? 0) / 100;
      dibujar(); return;
    }
    if (editando && el.dataset.e) {
      const k = el.dataset.e;
      if (k === 'precio') borrador.precio = numIn(el.value);
      else if (k === 'envase') borrador.envase = el.value ? { mp: el.value, kg: (borrador.envase && borrador.envase.kg) || 1 } : null;
      else if (k === 'envase_kg') { if (borrador.envase) borrador.envase.kg = numIn(el.value) || 1; }
      else borrador[k] = el.value;
      if (k !== 'nombre' && k !== 'notas' && k !== 'codigo' && k !== 'cliente') dibujar();
      return;
    }
    if (el.id === 'pk-kg') { kgCalc = numIn(el.value) ?? 0; dibujar(); return; }
    if (el.dataset.env) { const n = numIn(el.value); if (n) envCalc[el.dataset.env] = n; else delete envCalc[el.dataset.env]; dibujar(); }
  }

  let tBuscar = null;
  function onInput(e) {
    if (e.target.id !== 'pk-buscar') return;
    busqueda = e.target.value; visibles = PAGINA;
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => {
      dibujar();
      const b = root.querySelector('#pk-buscar'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 250);
  }

  // =====================================================
  // ESTILOS
  // =====================================================
  function injectStyles() {
    if (document.getElementById('pk-styles')) return;
    const s = document.createElement('style');
    s.id = 'pk-styles';
    s.textContent = `
      .pk{padding:24px;color:#1f2937}
      .pk-head,.pk-ficha-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
      .pk-ficha-head{align-items:center}
      .pk-ficha-head h2{flex:1;margin:0;font-size:20px}
      .pk-head h1{margin:0;font-size:22px}
      .pk-head p{margin:4px 0 0;color:#6b7280;font-size:13px}
      .pk-head-btns{display:flex;gap:8px;flex-wrap:wrap}
      .pk-btn{display:inline-flex;align-items:center;gap:6px;background:#1e7b34;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap}
      .pk-btn:hover{background:#17652a}
      .pk-btn:disabled{opacity:.5;cursor:default}
      .pk-btn-sec{background:#fff;color:#374151;border:1px solid #d1d5db}
      .pk-btn-sec:hover{background:#f3f4f6}
      .pk-btn-peligro{background:#fff;color:#b91c1c;border:1px solid #fca5a5}
      .pk-btn-peligro:hover{background:#fef2f2}
      .pk-aviso{background:#eff6ff;color:#1e40af;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 12px}
      .pk-aviso.ok{background:#ecfdf5;color:#166534}.pk-aviso.err{background:#fef2f2;color:#991b1b}
      .pk-note{background:#fffbeb;color:#92400e;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .pk-note code{background:#fef3c7;padding:1px 5px;border-radius:4px}
      .pk-tabs{display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:16px;overflow-x:auto}
      .pk-tab{background:none;border:0;border-bottom:3px solid transparent;padding:10px 18px;font-weight:600;color:#6b7280;cursor:pointer;white-space:nowrap}
      .pk-tab.active{color:#4f5bd5;border-bottom-color:#667eea}
      .pk-card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08);min-width:0}
      .pk-card h3{margin:0 0 10px;font-size:15px}
      .pk-card h3.pk-mt{margin-top:22px}
      .pk-sub{margin:6px 0;font-size:12px;color:#6b7280}
      .pk-gris{color:#9ca3af;font-weight:400}
      .pk-mt{margin-top:16px}
      .pk-vacio{color:#6b7280;text-align:center;padding:30px}
      .pk-ok{color:#15803d}.pk-mal{color:#b91c1c;font-weight:600}
      .pk-filtros{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:14px;align-items:flex-end}
      .pk-filtros label{display:flex;align-items:center;gap:6px}
      .pk-filtros select{padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;background:#fff}
      .pk-search{flex:1;min-width:220px;max-width:420px;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px}
      .pk-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;background:#f5f7fa;padding:12px;border-radius:10px}
      .pk-kpi{background:#fff;border-left:4px solid #667eea;border-radius:8px;padding:14px}
      .pk-kpi span{display:block;font-size:12px;color:#6b7280}
      .pk-kpi strong{display:block;font-size:24px;margin-top:4px}
      .pk-kpi small{display:block;font-size:11px;color:#9ca3af;margin-top:4px}
      .pk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
      .pk-chart{position:relative;height:280px}.pk-chart-alta{height:420px}
      .pk-table-wrap{overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .pk-flat{box-shadow:none;border:1px solid #eef0f3}
      .pk-scroll{max-height:320px;overflow:auto}
      .pk-table{width:100%;border-collapse:collapse;font-size:13px}
      .pk-table th{background:#f5f7fa;text-align:left;padding:9px 10px;white-space:nowrap;position:sticky;top:0}
      .pk-table td{padding:7px 10px;border-top:1px solid #f0f1f4;white-space:nowrap}
      .pk-table .num{text-align:right}
      .pk-table a{color:#1565c0;font-weight:600}
      .pk-click tbody tr{cursor:pointer}.pk-click tbody tr:hover td{background:#f9fafb}
      .pk-mini{font-size:12px}
      .pk-tot td{font-weight:700;background:#f5f7fa}
      .pk-desc{font-weight:700;background:#fefce8}
      .pk-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:600}
      .pk-badge.ok{background:#dcfce7;color:#166534}.pk-badge.off{background:#f1f5f9;color:#64748b}
      .pk-in{padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;font-family:inherit;background:#fff;max-width:100%}
      .pk-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.12)}
      .pk-in-num{width:80px;text-align:right}.pk-in-kg{width:90px;text-align:right;font-size:16px;font-weight:700}
      .pk-in-cli{width:170px}.pk-in-desc{width:300px}
      .pk-in-cli::placeholder{color:#9ca3af}
      .pk-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .pk-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6b7280}
      .pk-form .pk-ancho{grid-column:span 2}
      .pk-ficha-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
      .pk-ficha-info div{background:#fff;border-radius:8px;padding:10px 12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
      .pk-ficha-info span{display:block;font-size:12px;color:#6b7280}.pk-ficha-info b{display:block;font-size:15px;margin-top:2px}
      .pk-calc-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
      .pk-calc-top h3{margin:0}
      .pk-x{background:none;border:0;color:#b91c1c;font-size:14px;cursor:pointer}
      .pk-res{width:100%;border-collapse:collapse;font-size:14px}
      .pk-res td{padding:7px 4px;border-top:1px solid #f0f1f4}.pk-res td:last-child{text-align:right}
      .pk-prev{margin-bottom:14px;border-left:4px solid #667eea}
      .pk-prev-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:6px}
      .pk-prev-grid div{background:#f5f7fa;border-radius:8px;padding:10px 12px}
      .pk-prev-grid span{display:block;font-size:12px;color:#6b7280}.pk-prev-grid b{display:block;font-size:18px;margin-top:2px}
      .pk-prev-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      .pk-mas{margin:12px auto 0;display:block}
      @media (max-width:900px){.pk-grid2{grid-template-columns:1fr}.pk-head,.pk-ficha-head{flex-direction:column;align-items:stretch}.pk-prev-grid{grid-template-columns:1fr 1fr}.pk-form .pk-ancho{grid-column:auto}}
      @media (max-width:700px){.pk{padding:0}.pk-head h1{font-size:19px}.pk-kpis{grid-template-columns:1fr 1fr}.pk-kpi strong{font-size:20px}.pk-search{max-width:none;font-size:16px}.pk-filtros label{flex:1}}
    `;
    document.head.appendChild(s);
  }

  return { render, _parsearInforme: parsearInforme, _calcular: calcular };
})();
