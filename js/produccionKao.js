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
  let D = { config: {}, materias: [], colores: [], producciones: [], ordenes: [] };
  let modo = 'api';          // 'api' | 'local' (vista previa sin guardar)
  let errorCarga = '';
  let tab = 'orden';
  let anio = '';
  let fCliente = '';
  let vistaRes = 'anio';     // Resumen: 'anio' | 'mes'
  let mesRes = '';           // Resumen por mes: 'YYYY-MM' 
  let busqueda = '';
  let fEstado = 'activos';
  let visibles = PAGINA;
  let colorAbierto = null;   // id del color en la ficha
  let editando = false;      // ficha en modo edición
  let borrador = null;       // copia del color mientras se edita
  let kgCalc = null;         // kg a producir en la calculadora
  let envCalc = {};          // mp_id -> unidades de envase en la calculadora
  let pendiente = null;      // importación esperando confirmación
  let pendienteCorreos = null; // asignación de clientes desde correos esperando confirmación
  let charts = [];
  let seedAuto = false;
  const LOGO_URL = '/img/logo-walter-lund.png';      // evita lanzar la carga automática de datos iniciales más de una vez

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
  async function cargar(intento = 1) {
    errorCarga = '';
    try {
      const r = await fetch(API_URL, { cache: 'no-store' });
      const d = await r.json().catch(() => ({ ok: false, sinConfigurar: r.status === 404, error: 'Respuesta no válida (' + r.status + ')' }));
      if (d.sinConfigurar || r.status === 404) throw Object.assign(new Error(d.error || 'API sin configurar'), { local: true });
      if (!d.ok) throw new Error(d.error || 'Error al leer la base');
      // A veces el Apps Script responde vacío (hoja ocupada / arranque en frío): reintenta antes de darla por vacía
      if (!(d.colores || []).length && intento < 3) { await new Promise(res => setTimeout(res, 1500 * intento)); return cargar(intento + 1); }
      modo = 'api';
      D = { config: d.config || {}, materias: d.materias || [], colores: d.colores || [], producciones: d.producciones || [], ordenes: d.ordenes || [] };
    } catch (err) {
      if (!err.local) errorCarga = err.message;
      modo = 'local';
      const s = await (await fetch(SEED_URL, { cache: 'no-store' })).json();
      D = { config: s.config, materias: s.materias, colores: s.colores, producciones: s.producciones.map((p, i) => ({ id: 'L' + i, ...p })), ordenes: [] };
    }
    unificarClientes();
    indexar();
    if (!anio || !anios().includes(anio)) anio = anios()[0] || '';
  }

  // Junta nombres repetidos de un mismo cliente (ej. YAPAK → YAPACK) según ALIAS_CLI
  // y guarda la corrección en la planilla para que no vuelva a aparecer.
  function unificarClientes() {
    const canon = c => ALIAS_CLI[norm(c)];
    const cols = [], prods = [];
    D.colores.forEach(c => { const k = c.cliente && canon(c.cliente); if (k && k !== c.cliente) { c.cliente = k; cols.push({ id: c.id, cliente: k }); } });
    D.producciones.forEach(p => { const k = p.cliente && canon(p.cliente); if (k && k !== p.cliente) { p.cliente = k; prods.push({ id: p.id, cliente: k }); } });
    (D.ordenes || []).forEach(o => { const k = o.cliente && canon(o.cliente); if (k && k !== o.cliente) o.cliente = k; });
    if (modo !== 'api') return;
    if (cols.length) api('asignarClientesColores', { items: cols }).catch(err => console.warn('Kao clientes:', err));
    if (prods.length) api('asignarClientes', { items: prods }).catch(err => console.warn('Kao clientes:', err));
  }

  async function api(action, payload) {
    if (modo !== 'api') return { ok: true, local: true };
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Error al guardar');
    return d;
  }

  async function cargarSeedEnBase(auto = false) {
    if (!auto && !confirm('Esto carga en la Google Sheet el maestro, las fórmulas de los dos Excel y las producciones 2026. ¿Continuar?')) return;
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
  // CLIENTES DESDE CORREOS (CSV exportado de Outlook)
  // Lee las tablas de los correos "INGRESAR Y FACTURAR":
  //   CLIENTE | DESCRIPCION | CODIGO | BATCH | KILOS | OBSERVACION
  // y asigna el cliente a cada producción por código + kilos (en orden de batch).
  // =====================================================
  const ALIAS_CLI = {
    'DIROLOA': 'DIROLA', 'DIROLA SPA': 'DIROLA', 'AYC': 'A&C', 'A Y C': 'A&C', 'SERVICIOS PUBLICITARIOS A&C': 'A&C',
    'VALERIA RAMIREZ': 'VALERIA RAMIREZ ARRAU', 'VALERIA ARRAU': 'VALERIA RAMIREZ ARRAU', 'VALERIA ALEJANDRA ARRAU': 'VALERIA RAMIREZ ARRAU',
    'VALERIA ALEJANDRA RAMIREZ ARRAU': 'VALERIA RAMIREZ ARRAU', 'MAXIPAPER': 'MAXI PAPER', 'JUAN CORDOVA': 'JUAN CORDOBA',
    'COMERCIAL GRAF PACK': 'GRAF PACK', 'SOC. COMERCIAL GRAF. PACK': 'GRAF PACK', 'PRODUCTOS TORRE': 'TORRE', 'YAPAK': 'YAPACK'
  };
  const normCli = c => { const n = norm(c); return ALIAS_CLI[n] || n; };

  function parsearCorreos(filas) {
    const recs = new Map();
    const esNum = t => /^\d+(?:[.,]\d+)?$/.test(t);
    filas.forEach(f => {
      const toks = String(f.Cuerpo || f.Body || '').split(/[\r\n\t]+/).map(t => t.trim()).filter(Boolean);
      for (let i = 2; i + 1 < toks.length; i++) {
        const t = toks[i];
        if (!/^\d{8,11}$/.test(t) || /^[\d.,]+$/.test(toks[i - 1])) continue;
        const a = toks[i + 1], b = toks[i + 2] || '';
        let batch, kg;
        if (/^\d{4,8}$/.test(a) && esNum(b)) { batch = a; kg = b; }
        else if (esNum(a) && a.length <= 5) { batch = ''; kg = a; }
        else continue;
        const cli = toks[i - 2], desc = toks[i - 1];
        if (/CODIGO|DESCRIPCION|BATCH|KILOS|OBSERVACION/i.test(cli + desc)) continue;
        i += batch ? 2 : 1;
        const anio = /^(2024|2025|2026|2027|2028)/.test(batch) && batch.length >= 6 ? batch.slice(0, 4) : '';
        const r = { cliente: normCli(cli), descripcion: desc, codigo: t, batch, anio, ord: anio ? Number(batch.slice(4)) : 0, kg: Number(kg.replace(',', '.')) };
        const k = batch ? t + '|' + batch : t + '|' + r.cliente + '|' + kg + '|' + recs.size;
        if (!recs.has(k)) recs.set(k, r);
      }
    });
    return [...recs.values()];
  }

  async function leerCorreos(file) {
    aviso('Leyendo correos…');
    try {
      const wb = XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string' });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const recs = parsearCorreos(filas);
      if (!recs.length) throw new Error('No encontré tablas de "INGRESAR Y FACTURAR" en el archivo. ¿Es el CSV exportado de Outlook?');
      const porCod = {};
      recs.forEach(r => (porCod[r.codigo] = porCod[r.codigo] || []).push(r));
      const prods = [], cuenta = { correo: 0, color: 0, ambiguo: 0 };
      const codigos = [...new Set(D.producciones.filter(p => !p.cliente).map(p => p.codigo))];
      codigos.forEach(cod => {
        const todos = porCod[cod] || []; if (!todos.length) return;
        const clis = new Set(todos.map(r => r.cliente));
        const ps = D.producciones.filter(p => p.codigo === cod).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.folio).localeCompare(String(b.folio)));
        const usados = new Set();
        ps.forEach(p => {
          const y = String(p.fecha).slice(0, 4);
          const cand = todos.filter(r => !r.anio || r.anio === y).sort((a, b) => (a.anio ? 0 : 1) - (b.anio ? 0 : 1) || a.ord - b.ord);
          const r = cand.find(r => !usados.has(r) && Math.abs(r.kg - num(p.kg)) < 0.01);
          if (r) usados.add(r);
          if (p.cliente) return;
          if (r) { prods.push({ id: p.id, cliente: r.cliente }); cuenta.correo++; }
          else if (clis.size === 1) { prods.push({ id: p.id, cliente: [...clis][0] }); cuenta.color++; }
          else cuenta.ambiguo++;
        });
      });
      const colores = D.colores.filter(c => !c.cliente && c.codigo && porCod[c.codigo]).map(c => {
        const n = {}; porCod[c.codigo].forEach(r => { n[r.cliente] = (n[r.cliente] || 0) + 1; });
        return { id: c.id, cliente: Object.entries(n).sort((a, b) => b[1] - a[1])[0][0] };
      });
      const conocidos = new Set(D.colores.map(c => c.codigo));
      const sinColor = recs.filter(r => !conocidos.has(r.codigo));
      pendienteCorreos = { archivo: file.name, correos: filas.length, solicitudes: recs.length, prods, colores, cuenta, sinColor,
        clientes: [...new Set(recs.map(r => r.cliente))].sort() };
      aviso(''); tab = 'producciones'; colorAbierto = null; dibujar();
    } catch (err) { console.error(err); aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  function previewCorreos() {
    const p = pendienteCorreos; if (!p) return '';
    return `<div class="pk-card pk-prev">
      <h3>✉️ ${esc(p.archivo)}</h3>
      <div class="pk-prev-grid">
        <div><span>Solicitudes leídas</span><b>${nf(p.solicitudes)}</b></div>
        <div><span>Producciones con cliente</span><b class="pk-ok">${nf(p.prods.length)}</b></div>
        <div><span>Colores con cliente por defecto</span><b class="pk-ok">${nf(p.colores.length)}</b></div>
        <div><span>Sin resolver</span><b>${nf(p.cuenta.ambiguo)}</b></div>
      </div>
      <p class="pk-sub">${nf(p.cuenta.correo)} calzan exacto con su correo (código + kilos) y ${nf(p.cuenta.color)} se asignan porque ese color solo lo pide un cliente. Solo se llenan producciones y colores que <b>no</b> tienen cliente; lo que ya asignaste a mano no se toca.</p>
      <p class="pk-sub">Clientes encontrados: ${p.clientes.map(esc).join(' · ')}</p>
      ${p.sinColor.length ? `<details><summary class="pk-sub">⚠️ ${nf(p.sinColor.length)} solicitudes con códigos que no tienen fórmula</summary>
        <table class="pk-table pk-mini"><thead><tr><th>Cliente</th><th>Código</th><th>Descripción</th><th>Batch</th><th class="num">Kg</th></tr></thead><tbody>
        ${p.sinColor.map(r => `<tr><td>${esc(r.cliente)}</td><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td><td>${esc(r.batch)}</td><td class="num">${nf(r.kg, 1)}</td></tr>`).join('')}</tbody></table></details>` : ''}
      <div class="pk-prev-btns"><button class="pk-btn" data-act="confirmar-correos" ${p.prods.length || p.colores.length ? '' : 'disabled'}>Asignar clientes</button><button class="pk-btn pk-btn-sec" data-act="cancelar-correos">Cancelar</button></div>
    </div>`;
  }

  async function confirmarCorreos() {
    const p = pendienteCorreos; if (!p) return;
    aviso('Guardando clientes…');
    try {
      for (let i = 0; i < p.prods.length; i += 400) await api('asignarClientes', { items: p.prods.slice(i, i + 400) });
      if (p.colores.length) await api('asignarClientesColores', { items: p.colores });
      const mp = new Map(p.prods.map(x => [x.id, x.cliente])), mc = new Map(p.colores.map(x => [x.id, x.cliente]));
      D.producciones.forEach(x => { if (mp.has(x.id)) x.cliente = mp.get(x.id); });
      D.colores.forEach(x => { if (mc.has(x.id)) x.cliente = mc.get(x.id); });
      pendienteCorreos = null; indexar(); dibujar();
      aviso(`✅ Clientes asignados a ${nf(p.prods.length)} producciones y ${nf(p.colores.length)} colores${modo === 'local' ? ' (vista previa, no se guardan)' : ''}.`, 'ok');
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
          <label class="pk-btn pk-btn-sec" title="CSV exportado desde Outlook con los correos INGRESAR Y FACTURAR">✉️ Clientes desde correos<input type="file" id="pk-mail" accept=".csv" hidden></label>

        </div>
      </div>
      <div id="pk-aviso" class="pk-aviso" hidden></div>
      <div class="pk-tabs">
        ${[['orden', '＋ Nueva orden'], ['ordenes', 'Órdenes'], ['resumen', 'Resumen'], ['producciones', 'Producciones'], ['colores', 'Colores y fórmulas'], ['maestro', 'Maestro']].map(([k, t]) => `<button class="pk-tab" data-tab="${k}">${t}</button>`).join('')}
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
      : (!D.colores.length ? `<div class="pk-note">Cargando datos iniciales…</div>` : '');
    // base vacía: se cargan los datos iniciales solos (el Apps Script rechaza el seed si la hoja ya tiene colores)
    if (modo === 'api' && !D.colores.length && !seedAuto) { seedAuto = true; setTimeout(() => cargarSeedEnBase(true), 0); }
    root.querySelectorAll('.pk-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab && !colorAbierto));
    charts.forEach(c => c.destroy()); charts = [];
    const body = root.querySelector('#pk-body');
    if (colorAbierto) { body.innerHTML = banner + fichaColor(); return; }
    if (tab === 'orden') body.innerHTML = banner + vistaOrden();
    if (tab === 'ordenes') body.innerHTML = banner + vistaOrdenes();
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
  const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const mesLbl = ym => `${MESES_L[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const mesesConDatos = () => [...new Set(D.producciones.map(p => String(p.fecha).slice(0, 7)))].filter(m => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const mesAnterior = ym => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const delMes = ym => D.producciones.filter(p => String(p.fecha).startsWith(ym) && pasaCliente(clienteProd(p)));
  const sumKg = ps => ps.reduce((a, p) => a + num(p.kg), 0);
  const varPct = (a, b) => { if (!b) return ''; const v = (a - b) / b; return `<small class="${v >= 0 ? 'pk-up' : 'pk-down'}">${v >= 0 ? '▲' : '▼'} ${nf(Math.abs(v) * 100, 0)}%`; };

  function selVista() {
    const meses = mesesConDatos();
    if (vistaRes === 'mes' && (!mesRes || !meses.includes(mesRes))) mesRes = meses.find(m => m.startsWith(anio)) || meses[0] || '';
    return `<div class="pk-seg">${[['anio', 'Por año'], ['mes', 'Por mes']].map(([k, l]) => `<button data-act="vista-res" data-v="${k}" class="${vistaRes === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${vistaRes === 'anio' ? selAnio() : `<label>Mes<select data-f="mesres">${meses.map(m => `<option value="${m}" ${m === mesRes ? 'selected' : ''}>${mesLbl(m)}</option>`).join('')}</select></label>`}`;
  }

  function resumen() {
    if (!D.producciones.length) return `<div class="pk-card pk-vacio">Aún no hay producciones. Usa <b>📤 Cargar informe Softland</b>.</div>`;
    if (vistaRes === 'mes') return resumenMes();
    const ps = prodsFiltradas();
    const kg = ps.reduce((a, p) => a + num(p.kg), 0), tot = ps.reduce((a, p) => a + num(p.total), 0);
    const cods = new Set(ps.map(p => p.codigo));
    const sinCli = ps.filter(p => !clienteProd(p)).length;
    return `<div class="pk-filtros">${selVista()}${selCliente()}</div>
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

  function resumenMes() {
    const filtros = `<div class="pk-filtros">${selVista()}${selCliente()}</div>`;
    if (!mesRes) return filtros + '<div class="pk-card pk-vacio">Sin producciones registradas.</div>';
    const ps = delMes(mesRes), ant = delMes(mesAnterior(mesRes));
    const aa = delMes(`${Number(mesRes.slice(0, 4)) - 1}${mesRes.slice(4)}`);
    const kg = sumKg(ps), kgAnt = sumKg(ant), kgAA = sumKg(aa);
    const tot = ps.reduce((a, p) => a + num(p.total), 0);
    const dias = new Set(ps.map(p => String(p.fecha).slice(0, 10))).size;
    const sinCli = ps.filter(p => !clienteProd(p)).length;
    const mAnt = MESES_L[Number(mesAnterior(mesRes).slice(5, 7)) - 1].toLowerCase();
    // tabla de colores del mes
    const porCod = new Map();
    ps.forEach(p => { const x = porCod.get(p.codigo) || { codigo: p.codigo, nombre: nombreProd(p), n: 0, kg: 0, clientes: new Set() }; x.n++; x.kg += num(p.kg); const c = clienteProd(p); if (c) x.clientes.add(c); porCod.set(p.codigo, x); });
    const filasCol = [...porCod.values()].sort((a, b) => b.kg - a.kg).map(x => `<tr><td>${swatch(x.nombre)} <b>${esc(x.nombre)}</b> <small class="pk-gris">${esc(x.codigo)}</small></td>
      <td>${esc([...x.clientes].join(', ') || '—')}</td><td class="num">${nf(x.n)}</td><td class="num"><b>${nf(x.kg, 1)}</b></td><td class="num">${kg ? pct(x.kg / kg) : ''}</td></tr>`).join('');
    return filtros + `
      <div class="pk-kpis">
        <div class="pk-kpi"><span>Kg producidos · ${esc(mesLbl(mesRes))}</span><strong>${nf(kg)}</strong>${kgAnt ? `${varPct(kg, kgAnt)} vs ${mAnt}</small>` : '<small>Sin datos del mes anterior</small>'}${kgAA ? `${varPct(kg, kgAA)} vs ${MESES_L[Number(mesRes.slice(5, 7)) - 1].toLowerCase()} ${Number(mesRes.slice(0, 4)) - 1}</small>` : ''}</div>
        <div class="pk-kpi"><span>Producciones</span><strong>${nf(ps.length)}</strong><small>${nf(new Set(ps.map(p => p.folio)).size)} guías · ${nf(dias)} días con producción</small></div>
        <div class="pk-kpi"><span>Colores producidos</span><strong>${nf(porCod.size)}</strong><small>${nf(new Set(ps.map(p => clienteProd(p)).filter(Boolean)).size)} clientes</small></div>
        <div class="pk-kpi"><span>Valor ingresado</span><strong>${clp(tot)}</strong><small>${kg ? clp(tot / kg) + ' por kg' : ''}</small></div>
      </div>
      ${sinCli ? `<p class="pk-sub">ℹ️ ${nf(sinCli)} producciones del mes sin cliente asignado.</p>` : ''}
      ${ps.length ? `
      <div class="pk-card pk-mt"><h3>Kg producidos por día · ${esc(mesLbl(mesRes))}</h3><div class="pk-chart pk-chart-baja"><canvas id="pkc-dia"></canvas></div></div>
      <div class="pk-grid2">
        <div class="pk-card"><h3>Kg por cliente</h3><div class="pk-chart"><canvas id="pkc-cli"></canvas></div></div>
        <div class="pk-card"><h3>Últimos 12 meses</h3><div class="pk-chart"><canvas id="pkc-12"></canvas></div></div>
      </div>
      <div class="pk-card pk-mt"><h3>Colores producidos en el mes</h3>
        <table class="pk-table pk-mini pk-mt-s"><thead><tr><th>Color</th><th>Cliente</th><th class="num">Producciones</th><th class="num">Kg</th><th class="num">% del mes</th></tr></thead>
        <tbody>${filasCol}<tr class="pk-tot"><td colspan="2">TOTAL</td><td class="num">${nf(ps.length)}</td><td class="num">${nf(kg, 1)}</td><td class="num">100%</td></tr></tbody></table></div>`
      : '<div class="pk-card pk-vacio pk-mt">Sin producciones en este mes con el filtro elegido.</div>'}`;
  }

  function graficosResumen() {
    if (!D.producciones.length) return;
    cargarChart().then(() => {
      if (tab !== 'resumen' || colorAbierto) return;
      const mk = (id, cfgc) => { const el = root.querySelector('#' + id); if (el) charts.push(new Chart(el, cfgc)); };
      const base0 = () => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => nf(c.parsed[c.chart.options.indexAxis === 'y' ? 'x' : 'y'], 1) + ' kg' } } } });
      const barCli = ps => {
        const porCli = {}; ps.forEach(p => { const c = clienteProd(p) || 'Sin cliente'; porCli[c] = (porCli[c] || 0) + num(p.kg); });
        const cl = Object.entries(porCli).sort((a, b) => b[1] - a[1]);
        mk('pkc-cli', { type: 'bar', data: { labels: cl.map(x => x[0]), datasets: [{ data: cl.map(x => x[1]), backgroundColor: cl.map(x => x[0] === 'Sin cliente' ? '#cbd5e1' : '#1e7b34'), borderRadius: 4 }] }, options: { ...base0(), indexAxis: 'y' } });
      };
      if (vistaRes === 'mes') {
        if (!mesRes) return;
        const ps = delMes(mesRes);
        const y = Number(mesRes.slice(0, 4)), m = Number(mesRes.slice(5, 7));
        const nDias = new Date(y, m, 0).getDate();
        const porDia = Array(nDias).fill(0); ps.forEach(p => { const d = Number(String(p.fecha).slice(8, 10)); if (d >= 1 && d <= nDias) porDia[d - 1] += num(p.kg); });
        const finde = Array.from({ length: nDias }, (_, i) => [0, 6].includes(new Date(y, m - 1, i + 1).getDay()));
        mk('pkc-dia', { type: 'bar', data: { labels: porDia.map((_, i) => i + 1), datasets: [{ data: porDia, backgroundColor: finde.map(f => f ? '#a5b4fc' : '#667eea'), borderRadius: 3 }] }, options: base0() });
        barCli(ps);
        const ult = []; let k = mesRes; for (let i = 0; i < 12; i++) { ult.unshift(k); k = mesAnterior(k); }
        mk('pkc-12', { type: 'bar', data: { labels: ult.map(x => MESES[Number(x.slice(5, 7)) - 1] + ' ' + x.slice(2, 4)), datasets: [{ data: ult.map(x => sumKg(delMes(x))), backgroundColor: ult.map(x => x === mesRes ? '#4f5bd5' : '#c7d2fe'), borderRadius: 4 }] }, options: base0() });
        return;
      }
      const ps = prodsFiltradas();
      const porMes = Array(12).fill(0); ps.forEach(p => { porMes[Number(String(p.fecha).slice(5, 7)) - 1] += num(p.kg); });
      mk('pkc-mes', { type: 'bar', data: { labels: MESES, datasets: [{ data: porMes, backgroundColor: '#667eea', borderRadius: 4 }] }, options: { ...base0(),
        onClick: (_, els) => { if (!els.length || !anio) return; const mm = String(els[0].index + 1).padStart(2, '0'); if (!porMes[els[0].index]) return; vistaRes = 'mes'; mesRes = `${anio}-${mm}`; setTimeout(dibujar, 0); },
        onHover: (ev, els) => { ev.native.target.style.cursor = els.length ? 'pointer' : 'default'; } } });
      barCli(ps);
      const porCod = {}; ps.forEach(p => { porCod[p.codigo] = (porCod[p.codigo] || 0) + num(p.kg); });
      const top = Object.entries(porCod).sort((a, b) => b[1] - a[1]).slice(0, 15);
      mk('pkc-top', { type: 'bar', data: { labels: top.map(([c]) => { const col = colorDe(c); return col ? col.nombre : c; }), datasets: [{ data: top.map(x => x[1]), backgroundColor: '#4f5bd5', borderRadius: 4 }] }, options: { ...base0(), indexAxis: 'y' } });
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
    return previewCorreos() + preview() + `<div class="pk-filtros">${selAnio(true)}${selCliente()}
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
  // Duplicados exactos: mismo código + mismo nombre (sin signos) + misma fórmula.
  // Se conserva la ficha con cliente asignado (o la primera). Las variantes (SUN, MIXTO, etc.) no se tocan.
  function duplicados() {
    const firma = c => [c.codigo, norm(c.nombre).replace(/[^A-Z0-9]/g, ''),
      (c.formula || []).map(f => f.mp + ':' + Number(f.pct).toFixed(4)).sort().join(',')].join('|');
    const grupos = new Map();
    D.colores.filter(c => c.codigo).forEach(c => { const k = firma(c); grupos.set(k, (grupos.get(k) || []).concat(c)); });
    const borrar = [];
    grupos.forEach(g => {
      if (g.length < 2) return;
      const queda = g.find(c => c.cliente) || g[0];
      g.forEach(c => { if (c !== queda) borrar.push(c); });
    });
    return borrar;
  }

  async function borrarDuplicados() {
    const dups = duplicados(); if (!dups.length) return;
    if (!confirm(`Se eliminarán ${dups.length} fichas repetidas. Queda una de cada color con su fórmula; las producciones no se tocan. ¿Continuar?`)) return;
    let n = 0;
    try {
      for (const c of dups) { aviso(`Eliminando duplicados… ${n + 1} de ${dups.length}`); await api('borrarColor', { id: c.id }); D.colores = D.colores.filter(x => x.id !== c.id); n++; }
      indexar(); dibujar(); aviso(`✅ ${nf(n)} duplicados eliminados${modo === 'local' ? ' (vista previa, no se guarda)' : ''}.`, 'ok');
    } catch (err) { indexar(); dibujar(); aviso(`⚠️ ${esc(err.message)}. Se eliminaron ${n}; vuelve a apretar el botón para seguir.`, 'err'); }
  }

  function listaColores() {
    const dups = duplicados();
    const q = norm(busqueda);
    const lista = D.colores.filter(c => (fEstado === 'todos' || (fEstado === 'activos') === activo(c)) && pasaCliente(c.cliente)
      && (!q || norm([c.codigo, c.nombre, c.cliente, c.archivo].join(' ')).includes(q)))
      .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
    const filas = lista.map(c => {
      const s = (c.codigo && STATS.get(c.codigo)) || null;
      const est = activo(c) ? '<span class="pk-badge ok">Activo</span>' : '<span class="pk-badge off">Inactivo</span>';
      return `<tr data-color="${esc(c.id)}">
        <td>${esc(c.codigo || '—')}</td><td><b>${esc(c.nombre)}</b>${c.estado ? ' <small class="pk-gris">(manual)</small>' : ''}</td>
        <td>${esc(c.cliente || '—')}</td>
        <td class="num">${s ? nf(s.n) : '0'}</td><td class="num">${s ? nf(s.kg, 1) : '0'}</td><td>${s ? fCorta(s.ultima) : '—'}</td><td>${est}</td></tr>`;
    }).join('');
    return `<div class="pk-filtros">
        <label>Estado<select data-f="estado">${[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']].map(([k, t]) => `<option value="${k}" ${k === fEstado ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${selCliente()}
        <input id="pk-buscar" class="pk-search" type="search" placeholder="Buscar código, color o cliente" value="${esc(busqueda)}">
        <button class="pk-btn" data-act="nuevo-color">＋ Nuevo color</button></div>
      ${dups.length ? `<div class="pk-note">🧹 Hay <b>${nf(dups.length)} fichas duplicadas</b> (mismo código, mismo nombre y misma fórmula, venían repetidas de los dos Excel). <button class="pk-btn" data-act="borrar-duplicados">Eliminar duplicados</button></div>` : ''}
      <p class="pk-sub">${nf(lista.length)} colores · inactivo = sin producción desde ${fCorta(cfg().inactivoDesde)} (se puede forzar a mano en la ficha) · toca un color para abrir su fórmula</p>
      <div class="pk-table-wrap"><table class="pk-table pk-click">
        <thead><tr><th>Código</th><th>Color</th><th>Cliente</th><th class="num">Prod.</th><th class="num">Kg</th><th>Última</th><th>Estado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="7" class="pk-vacio">Sin colores para este filtro</td></tr>'}</tbody></table></div>`;
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
  // ÓRDENES DE PRODUCCIÓN (flujo paso a paso)
  //  1. Cliente  2. Colores  3. Formulación y envases  4. Revisar, guardar e imprimir
  // =====================================================
  const hoyLocal = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
  const PASOS = ['Cliente', 'Colores', 'Formulación', 'Revisar e imprimir'];
  const ESTADOS_OP = { pendiente: 'Pendiente', produccion: 'En producción', producida: 'Producida', anulada: 'Anulada' };
  let wiz = null;            // { paso, cliente, items:[{colorId, kg, batch, envases:{}}], obs, fecha }
  let qCli = '', qCol = '';
  let ordenAbierta = null;
  let fEstOrd = 'abiertas';

  // color aproximado para la muestra visual, según el nombre
  const SWATCH = [
    [/TRANSPARENTE|BARNIZ|CREMA|LIMPIADOR/, 'transp'], [/BLANCO|OPACO/, '#f8f8f6'], [/NEGRO/, '#1f1f1f'],
    [/COOL GRAY|GRIS|GRAY/, '#8d9196'], [/PLATA|SILVER/, '#c0c4c8'], [/ORO|DORADO|GOLD/, '#c9a227'],
    [/BURDEO|BORDEAUX|VINO/, '#7b1f2e'], [/CAFE|MARRON|CHOCOLATE/, '#6d4c41'],
    [/NARANJA|ORANGE/, '#f28c28'], [/AMARILLO|YELLOW/, '#f5c518'],
    [/MAGENTA|RUBINE|RHODAMINE/, '#c2185b'], [/FUCSIA/, '#d81b78'], [/ROSA|ROSADO|PINK/, '#f06292'],
    [/WARM RED|ROJO|RED|185|032|199/, '#d32f2f'],
    [/LILA|LAVANDA/, '#b39ddb'], [/VIOLETA|PURPURA|PURPLE|MORADO/, '#7b3fa0'],
    [/CYAN|CELESTE|TURQUESA|PROCESS BLUE/, '#1fa5d8'], [/AZUL|BLUE|REFLEX|REFLEJO/, '#1e4fa3'],
    [/VERDE OSCURO/, '#1b5e20'], [/VERDE CLARO/, '#7cb342'], [/VERDE|GREEN/, '#2e7d32']
  ];
  const ordenAlfa = (a, b) => norm(a).localeCompare(norm(b), 'es', { numeric: true });
  const swatchColor = nombre => { const n = norm(nombre); const s = SWATCH.find(([re]) => re.test(n)); return s ? s[1] : '#b0b7c3'; };
  const swatch = (nombre, cls = '') => { const c = swatchColor(nombre); return `<span class="pk-sw ${cls} ${c === 'transp' ? 'pk-sw-transp' : ''}" style="${c === 'transp' ? '' : '--sw:' + c}"></span>`; };

  // clientes con sus estadísticas (de producciones y colores)
  function clientesStats() {
    const m = new Map();
    const get = c => { if (!m.has(c)) m.set(c, { cliente: c, n: 0, kg: 0, ultima: '', codigos: new Set() }); return m.get(c); };
    D.producciones.forEach(p => { const c = clienteProd(p); if (!c) return; const s = get(c); s.n++; s.kg += num(p.kg); if (p.fecha > s.ultima) s.ultima = p.fecha; s.codigos.add(p.codigo); });
    D.colores.forEach(c => { if (c.cliente) get(c.cliente); });
    (D.ordenes || []).forEach(o => { if (o.cliente) get(o.cliente); });
    return [...m.values()].sort((a, b) => b.ultima.localeCompare(a.ultima) || b.kg - a.kg);
  }

  // colores que el cliente ha producido (o tiene asignados), con historial
  function coloresDeCliente(cli) {
    const porCod = new Map();
    D.producciones.filter(p => clienteProd(p) === cli).forEach(p => {
      const s = porCod.get(p.codigo) || { n: 0, kg: 0, ultima: '', ultimoKg: 0 };
      s.n++; s.kg += num(p.kg);
      if (p.fecha >= s.ultima) { s.ultima = p.fecha; s.ultimoKg = num(p.kg); }
      porCod.set(p.codigo, s);
    });
    // todas las fichas de cada código (variantes como SUN o MIXTO tienen fórmula propia);
    // los duplicados exactos se ocultan
    const ocultos = new Set(duplicados().map(c => c.id));
    const lista = [], vistos = new Set();
    porCod.forEach((s, cod) => D.colores.filter(c => c.codigo === cod && !ocultos.has(c.id)).forEach(c => { vistos.add(c.id); lista.push({ c, ...s }); }));
    D.colores.filter(c => c.cliente === cli && !vistos.has(c.id) && !ocultos.has(c.id)).forEach(c => lista.push({ c, n: 0, kg: 0, ultima: '', ultimoKg: 0 }));
    return lista.sort((a, b) => ordenAlfa(a.c.nombre, b.c.nombre));
  }

  function nuevaOrden() {
    wiz = null;
    qCli = ''; qCol = ''; tab = 'orden'; colorAbierto = null; ordenAbierta = null; dibujar();
  }

  function envaseSugerido(c, kg) {
    if (c.envase && c.envase.mp) return { [c.envase.mp]: Math.ceil(kg / (c.envase.kg || 1)) };
    return {};
  }

  function stepper() {
    return `<div class="pk-steps">${PASOS.map((p, i) => {
      const n = i + 1, st = n < wiz.paso ? 'hecho' : n === wiz.paso ? 'actual' : '';
      const clic = n < wiz.paso ? `data-act="ir-paso" data-paso="${n}"` : '';
      return `<button class="pk-step ${st}" ${clic} ${clic ? '' : 'disabled'}><span>${n < wiz.paso ? '✓' : n}</span>${p}</button>`;
    }).join('<i></i>')}</div>`;
  }

  function vistaOrden() {
    if (!wiz) wiz = { paso: 1, cliente: '', items: [], obs: '', fecha: hoyLocal() };
    const pie = (atras, sig, sigTxt, ok = true, msg = '') => `<div class="pk-wiz-pie">
      ${atras ? `<button class="pk-btn pk-btn-sec" data-act="ir-paso" data-paso="${wiz.paso - 1}">← Atrás</button>` : '<span></span>'}
      ${msg ? `<span class="pk-pie-msg">${msg}</span>` : ''}
      ${sig ? `<button class="pk-btn pk-btn-grande" data-act="ir-paso" data-paso="${wiz.paso + 1}" ${ok ? '' : 'disabled'}>${sigTxt} →</button>` : ''}</div>`;
    const resumenCli = wiz.cliente ? `<div class="pk-wiz-ctx">Cliente: <b>${esc(wiz.cliente)}</b>${wiz.items.length ? ` · ${nf(wiz.items.length)} color${wiz.items.length > 1 ? 'es' : ''} · ${nf(wiz.items.reduce((a, it) => a + (it.kg || 0), 0), 1)} kg` : ''}</div>` : '';

    // ---------- Paso 1: cliente ----------
    if (wiz.paso === 1) {
      const q = norm(qCli);
      const lista = clientesStats().filter(s => !q || norm(s.cliente).includes(q));
      return stepper() + `<div class="pk-wiz-card">
        <h2>¿Para qué cliente es la producción?</h2>
        <p class="pk-sub">Busca el cliente que aparece en el correo de solicitud.</p>
        <input id="pk-qcli" class="pk-search pk-search-grande" type="search" placeholder="Buscar cliente…" value="${esc(qCli)}" autocomplete="off">
        <div class="pk-cli-grid">
          ${lista.map(s => `<button class="pk-cli ${s.cliente === wiz.cliente ? 'sel' : ''}" data-act="elegir-cliente" data-cli="${esc(s.cliente)}">
              <b>${esc(s.cliente)}</b>
              <span>${s.n ? `${nf(s.codigos.size)} colores · ${nf(s.n)} producciones` : 'Sin producciones registradas'}</span>
              <small>${s.ultima ? 'Última: ' + fCorta(s.ultima) + ' · ' + nf(s.kg) + ' kg' : '&nbsp;'}</small></button>`).join('')}
          ${q && !lista.some(s => norm(s.cliente) === q) ? `<button class="pk-cli pk-cli-nuevo" data-act="elegir-cliente" data-cli="${esc(normCli(qCli))}"><b>＋ ${esc(normCli(qCli))}</b><span>Cliente nuevo</span><small>&nbsp;</small></button>`
            : `<button class="pk-cli pk-cli-nuevo" data-act="nuevo-cliente"><b>＋ Nuevo cliente</b><span>Crear un cliente que aún no está</span><small>&nbsp;</small></button>`}
        </div>
        ${!lista.length && !q ? '<p class="pk-vacio">Todavía no hay clientes. Escribe el nombre para crear uno.</p>' : ''}
      </div>`;
    }

    // ---------- Paso 2: colores ----------
    if (wiz.paso === 2) {
      const hist = coloresDeCliente(wiz.cliente);
      const sel = new Set(wiz.items.map(it => it.colorId));
      const q = norm(qCol);
      const otros = q ? D.colores.filter(c => !hist.some(h => h.c.id === c.id || (c.codigo && h.c.codigo === c.codigo)) && norm([c.codigo, c.nombre].join(' ')).includes(q))
        .sort((a, b) => ordenAlfa(a.nombre, b.nombre)).slice(0, 24) : [];
      const card = (c, info) => `<button class="pk-col ${sel.has(c.id) ? 'sel' : ''}" data-act="toggle-color" data-id="${esc(c.id)}">
          ${swatch(c.nombre)}<div><b>${esc(c.nombre)}</b><span>${esc(c.codigo || 'sin código')}</span>${info}</div><em>${sel.has(c.id) ? '✓' : '＋'}</em></button>`;
      return stepper() + resumenCli + `<div class="pk-wiz-card">
        <h2>¿Qué colores vas a producir?</h2>
        <p class="pk-sub">Marca los colores del correo. Abajo puedes buscar colores que este cliente no ha pedido antes.</p>
        <h3>Colores que ha pedido ${esc(wiz.cliente)}</h3>
        ${hist.length ? `<div class="pk-col-grid">${hist.map(h => card(h.c, h.n ? `<small>${nf(h.n)} veces · última ${fCorta(h.ultima)} · ${nf(h.ultimoKg, 1)} kg</small>` : '<small>Asignado al cliente</small>')).join('')}</div>`
          : '<p class="pk-vacio">Este cliente aún no tiene colores. Búscalos abajo.</p>'}
        <h3 class="pk-mt">Buscar otro color</h3>
        <input id="pk-qcol" class="pk-search" type="search" placeholder="Nombre o código del color…" value="${esc(qCol)}" autocomplete="off">
        ${otros.length ? `<div class="pk-col-grid pk-mt-s">${otros.map(c => card(c, `<small>${activo(c) ? '' : 'Inactivo · '}${esc(c.cliente || 'sin cliente')}</small>`)).join('')}</div>` : q ? '<p class="pk-sub">Sin resultados. Si es un color nuevo, créalo en "Colores y fórmulas".</p>' : ''}
      </div>` + pie(true, true, 'Continuar', wiz.items.length > 0);
    }

    // ---------- Paso 3: formulación ----------
    if (wiz.paso === 3) {
      const envases = D.materias.filter(m => m.tipo === 'ENVASE');
      const bloques = wiz.items.map((it, idx) => {
        const c = D.colores.find(x => x.id === it.colorId); if (!c) return '';
        const R = calcular(c, it.kg || 0, it.envases);
        const sumOk = Math.abs(R.sumPct - 1) < 0.0005;
        return `<div class="pk-wiz-card pk-item">
          <div class="pk-item-head">${swatch(c.nombre, 'pk-sw-xl')}
            <div><h2>${esc(c.nombre)}</h2><span class="pk-sub">Código ${esc(c.codigo || '—')}</span></div>
            <label class="pk-kg-big">Kg a producir<input class="pk-in" data-it="${idx}" data-k="kg" inputmode="decimal" value="${String(it.kg ?? '').replace('.', ',')}"></label>
            <button class="pk-x" data-act="quitar-item" data-i="${idx}" title="Quitar color">✕</button></div>
          ${it.kg > 0 ? `<table class="pk-table pk-ftable">
            <thead><tr><th>Código</th><th>Materia prima</th><th class="num">%</th><th class="num">Kg a pesar</th><th class="num">Descontar stock<br><small>+${pct(cfg().merma, 0)} merma</small></th></tr></thead>
            <tbody>${R.filas.map(f => `<tr><td class="pk-gris">${esc(f.m.codigo || '—')}</td><td><b>${esc(f.m.descripcion)}</b></td><td class="num">${pct(f.pct, 2)}</td>
              <td class="num pk-pesar">${nf(f.teo, 3)}</td><td class="num">${nf(f.descontar, 1)}</td></tr>`).join('')}
              <tr class="pk-tot"><td colspan="2">TOTAL</td><td class="num ${sumOk ? '' : 'pk-mal'}">${pct(R.sumPct, 2)}</td><td class="num">${nf(it.kg * R.sumPct, 3)}</td><td class="num">${nf(R.filas.reduce((a, f) => a + f.descontar, 0), 1)}</td></tr></tbody></table>
            ${sumOk ? '' : `<p class="pk-mal">⚠️ La fórmula suma ${pct(R.sumPct, 2)}. Revísala en "Colores y fórmulas" antes de producir.</p>`}
            <h3 class="pk-mt">Envases</h3>
            <div class="pk-env-grid">${envases.map(m => `<label class="pk-env ${it.envases[m.id] ? 'on' : ''}"><span>${esc(m.descripcion)}</span>
              <div class="pk-env-ctrl"><button data-act="env-menos" data-i="${idx}" data-mp="${esc(m.id)}">−</button>
              <input class="pk-in" data-it="${idx}" data-env-it="${esc(m.id)}" inputmode="numeric" value="${it.envases[m.id] || ''}" placeholder="0">
              <button data-act="env-mas" data-i="${idx}" data-mp="${esc(m.id)}">+</button></div></label>`).join('')}</div>
            <div class="pk-item-cost">Costo estimado ${usd(R.costoKg)}/kg · ${clp(R.costoKgClp)}/kg${R.margen !== null ? ` · margen <b class="${R.margen < 0 ? 'pk-mal' : 'pk-ok'}">${pct(R.margen)}</b>` : ''}</div>`
          : '<p class="pk-sub">Ingresa los kilos para ver la formulación.</p>'}
        </div>`;
      }).join('');
      const ok = wiz.items.length && wiz.items.every(it => it.kg > 0 && tieneEnvases(it));
      const faltan = wiz.items.filter(it => it.kg > 0 && !tieneEnvases(it)).map(it => (D.colores.find(x => x.id === it.colorId) || {}).nombre).filter(Boolean);
      const avisoEnv = faltan.length ? `⚠️ Falta indicar envases de <b>${faltan.map(esc).join(', ')}</b>` : '';
      return stepper() + resumenCli + bloques + pie(true, true, 'Revisar orden', ok, avisoEnv);
    }

    // ---------- Paso 4: revisar ----------
    const filas = wiz.items.map((it, idx) => {
      const c = D.colores.find(x => x.id === it.colorId) || { nombre: '?' };
      const env = Object.entries(it.envases).filter(([, n]) => n > 0).map(([id, n]) => `${nf(n)} × ${esc((MP.get(id) || {}).descripcion || id)}`).join('<br>') || '<span class="pk-gris">Sin envases</span>';
      return `<tr><td>${swatch(c.nombre)} <b>${esc(c.nombre)}</b><br><small class="pk-gris">${esc(c.codigo || '')}</small></td>
        <td class="num"><b>${nf(it.kg, 1)}</b></td><td>${env}</td>
        <td><input class="pk-in pk-in-batch" data-it="${idx}" data-k="batch" value="${esc(it.batch || '')}" placeholder="Opcional"></td></tr>`;
    }).join('');
    const consumo = consumoOrden(wiz);
    return stepper() + resumenCli + `<div class="pk-wiz-card">
        <h2>Revisa la orden</h2>
        <div class="pk-form pk-mt-s">
          <label>Fecha<input class="pk-in" type="date" data-w="fecha" value="${esc(wiz.fecha)}"></label>
          <label class="pk-ancho">Observaciones para el técnico<input class="pk-in" data-w="obs" value="${esc(wiz.obs)}" placeholder="Ej: con despacho, urgente, revisar tono…"></label>
        </div>
        <table class="pk-table pk-mt"><thead><tr><th>Color</th><th class="num">Kg</th><th>Envases</th><th>Batch</th></tr></thead><tbody>${filas}
          <tr class="pk-tot"><td>TOTAL</td><td class="num">${nf(wiz.items.reduce((a, it) => a + it.kg, 0), 1)}</td><td colspan="2"></td></tr></tbody></table>
        <h3 class="pk-mt">Descuento de stock de la orden <small class="pk-gris">(${nf(consumo.length)} productos)</small></h3>${tablaConsumo(consumo)}
      </div>
      <div class="pk-wiz-pie"><button class="pk-btn pk-btn-sec" data-act="ir-paso" data-paso="3">← Atrás</button>
        <div class="pk-head-btns"><button class="pk-btn pk-btn-sec pk-btn-grande" data-act="guardar-orden">Solo guardar</button>
        <button class="pk-btn pk-btn-grande" data-act="guardar-imprimir">🖨️ Guardar e imprimir</button></div></div>`;
  }

  // consumo total de materias primas y envases de una orden (para descontar stock)
  function consumoOrden(o) {
    const m = new Map();
    o.items.forEach(it => {
      const c = D.colores.find(x => x.id === it.colorId) || (it.snapshot ? it.snapshot : null); if (!c) return;
      const R = calcular(c, it.kg || 0, it.envases);
      R.filas.forEach(f => { const x = m.get(f.mp) || { m: f.m, cant: 0, um: 'kg' }; x.cant += f.teo * (1 + cfg().merma); m.set(f.mp, x); });
      R.env.forEach(e => { const x = m.get(e.mp) || { m: e.m, cant: 0, um: 'un' }; x.cant += e.n; m.set(e.mp, x); });
    });
    return [...m.values()].sort((a, b) => (a.um === b.um ? 0 : a.um === 'un' ? 1 : -1) || norm(a.m.descripcion).localeCompare(norm(b.m.descripcion)));
  }
  const tablaConsumo = cons => `<table class="pk-table pk-mini pk-mt-s"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th>UM</th></tr></thead><tbody>
    ${cons.map(x => `<tr><td>${esc(x.m.codigo || '—')}</td><td>${esc(x.m.descripcion)}</td><td class="num"><b>${x.um === 'kg' ? nf(Math.round(x.cant * 10) / 10, 1) : nf(x.cant)}</b></td><td>${x.um}</td></tr>`).join('')}</tbody></table>`;

  const tieneEnvases = it => Object.values(it.envases || {}).some(n => Number(n) > 0);

  function irPaso(n) {
    if (n === 2 && !wiz.cliente) return;
    if (n === 3 && !wiz.items.length) return;
    if (n === 4 && !wiz.items.every(it => it.kg > 0 && tieneEnvases(it))) return;
    wiz.paso = n; dibujar(); window.scrollTo(0, 0);
  }

  async function guardarOrden(imprimirDespues = false) {
    const o = { id: wiz.id || '', numero: wiz.numero || '', fecha: wiz.fecha, cliente: wiz.cliente, estado: wiz.estado || 'pendiente', obs: wiz.obs,
      items: wiz.items.map(it => { const c = D.colores.find(x => x.id === it.colorId) || {}; return { ...it, codigo: c.codigo || '', nombre: c.nombre || '' }; }) };
    try {
      aviso('Guardando orden…');
      const d = await api('guardarOrden', { item: o });
      o.id = d.id || o.id || 'O' + Date.now();
      o.numero = d.numero || o.numero || siguienteNumero(o.fecha);
      D.ordenes = (D.ordenes || []).filter(x => x.id !== o.id).concat(o);
      wiz = null; ordenAbierta = o.id; tab = 'ordenes'; dibujar();
      if (imprimirDespues) imprimir(o);
      aviso(`✅ Orden ${esc(o.numero)} guardada${modo === 'local' ? ' (vista previa, no se guarda)' : ''}. Ya puedes imprimirla.`, 'ok');
    } catch (err) {
      aviso(/no válida/i.test(err.message) ? '⚠️ Falta actualizar el Apps Script: pega la versión nueva de gas/ProduccionKaoAPI.gs y crea una nueva versión de la implementación.' : '⚠️ ' + esc(err.message), 'err');
    }
  }
  function siguienteNumero(fecha) {
    const y = String(fecha).slice(0, 4);
    const n = (D.ordenes || []).filter(o => String(o.numero).startsWith('OP-' + y)).map(o => Number(String(o.numero).split('-')[2]) || 0);
    return `OP-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0')}`;
  }

  // ---------- Lista de órdenes ----------
  function vistaOrdenes() {
    if (ordenAbierta) return detalleOrden();
    const lista = (D.ordenes || []).filter(o => fEstOrd === 'todas' || (fEstOrd === 'abiertas' ? ['pendiente', 'produccion'].includes(o.estado) : o.estado === fEstOrd))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.numero).localeCompare(String(a.numero)));
    return `<div class="pk-filtros"><label>Estado<select data-f="estord">${[['abiertas', 'Pendientes y en producción'], ['producida', 'Producidas'], ['anulada', 'Anuladas'], ['todas', 'Todas']].map(([k, t]) => `<option value="${k}" ${k === fEstOrd ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="pk-btn" data-act="nueva-orden">＋ Nueva orden</button></div>
      ${lista.length ? `<div class="pk-ord-list">${lista.map(o => `<button class="pk-ord" data-act="abrir-orden" data-id="${esc(o.id)}">
          <div class="pk-ord-top"><b>${esc(o.numero || '—')}</b><span class="pk-est pk-est-${esc(o.estado)}">${ESTADOS_OP[o.estado] || o.estado}</span></div>
          <div class="pk-ord-cli">${esc(o.cliente)}</div>
          <div class="pk-ord-sw">${o.items.map(it => swatch(it.nombre)).join('')}</div>
          <small>${fCorta(o.fecha)} · ${nf(o.items.length)} color${o.items.length > 1 ? 'es' : ''} · ${nf(o.items.reduce((a, it) => a + num(it.kg), 0), 1)} kg</small></button>`).join('')}</div>`
        : `<div class="pk-wiz-card pk-vacio">No hay órdenes ${fEstOrd === 'abiertas' ? 'abiertas' : 'en este estado'}.<br><br><button class="pk-btn pk-btn-grande" data-act="nueva-orden">＋ Crear orden de producción</button></div>`}`;
  }

  function detalleOrden() {
    const o = (D.ordenes || []).find(x => x.id === ordenAbierta); if (!o) { ordenAbierta = null; return vistaOrdenes(); }
    return `<div class="pk-ficha-head"><button class="pk-btn pk-btn-sec" data-act="cerrar-orden">← Órdenes</button>
        <h2>${esc(o.numero)} · ${esc(o.cliente)}</h2>
        <div class="pk-head-btns"><button class="pk-btn pk-btn-sec" data-act="editar-orden">✏️ Editar</button><button class="pk-btn" data-act="imprimir-orden">🖨️ Imprimir formulación</button></div></div>
      <div class="pk-wiz-card">
        <div class="pk-ficha-info">
          <div><span>Fecha</span><b>${fCorta(o.fecha)}</b></div>
          <div><span>Kg totales</span><b>${nf(o.items.reduce((a, it) => a + num(it.kg), 0), 1)}</b></div>
          <div><span>Estado</span><b><select class="pk-in" data-ord-estado="${esc(o.id)}">${Object.entries(ESTADOS_OP).map(([k, t]) => `<option value="${k}" ${k === o.estado ? 'selected' : ''}>${t}</option>`).join('')}</select></b></div>
        </div>
        ${o.obs ? `<p class="pk-sub pk-mt-s">📝 ${esc(o.obs)}</p>` : ''}
        <table class="pk-table pk-mt"><thead><tr><th>Color</th><th class="num">Kg</th><th>Envases</th><th>Batch</th></tr></thead><tbody>
        ${o.items.map(it => `<tr><td>${swatch(it.nombre)} <b>${esc(it.nombre)}</b> <small class="pk-gris">${esc(it.codigo)}</small></td><td class="num">${nf(it.kg, 1)}</td>
          <td>${Object.entries(it.envases || {}).filter(([, n]) => n > 0).map(([id, n]) => `${nf(n)} × ${esc((MP.get(id) || {}).descripcion || id)}`).join('<br>') || '—'}</td><td>${esc(it.batch || '—')}</td></tr>`).join('')}</tbody></table>
        <h3 class="pk-mt">Descuento de stock</h3>${tablaConsumo(consumoOrden(o))}
      </div>
      <p class="pk-mt"><button class="pk-btn pk-btn-peligro" data-act="borrar-orden">Eliminar orden</button></p>`;
  }

  async function cambiarEstadoOrden(id, estado) {
    const o = (D.ordenes || []).find(x => x.id === id); if (!o) return;
    o.estado = estado;
    try { await api('guardarOrden', { item: o }); aviso('✅ Estado actualizado', 'ok'); } catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  // ---------- Impresión ----------
  function imprimir(o) {
    const k = cfg();
    const encabezado = titulo => `<header>
        <img class="logo" src="${LOGO_URL}" alt="Distribuidora Walter Lund">
        <div class="tit"><b>${titulo}</b><span>Kao Chimigraf</span></div>
        <div class="op"><small>N° orden</small><b>${esc(o.numero || 'BORRADOR')}</b><span>${fCorta(o.fecha)}</span></div></header>`;
    const hoja = it => {
      const c = D.colores.find(x => x.id === it.colorId); if (!c) return '';
      const R = calcular(c, num(it.kg), it.envases || {});
      const env = R.env.length ? R.env.map(e => `<tr><td class="ck">☐</td><td>${esc(e.m.codigo || '')}</td><td>${esc(e.m.descripcion)}</td><td class="n"><b>${nf(e.n)}</b> un</td></tr>`).join('') : '<tr><td colspan="4" class="gris">Sin envases indicados</td></tr>';
      const sw = swatchColor(c.nombre);
      return `<section class="hoja">
        ${encabezado('Orden de producción')}
        <div class="cab">
          <div class="sw ${sw === 'transp' ? 'transp' : ''}" style="${sw === 'transp' ? '' : 'background:' + sw}"></div>
          <div class="cn"><small>Color</small><h1>${esc(c.nombre)}</h1><span>Código ${esc(c.codigo || '—')}${it.batch ? ' · Batch ' + esc(it.batch) : ''}</span></div>
          <div class="kg"><small>Producir</small><b>${nf(num(it.kg), num(it.kg) % 1 ? 1 : 0)}</b><span>kg</span></div>
        </div>
        <div class="cli"><span>Cliente</span><b>${esc(o.cliente)}</b>${o.obs ? `<span>Obs.</span><b>${esc(o.obs)}</b>` : ''}</div>
        <h2>Formulación</h2>
        <table><thead><tr><th class="ck">✓</th><th>Código</th><th>Materia prima</th><th class="n">%</th><th class="n">Kg a pesar</th><th class="n">Kg real</th></tr></thead>
          <tbody>${R.filas.map(f => `<tr><td class="ck">☐</td><td>${esc(f.m.codigo || '')}</td><td><b>${esc(f.m.descripcion)}</b></td><td class="n">${pct(f.pct, 2)}</td><td class="n big">${nf(f.teo, 3)}</td><td class="n linea"></td></tr>`).join('')}
          <tr class="tot"><td></td><td colspan="2">TOTAL</td><td class="n">${pct(R.sumPct, 2)}</td><td class="n big">${nf(num(it.kg) * R.sumPct, 3)}</td><td class="n linea"></td></tr></tbody></table>
        <h2>Envases</h2>
        <table><tbody>${env}</tbody></table>
        <div class="firmas">
          <div><span>Kg obtenidos</span></div><div><span>Fecha y hora de término</span></div><div><span>Técnico (nombre y firma)</span></div>
        </div>
        <div class="obs"><span>Observaciones del técnico</span></div>
        <footer>Impreso ${new Date().toLocaleString('es-CL')} · Merma considerada para stock: ${pct(k.merma, 0)}</footer>
      </section>`;
    };
    const cons = consumoOrden(o);
    const resumen = `<section class="hoja">
        ${encabezado('Descuento de stock')}
        <div class="cli"><span>Cliente</span><b>${esc(o.cliente)}</b><span>Colores</span><b>${o.items.map(it => esc(it.nombre || (D.colores.find(x => x.id === it.colorId) || {}).nombre) + ' (' + nf(num(it.kg), 1) + ' kg)').join(' · ')}</b></div>
        <h2>Productos a descontar (incluye ${pct(k.merma, 0)} de merma)</h2>
        <table><thead><tr><th>Código</th><th>Producto</th><th class="n">Cantidad</th><th>UM</th></tr></thead>
          <tbody>${cons.map(x => `<tr><td>${esc(x.m.codigo || '—')}</td><td>${esc(x.m.descripcion)}</td><td class="n big">${x.um === 'kg' ? nf(Math.round(x.cant * 10) / 10, 1) : nf(x.cant)}</td><td>${x.um}</td></tr>`).join('')}</tbody></table>
        <footer>Impreso ${new Date().toLocaleString('es-CL')}</footer></section>`;
    let el = document.getElementById('pk-print');
    if (!el) { el = document.createElement('div'); el.id = 'pk-print'; document.body.appendChild(el); }
    el.innerHTML = o.items.map(hoja).join('') + resumen;
    // espera a que cargue el logo para que salga en la impresión
    const img = el.querySelector('img.logo');
    const go = () => setTimeout(() => window.print(), 50);
    if (!img || img.complete) go();
    else { let hecho = false; const una = () => { if (!hecho) { hecho = true; go(); } }; img.onload = una; img.onerror = una; setTimeout(una, 2500); }
  }

  // =====================================================
  // EVENTOS
  // =====================================================
  async function onClick(e) {
    const t = e.target.closest('[data-tab]');
    if (t) {
      if (t.dataset.tab === 'orden' && tab === 'orden' && wiz && wiz.paso > 1) {
        if (!confirm('¿Empezar una orden nueva? Se pierde la que estás armando.')) return;
        wiz = null;
      }
      tab = t.dataset.tab; colorAbierto = null; editando = false; ordenAbierta = null; busqueda = ''; visibles = PAGINA; dibujar(); return;
    }
    const fila = e.target.closest('tr[data-color]');
    if (fila) { abrirColor(fila.dataset.color); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (a.tagName === 'A') e.preventDefault();
    if (act === 'seed') cargarSeedEnBase();
    if (act === 'vista-res') { vistaRes = a.dataset.v; if (vistaRes === 'anio' && mesRes) anio = mesRes.slice(0, 4); dibujar(); return; }
    if (act === 'confirmar') confirmarImport();
    if (act === 'confirmar-correos') confirmarCorreos();
    if (act === 'cancelar-correos') { pendienteCorreos = null; dibujar(); }
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
    if (act === 'borrar-duplicados') borrarDuplicados();
    // --- órdenes ---
    if (act === 'nueva-orden') nuevaOrden();
    if (act === 'nuevo-cliente') {
      const nombre = prompt('Nombre del cliente nuevo (como aparece en el correo):', '');
      if (!nombre || !nombre.trim()) return;
      const nuevo = normCli(nombre);
      const existe = clientesStats().find(s => norm(s.cliente) === norm(nuevo));
      if (wiz.cliente !== (existe ? existe.cliente : nuevo)) wiz.items = [];
      wiz.cliente = existe ? existe.cliente : nuevo; qCol = ''; irPaso(2); return;
    }
    if (act === 'elegir-cliente') { if (wiz.cliente !== a.dataset.cli) wiz.items = []; wiz.cliente = a.dataset.cli; qCol = ''; irPaso(2); }
    if (act === 'ir-paso') irPaso(Number(a.dataset.paso));
    if (act === 'toggle-color') {
      const id = a.dataset.id, i = wiz.items.findIndex(it => it.colorId === id);
      if (i >= 0) wiz.items.splice(i, 1);
      else {
        const c = D.colores.find(x => x.id === id);
        const h = coloresDeCliente(wiz.cliente).find(x => x.c.id === id);
        const kg = h && h.ultimoKg ? h.ultimoKg : 0;
        wiz.items.push({ colorId: id, kg, batch: '', envases: envaseSugerido(c, kg) });
      }
      dibujar();
    }
    if (act === 'quitar-item') { wiz.items.splice(Number(a.dataset.i), 1); if (!wiz.items.length) wiz.paso = 2; dibujar(); }
    if (act === 'env-mas' || act === 'env-menos') {
      e.preventDefault();
      const it = wiz.items[Number(a.dataset.i)], mp = a.dataset.mp;
      const n = Math.max(0, (it.envases[mp] || 0) + (act === 'env-mas' ? 1 : -1));
      if (n) it.envases[mp] = n; else delete it.envases[mp];
      dibujar();
    }
    if (act === 'imprimir-wiz') imprimir({ numero: wiz.numero || '', fecha: wiz.fecha, cliente: wiz.cliente, obs: wiz.obs, items: wiz.items.map(it => ({ ...it, nombre: (D.colores.find(x => x.id === it.colorId) || {}).nombre })) });
    if (act === 'guardar-orden') guardarOrden();
    if (act === 'guardar-imprimir') guardarOrden(true);
    if (act === 'abrir-orden') { ordenAbierta = a.dataset.id; dibujar(); window.scrollTo(0, 0); }
    if (act === 'cerrar-orden') { ordenAbierta = null; dibujar(); }
    if (act === 'imprimir-orden') { const o = D.ordenes.find(x => x.id === ordenAbierta); if (o) imprimir(o); }
    if (act === 'editar-orden') {
      const o = D.ordenes.find(x => x.id === ordenAbierta); if (!o) return;
      wiz = { ...JSON.parse(JSON.stringify(o)), paso: 3 };
      wiz.items = wiz.items.filter(it => D.colores.some(c => c.id === it.colorId));
      tab = 'orden'; ordenAbierta = null; dibujar();
    }
    if (act === 'borrar-orden') {
      if (!confirm('¿Eliminar esta orden?')) return;
      try { await api('borrarOrden', { id: ordenAbierta }); D.ordenes = D.ordenes.filter(o => o.id !== ordenAbierta); ordenAbierta = null; dibujar(); aviso('Orden eliminada', 'ok'); }
      catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
    }
  }

  async function nuevaProduccion() {
    const cod = prompt('Código del color producido:'); if (!cod) return;
    const c = colorDe(cod.trim()); if (!c) { aviso('⚠️ No hay un color con el código ' + esc(cod), 'err'); return; }
    const kg = numIn(prompt(`Kg producidos de ${c.nombre}:`)); if (!kg) return;
    const fecha = prompt('Fecha (AAAA-MM-DD):', new Date().toLocaleDateString('sv-SE')); if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return;
    const folio = prompt('Folio de la guía de recepción (opcional):') || '';
    const p = { fecha, folio, codigo: c.codigo, descripcion: c.nombre, kg, pu: 0, total: 0, cliente: c.cliente || '', origen: 'manual', obs: '' };
    try { const d = await api('guardarProduccion', { item: p }); D.producciones.push({ id: d.id || 'L' + Date.now(), ...p }); indexar(); dibujar(); aviso('✅ Producción registrada', 'ok'); }
    catch (err) { aviso('⚠️ ' + esc(err.message), 'err'); }
  }

  async function onChange(e) {
    const el = e.target;
    if (el.id === 'pk-file' && el.files[0]) { leerArchivo(el.files[0]); el.value = ''; return; }
    if (el.id === 'pk-mail' && el.files[0]) { leerCorreos(el.files[0]); el.value = ''; return; }
    if (el.dataset.f === 'anio') { anio = el.value; visibles = PAGINA; dibujar(); return; }
    if (el.dataset.f === 'mesres') { mesRes = el.value; dibujar(); return; }
    if (el.dataset.f === 'cliente') { fCliente = el.value; visibles = PAGINA; dibujar(); return; }
    if (el.dataset.f === 'estado') { fEstado = el.value; dibujar(); return; }
    if (el.dataset.f === 'estord') { fEstOrd = el.value; dibujar(); return; }
    if (el.dataset.ordEstado) { cambiarEstadoOrden(el.dataset.ordEstado, el.value); return; }
    if (wiz && el.dataset.w) { wiz[el.dataset.w] = el.value; return; }
    if (wiz && el.dataset.it !== undefined) {
      const it = wiz.items[Number(el.dataset.it)]; if (!it) return;
      if (el.dataset.envIt) { const n = numIn(el.value); if (n) it.envases[el.dataset.envIt] = n; else delete it.envases[el.dataset.envIt]; dibujar(); return; }
      if (el.dataset.k === 'batch') { it.batch = el.value.trim(); return; }
      if (el.dataset.k === 'kg') {
        it.kg = numIn(el.value) || 0;
        const c = D.colores.find(x => x.id === it.colorId);
        if (c && c.envase) it.envases = { ...it.envases, ...envaseSugerido(c, it.kg) };
        dibujar(); return;
      }
    }
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
    if (e.target.id === 'pk-qcli' || e.target.id === 'pk-qcol') {
      const id = e.target.id;
      if (id === 'pk-qcli') qCli = e.target.value; else qCol = e.target.value;
      clearTimeout(tBuscar);
      tBuscar = setTimeout(() => { dibujar(); const b = root.querySelector('#' + id); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 200);
      return;
    }
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
      .pk-seg{display:inline-flex;gap:2px;padding:4px;background:#fff;border:1px solid #e1e5ea;border-radius:10px}
      .pk-seg button{border:0;background:none;padding:6px 12px;border-radius:7px;font:inherit;font-size:13px;font-weight:600;color:#5b6b7a;cursor:pointer}
      .pk-seg button.on{background:#1565c0;color:#fff}
      .pk-chart-baja{height:220px}
      .pk-kpi small.pk-up{color:#15803d;font-weight:600}.pk-kpi small.pk-down{color:#b91c1c;font-weight:600}
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
      .pk-btn-grande{padding:13px 22px;font-size:15px}
      .pk-mt-s{margin-top:10px}
      .pk-steps{display:flex;align-items:center;gap:0;margin:0 0 18px;overflow-x:auto}
      .pk-steps i{flex:1;min-width:16px;height:2px;background:#e5e7eb}
      .pk-step{display:flex;align-items:center;gap:8px;background:none;border:0;padding:6px 8px;font-weight:600;color:#9ca3af;white-space:nowrap;font-size:14px}
      .pk-step span{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#e5e7eb;color:#6b7280;font-size:13px}
      .pk-step.actual{color:#1f2937}.pk-step.actual span{background:#4f5bd5;color:#fff;box-shadow:0 0 0 4px rgba(79,91,213,.18)}
      .pk-step.hecho{color:#1e7b34;cursor:pointer}.pk-step.hecho span{background:#1e7b34;color:#fff}
      .pk-wiz-card{background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
      .pk-wiz-card h2{margin:0 0 4px;font-size:20px}
      .pk-wiz-card h3{margin:18px 0 10px;font-size:14px;color:#374151;text-transform:uppercase;letter-spacing:.03em}
      .pk-wiz-ctx{background:#eef2ff;color:#3730a3;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:14px}
      .pk-wiz-pie{display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;bottom:0;background:linear-gradient(transparent,#f0f2f5 30%);padding:18px 0 6px;z-index:2}
      .pk-search-grande{max-width:none;width:100%;font-size:17px;padding:13px 16px;margin:10px 0 16px}
      .pk-cli-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
      .pk-cli{display:flex;flex-direction:column;gap:4px;text-align:left;background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer;transition:.15s}
      .pk-cli:hover{border-color:#667eea;box-shadow:0 4px 14px rgba(79,91,213,.12);transform:translateY(-1px)}
      .pk-cli b{font-size:16px}.pk-cli span{font-size:13px;color:#4b5563}.pk-cli small{font-size:12px;color:#9ca3af}
      .pk-cli.sel{border-color:#4f5bd5;background:#f5f6ff}
      .pk-cli-nuevo{border-style:dashed;border-color:#1e7b34}.pk-cli-nuevo b{color:#1e7b34}
      .pk-col-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
      .pk-col{display:flex;align-items:center;gap:12px;text-align:left;background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:12px 14px;cursor:pointer;transition:.15s}
      .pk-col:hover{border-color:#667eea}
      .pk-col div{flex:1;min-width:0}.pk-col b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pk-col span{display:block;font-size:12px;color:#6b7280}.pk-col small{display:block;font-size:11px;color:#9ca3af;margin-top:2px}
      .pk-col em{font-style:normal;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#f3f4f6;color:#6b7280;font-weight:700}
      .pk-col.sel{border-color:#1e7b34;background:#f0fdf4}.pk-col.sel em{background:#1e7b34;color:#fff}
      .pk-sw{display:inline-block;flex:none;width:30px;height:30px;border-radius:50%;background:var(--sw);border:2px solid #fff;box-shadow:0 0 0 1px #d1d5db;vertical-align:middle}
      .pk-sw-transp{background:repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/10px 10px}
      .pk-sw-xl{width:52px;height:52px}
      .pk-ord-sw .pk-sw{width:18px;height:18px;margin-right:-5px}
      .pk-item-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}
      .pk-item-head>div{flex:1}.pk-item-head h2{font-size:19px}
      .pk-kg-big{display:flex;flex-direction:column;font-size:12px;color:#6b7280;gap:4px;font-weight:600}
      .pk-kg-big input{width:130px;font-size:24px;font-weight:700;text-align:right;padding:8px 12px;border:2px solid #4f5bd5;border-radius:10px}
      .pk-ftable td{padding:10px}
      .pk-pesar{font-size:16px;font-weight:700;color:#1e3a8a;background:#eff6ff}
      .pk-env-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
      .pk-env{display:flex;flex-direction:column;gap:6px;border:1.5px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:12px;color:#374151}
      .pk-env.on{border-color:#1e7b34;background:#f0fdf4}
      .pk-env-ctrl{display:flex;align-items:center;gap:6px}
      .pk-env-ctrl button{width:32px;height:32px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-size:18px;cursor:pointer}
      .pk-env-ctrl input{width:60px;text-align:center;font-size:15px;font-weight:700}
      .pk-item-cost{margin-top:14px;font-size:12px;color:#6b7280;text-align:right}
      .pk-in-batch{width:120px}
      .pk-ord-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
      .pk-ord{display:flex;flex-direction:column;gap:6px;text-align:left;background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer}
      .pk-ord:hover{border-color:#667eea;box-shadow:0 4px 14px rgba(79,91,213,.12)}
      .pk-ord-top{display:flex;justify-content:space-between;align-items:center}
      .pk-ord-cli{font-size:16px;font-weight:700}.pk-ord small{color:#6b7280}
      .pk-est{font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;background:#f1f5f9;color:#475569}
      .pk-est-pendiente{background:#fef3c7;color:#92400e}.pk-est-produccion{background:#dbeafe;color:#1e40af}
      .pk-est-producida{background:#dcfce7;color:#166534}.pk-est-anulada{background:#fee2e2;color:#991b1b}
      .pk-pie-msg{flex:1;text-align:right;color:#b91c1c;font-size:13px;margin:0 12px}
      #pk-print{display:none}
      @media print{
        @page{size:A4;margin:10mm}
        html,body{background:#fff!important;margin:0!important;padding:0!important}
        body>*:not(#pk-print){display:none!important}
        #pk-print{display:block!important;font-family:Arial,Helvetica,sans-serif;color:#111}
        #pk-print .hoja{page-break-after:always;break-after:page}
        #pk-print .hoja:last-child{page-break-after:auto;break-after:auto}
        #pk-print .hoja{border:1.5px solid #111;border-radius:10px;padding:8mm 9mm;box-sizing:border-box}
        #pk-print header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;border-bottom:2px solid #1e3a8a;padding-bottom:10px;margin-bottom:14px}
        #pk-print .logo{height:46px;width:auto;display:block}
        #pk-print .tit{text-align:center}#pk-print .tit b{display:block;font-size:16px;text-transform:uppercase;letter-spacing:.06em}#pk-print .tit span{font-size:11px;color:#555}
        #pk-print .op{text-align:right;border:1.5px solid #111;border-radius:6px;padding:4px 10px;min-width:110px}
        #pk-print .op small{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#555}
        #pk-print .op b{display:block;font-size:17px}#pk-print .op span{font-size:11px}
        #pk-print .cab{display:flex;align-items:center;gap:16px;border:2px solid #111;border-radius:10px;padding:14px 18px}
        #pk-print .sw{width:64px;height:64px;border-radius:50%;border:2px solid #111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        #pk-print .sw.transp{background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px}
        #pk-print .cn{flex:1}#pk-print .cn small,#pk-print .kg small{display:block;font-size:10px;text-transform:uppercase;color:#555;letter-spacing:.08em}
        #pk-print .cn h1{margin:2px 0;font-size:26px}#pk-print .cn span{font-size:13px}
        #pk-print .kg{text-align:right}#pk-print .kg b{font-size:40px;line-height:1}#pk-print .kg span{font-size:16px;font-weight:700;margin-left:4px}
        #pk-print .cli{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0;font-size:13px}
        #pk-print .cli span{color:#555}
        #pk-print h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
        #pk-print table{width:100%;border-collapse:collapse;font-size:13px}
        #pk-print th{background:#eee;text-align:left;padding:6px 8px;border:1px solid #999;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        #pk-print td{padding:8px;border:1px solid #999}
        #pk-print .n{text-align:right}#pk-print .big{font-size:17px;font-weight:800}
        #pk-print .ck{width:26px;text-align:center;font-size:16px}
        #pk-print .linea{width:90px}
        #pk-print .tot td{font-weight:800;background:#f3f3f3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        #pk-print .gris{color:#777}
        #pk-print .firmas{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:26px}
        #pk-print .firmas div{border-bottom:1px solid #111;height:46px;position:relative}
        #pk-print .firmas span,#pk-print .obs span{position:absolute;bottom:-17px;font-size:10px;color:#555}
        #pk-print .obs{border:1px solid #999;height:80px;margin-top:30px;position:relative}
        #pk-print .obs span{top:4px;left:8px;bottom:auto}
        #pk-print footer{margin-top:14px;font-size:9px;color:#777}
      }
      @media (max-width:700px){.pk-item-head{flex-wrap:wrap}.pk-kg-big input{width:110px}.pk-wiz-card{padding:16px}.pk-step{font-size:0;gap:0}.pk-step span{font-size:13px}.pk-step.actual{font-size:13px;gap:6px}}
      @media (max-width:900px){.pk-grid2{grid-template-columns:1fr}.pk-head,.pk-ficha-head{flex-direction:column;align-items:stretch}.pk-prev-grid{grid-template-columns:1fr 1fr}.pk-form .pk-ancho{grid-column:auto}}
      @media (max-width:700px){.pk{padding:0}.pk-head h1{font-size:19px}.pk-kpis{grid-template-columns:1fr 1fr}.pk-kpi strong{font-size:20px}.pk-search{max-width:none;font-size:16px}.pk-filtros label{flex:1}}
    `;
    document.head.appendChild(s);
  }

  return { render, _parsearInforme: parsearInforme, _calcular: calcular };
})();
