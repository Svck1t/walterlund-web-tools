// Lógica de Control de Compras (de control-ingresos-wl.vercel.app), adaptada para
// correr dentro del Shadow DOM de walterlund-web-tools:
// - document.getElementById/querySelectorAll -> root.* (root = shadow root)
// - URL del Apps Script fija (se quitó la pantalla de configuración y el modal de URL)
// Misma hoja y mismo Apps Script que usaba control-ingresos-wl.vercel.app (no es una copia de los datos)
const API_URL = 'https://script.google.com/macros/s/AKfycbzyyt5rYoEbLCvdVQ-AjKSk6_EUarexL3SXd5HIdC_XAuSMB6MCxfIQxv5amlOWa1xQ/exec';

const ESTADOS = {
  pendiente: { label: 'Pendiente', cls: 'estado-pendiente' },
  recibido:  { label: 'Recibido',  cls: 'estado-recibido' },
  facturado: { label: 'Facturado', cls: 'estado-facturado' },
};

let entries = [];
let documentos = [];   // facturas/boletas reales (hoja Documentos)
let eliminados = [];   // papelera
let editingId = null;
let confirmDeleteId = null;
let vista = 'lista';
let filtros = { mes: monthOf(today()), sucursal: '', proveedor: '', estado: 'todos', busqueda: '' };

// Sucursales que recepcionan compras. Cada equipo recuerda la última sucursal usada.
const SUCURSALES = ['San Francisco', 'Aldunate', 'Viel', 'San Ignacio'];
const SUCURSAL_KEY = 'compras-sucursal-equipo';
function sucursalEquipo() { try { return localStorage.getItem(SUCURSAL_KEY) || ''; } catch { return ''; } }
function guardarSucursalEquipo(s) { try { localStorage.setItem(SUCURSAL_KEY, s); } catch {} }
const MESES_TXT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function mesTxt(m) { const [y, mm] = m.split('-'); return MESES_TXT[Number(mm) - 1] + ' ' + y.slice(2); }
function mesAnterior(m, n = 1) { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 - n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
let fotoPendienteBase64 = null;
let fotoPendienteMime = null;

function today() { return new Date().toISOString().slice(0,10); }
function monthOf(d) { return (d||'').slice(0,7); }
function fmtCLP(n) { return new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(n)||0); }
function fmtCorto(n) { n = Number(n) || 0; if (n >= 1e6) return '$' + (n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M'; if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k'; return '$' + Math.round(n); }
function fmtNum(n) { return new Intl.NumberFormat('es-CL',{maximumFractionDigits:2}).format(Number(n)||0); }
function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
function uid() { return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

// ----------- API -----------
async function apiGet() {
  const res = await fetch(API_URL, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
async function apiPost(body, timeoutMs) {
  // No establecer Content-Type para evitar preflight CORS con Apps Script
  const ctrl = timeoutMs ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini tardó demasiado en responder');
    throw err;
  } finally { if (t) clearTimeout(t); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

// ----------- Sync UI -----------
function setSyncStatus(state, label) {
  const pill = root.getElementById('sync-status');
  const lbl = root.getElementById('sync-label');
  pill.classList.remove('sync-ok','sync-loading','sync-error');
  pill.classList.add('sync-' + state);
  lbl.textContent = label;
}

async function loadEntries() {
  setSyncStatus('loading','Sincronizando…');
  try {
    const data = await apiGet();
    if (!data.ok) throw new Error(data.error || 'Error desconocido');
    entries = (data.entries || []).map(normalize);
    documentos = (data.documentos || []).map(normDoc);
    eliminados = data.eliminados || [];
    setSyncStatus('ok','Sincronizado · ' + new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}));
    render();
  } catch (err) {
    console.error(err);
    setSyncStatus('error','Error · click para reintentar');
    root.getElementById('sync-status').onclick = loadEntries;
  }
}

function normalize(e) {
  return {
    id: String(e.id),
    fecha: String(e.fecha || '').slice(0,10),
    proveedor: String(e.proveedor || ''),
    producto: String(e.producto || ''),
    cantidad: Number(e.cantidad) || 0,
    unidad: String(e.unidad || 'unidad'),
    costoUnitario: Number(e.costoUnitario) || 0,
    estado: ESTADOS[e.estado] ? e.estado : 'pendiente',
    referencia: String(e.referencia || ''),
    notas: String(e.notas || ''),
    fotoUrl: String(e.fotoUrl || ''),
    sucursal: String(e.sucursal || ''),
    grupo: String(e.grupo || ''),
    tipoDoc: ['vale', 'boleta', 'factura'].includes(e.tipoDoc) ? e.tipoDoc : 'vale',
    facturaId: String(e.facturaId || ''),
    creadoEn: Number(e.creadoEn) || Date.now(),
    actualizadoEn: Number(e.actualizadoEn) || Date.now(),
  };
}

// ----------- Lógica filtros / totales -----------
function getFiltered(opt = {}) {
  const q = filtros.busqueda.trim().toLowerCase();
  return entries
    .filter(e => opt.sinMes || !filtros.mes || monthOf(e.fecha) === filtros.mes)
    .filter(e => opt.sinSucursal || !filtros.sucursal || (filtros.sucursal === '-' ? !e.sucursal : e.sucursal === filtros.sucursal))
    .filter(e => !filtros.proveedor || e.proveedor === filtros.proveedor)
    .filter(e => filtros.estado === 'todos' || e.estado === filtros.estado)
    .filter(e => !q || e.producto.toLowerCase().includes(q) || e.proveedor.toLowerCase().includes(q) || e.referencia.toLowerCase().includes(q) || e.notas.toLowerCase().includes(q))
    .sort((a,b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn);
}
function getTotales(list) {
  const t = { total:0, pendiente:0, recibido:0, facturado:0, count:new Set(list.map(grupoDe)).size };
  list.forEach(e => {
    const sub = e.cantidad * e.costoUnitario;
    t.total += sub;
    t[e.estado] = (t[e.estado]||0) + sub;
  });
  return t;
}
function getProveedoresUnicos() { return [...new Set(entries.map(e => e.proveedor).filter(Boolean))].sort(); }
function getMesesDisponibles() {
  const set = new Set(entries.map(e => monthOf(e.fecha)).filter(Boolean));
  set.add(monthOf(today()));
  return [...set].sort().reverse();
}

// ----------- Render -----------
function render() {
  renderFiltros();
  ['lista', 'resumen', 'dashboard', 'documentos'].forEach(v => root.getElementById('vista-' + v).classList.toggle('hidden', v !== vista));
  root.getElementById('summary-grid').classList.toggle('hidden', vista === 'dashboard' || vista === 'documentos');
  if (vista === 'dashboard') renderDashboard();
  else if (vista === 'documentos') renderDocumentos();
  else { renderSummary(); vista === 'lista' ? renderLista() : renderResumen(); }
  root.getElementById('pap-count').textContent = eliminados.length;
  root.getElementById('total-registros').textContent = (n => n === 1 ? '1 registro total' : n + ' registros totales')(new Set(entries.map(grupoDe)).size);
}

function renderSummary() {
  const t = getTotales(getFiltered());
  root.getElementById('summary-grid').innerHTML = `
    <div class="summary-card highlight">
      <div class="label-row"><span class="label">Total del período</span></div>
      <div class="value">${fmtCLP(t.total)}</div>
      <div class="sub">${t.count} ${t.count===1?'registro':'registros'}</div>
    </div>
    <div class="summary-card">
      <div class="label-row"><span class="dot" style="background:var(--amber-dot)"></span><span class="label">Pendiente</span></div>
      <div class="value">${fmtCLP(t.pendiente)}</div>
    </div>
    <div class="summary-card">
      <div class="label-row"><span class="dot" style="background:var(--sky-dot)"></span><span class="label">Recibido</span></div>
      <div class="value">${fmtCLP(t.recibido)}</div>
    </div>
    <div class="summary-card">
      <div class="label-row"><span class="dot" style="background:var(--emerald-dot)"></span><span class="label">Facturado</span></div>
      <div class="value">${fmtCLP(t.facturado)}</div>
    </div>`;
}

function renderFiltros() {
  const mesSelect = root.getElementById('filtro-mes');
  const meses = getMesesDisponibles();
  mesSelect.innerHTML = '<option value="">Todos los meses</option>' +
    meses.map(m => `<option value="${m}" ${m===filtros.mes?'selected':''}>${m}</option>`).join('');
  const provs = getProveedoresUnicos();
  root.getElementById('filtro-proveedor').innerHTML = '<option value="">Todos</option>' +
    provs.map(p => `<option value="${escapeHtml(p)}" ${p===filtros.proveedor?'selected':''}>${escapeHtml(p)}</option>`).join('');
  root.getElementById('proveedores-list').innerHTML = provs.map(p => `<option value="${escapeHtml(p)}">`).join('');
  root.getElementById('filtro-sucursal').innerHTML = '<option value="">Todas</option>' +
    SUCURSALES.map(x => `<option ${x===filtros.sucursal?'selected':''}>${x}</option>`).join('') +
    (entries.some(e => !e.sucursal) ? `<option value="-" ${filtros.sucursal==='-'?'selected':''}>Sin sucursal</option>` : '');
  root.getElementById('filtro-estado').value = filtros.estado;
  root.getElementById('busqueda').value = filtros.busqueda;
}

function renderLista() {
  const list = getFiltered();
  const cont = root.getElementById('lista-content');
  if (list.length === 0) {
    cont.innerHTML = emptyStateHtml();
    root.getElementById('empty-add')?.addEventListener('click', () => openModal());
    return;
  }
  // Un registro = un documento (boleta/factura/vale) con uno o más ítems
  const gs = new Set(list.map(grupoDe));
  const docs = agruparDocs(entries.filter(e => gs.has(grupoDe(e))));
  const totalDocs = docs.reduce((s, d) => s + d.total, 0);
  const rows = docs.map(d => {
    const uno = d.items.length === 1 ? d.items[0] : null;
    const detalle = uno
      ? `<div class="text-muted">${escapeHtml(uno.producto)}</div>`
      : `<div class="doc-items">${d.items.map(it => `
          <div class="doc-item"><span class="doc-item-prod">${escapeHtml(it.producto)}</span><span class="doc-item-num">${fmtNum(it.cantidad)} ${escapeHtml(it.unidad)} × ${fmtCLP(it.costoUnitario)}</span></div>`).join('')}
        </div>`;
    return `
    <tr data-id="${escapeHtml(d.grupo)}">
      <td class="mono text-muted" style="font-size:12px;">
        ${d.fecha}${d.referencia ? `<div class="text-faint">${escapeHtml(d.referencia)}</div>` : ''}
        <div class="suc-badge${d.sucursal ? '' : ' suc-vacia'}">${escapeHtml(d.sucursal || 'Sin sucursal')}</div>
        ${tipoBadge(d)}
      </td>
      <td>
        <div class="product-name">${escapeHtml(d.proveedor)}</div>
        ${detalle}
        ${d.notas ? `<div class="note-text">${escapeHtml(d.notas)}</div>` : ''}
      </td>
      <td class="right mono">${uno ? `${fmtNum(uno.cantidad)} <span class="text-faint">${escapeHtml(uno.unidad)}</span>` : `<span class="text-faint">${d.items.length} ítems</span>`}</td>
      <td class="right mono">${uno ? fmtCLP(uno.costoUnitario) : ''}</td>
      <td class="right mono" style="font-weight:600;">${fmtCLP(d.total)}</td>
      <td>
        <select class="estado-select ${ESTADOS[d.estado].cls}" data-id="${escapeHtml(d.grupo)}" data-action="estado">
          ${Object.entries(ESTADOS).map(([k,v]) => `<option value="${k}" ${k===d.estado?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="row-actions">
          ${d.fotoUrl ? `<button class="icon-btn" data-id="${escapeHtml(d.grupo)}" data-action="ver-foto" title="Ver foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : ''}
          <button class="icon-btn" data-id="${escapeHtml(d.grupo)}" data-action="edit" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
          <button class="icon-btn danger" data-id="${escapeHtml(d.grupo)}" data-action="delete" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  cont.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Proveedor / Producto</th><th class="right">Cantidad</th>
          <th class="right">C. Unit.</th><th class="right">Subtotal</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="4">Total · ${docs.length} ${docs.length===1?'registro':'registros'}</td>
          <td class="total">${fmtCLP(totalDocs)}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
    </div>`;

  cont.querySelectorAll('[data-action="estado"]').forEach(s => s.addEventListener('change', onEstadoChange));
  cont.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.id)));
  cont.querySelectorAll('[data-action="ver-foto"]').forEach(b => b.addEventListener('click', () => verFoto(b.dataset.id)));
  cont.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', () => {
    confirmDeleteId = b.dataset.id;
    root.getElementById('modal-delete').classList.remove('hidden');
  }));
}

// ----------- Documentos: varios ítems = un solo registro -----------
// En la hoja cada ítem es una fila (así el reporte y el dashboard por producto siguen funcionando),
// y las filas de un mismo documento comparten la columna "grupo". Filas antiguas sin grupo = documento de 1 ítem.
function grupoDe(e) { return e.grupo || e.id; }
function itemsDe(g) { return entries.filter(e => grupoDe(e) === g).sort((a, b) => a.creadoEn - b.creadoEn); }
function agruparDocs(list) {
  const m = new Map();
  list.forEach(e => { const g = grupoDe(e); if (!m.has(g)) m.set(g, []); m.get(g).push(e); });
  return [...m.entries()].map(([g, items]) => {
    items.sort((a, b) => a.creadoEn - b.creadoEn);
    const p = items[0];
    return { grupo: g, items, fecha: p.fecha, sucursal: p.sucursal, proveedor: p.proveedor, estado: p.estado,
      referencia: p.referencia, notas: p.notas, creadoEn: p.creadoEn, tipoDoc: p.tipoDoc, facturaId: p.facturaId,
      fotoUrl: items.map(x => x.fotoUrl).find(Boolean) || '',
      total: items.reduce((s, x) => s + x.cantidad * x.costoUnitario, 0) };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn);
}
// Reemplaza todas las filas del documento por las nuevas (en una sola llamada y con la foto subida una vez)
async function guardarGrupo(grupo, nuevas, image, mimeType) {
  nuevas.forEach(n => { n.grupo = grupo; });
  const body = { action: 'save_group', grupo, entries: nuevas };
  if (image) { body.image = image; body.mimeType = mimeType; }
  const res = await apiPost(body);
  if (!res.ok) throw new Error(res.error || 'Error al guardar');
  if (res.fotoUrl) nuevas.forEach(n => { n.fotoUrl = res.fotoUrl; });
  entries = entries.filter(e => grupoDe(e) !== grupo).concat(nuevas);
}

function renderResumen() {
  const list = getFiltered();
  const cont = root.getElementById('resumen-content');
  if (list.length === 0) {
    cont.innerHTML = '<div class="table-card">' + emptyStateHtml() + '</div>';
    root.getElementById('empty-add')?.addEventListener('click', () => openModal());
    return;
  }
  const map = new Map();
  list.forEach(e => {
    if (!map.has(e.proveedor)) map.set(e.proveedor, { proveedor: e.proveedor, items: [], total:0, pendiente:0, recibido:0, facturado:0 });
    const g = map.get(e.proveedor);
    const sub = e.cantidad * e.costoUnitario;
    g.items.push(e); g.total += sub; g[e.estado] = (g[e.estado]||0) + sub;
  });
  const grupos = [...map.values()].sort((a,b) => b.total - a.total);
  cont.innerHTML = grupos.map(g => `
    <div class="proveedor-card">
      <div class="proveedor-header">
        <div>
          <div class="proveedor-title">${escapeHtml(g.proveedor)}</div>
          <div class="proveedor-meta">${g.items.length} ${g.items.length===1?'registro':'registros'}</div>
        </div>
        <div class="proveedor-totals">
          <div class="proveedor-total">${fmtCLP(g.total)}</div>
          <div class="proveedor-breakdown">
            ${g.pendiente>0 ? `<span class="breakdown-pendiente">P: ${fmtCLP(g.pendiente)}</span>` : ''}
            ${g.recibido>0 ? `<span class="breakdown-recibido">R: ${fmtCLP(g.recibido)}</span>` : ''}
            ${g.facturado>0 ? `<span class="breakdown-facturado">F: ${fmtCLP(g.facturado)}</span>` : ''}
          </div>
        </div>
      </div>
      ${g.items.map(e => `
        <div class="proveedor-item">
          <div class="item-main">
            <div>${escapeHtml(e.producto)}</div>
            <div class="item-detail">${e.fecha}${e.sucursal ? ' · ' + escapeHtml(e.sucursal) : ''} · ${fmtNum(e.cantidad)} ${escapeHtml(e.unidad)} × ${fmtCLP(e.costoUnitario)}${e.referencia ? ' · ' + escapeHtml(e.referencia) : ''}</div>
          </div>
          <div class="item-estado ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].label}</div>
          <div class="item-subtotal">${fmtCLP(e.cantidad * e.costoUnitario)}</div>
        </div>`).join('')}
    </div>`).join('');
}

// ----------- Dashboard -----------
function barras(lista, total, cls = '') {
  if (!lista.length) return '<div class="dash-vacio">Sin datos en este período</div>';
  const max = Math.max(...lista.map(x => x.valor), 1);
  return lista.map(x => `
    <div class="dash-bar-row">
      <div class="dash-bar-label" title="${escapeHtml(x.nombre)}">${escapeHtml(x.nombre)}</div>
      <div class="dash-bar-track"><div class="dash-bar ${cls}" style="width:${(x.valor / max * 100).toFixed(1)}%"></div></div>
      <div class="dash-bar-val">${fmtCLP(x.valor)}${total ? `<span>${Math.round(x.valor / total * 100)}%</span>` : ''}</div>
    </div>`).join('');
}
function agrupar(list, clave) {
  const m = new Map();
  list.forEach(e => { const k = clave(e); m.set(k, (m.get(k) || 0) + e.cantidad * e.costoUnitario); });
  return [...m.entries()].map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor);
}
function renderDashboard() {
  const cont = root.getElementById('dashboard-content');
  const todos = !filtros.mes;                                         // "Todos los meses"
  const mes = filtros.mes || monthOf(today());
  const base = getFiltered({ sinMes: true });                       // respeta sucursal/proveedor/estado/búsqueda
  const enPeriodo = e => todos || monthOf(e.fecha) === mes;
  const delMes = base.filter(enPeriodo);
  const previo = todos ? [] : base.filter(e => monthOf(e.fecha) === mesAnterior(mes));
  const mesesConDatos = new Set(delMes.map(e => monthOf(e.fecha)).filter(Boolean)).size;
  const sum = l => l.reduce((s, e) => s + e.cantidad * e.costoUnitario, 0);
  const total = sum(delMes), totalPrev = sum(previo);
  const variacion = totalPrev > 0 ? (total - totalPrev) / totalPrev * 100 : null;
  const porFacturar = delMes.filter(e => e.estado !== 'facturado');
  const docsMes = agruparDocs(delMes);
  const conFoto = docsMes.filter(d => d.fotoUrl).length;
  const nPorFacturar = new Set(porFacturar.map(grupoDe)).size;

  // Por sucursal: mismo mes y filtros, pero siempre todas las sucursales
  const mesTodas = getFiltered({ sinMes: true, sinSucursal: true }).filter(enPeriodo);
  const porSuc = agrupar(mesTodas, e => e.sucursal || 'Sin sucursal');
  SUCURSALES.forEach(s => { if (!porSuc.some(x => x.nombre === s)) porSuc.push({ nombre: s, valor: 0 }); });
  const totalTodas = sum(mesTodas);

  // Tendencia: 6 meses hasta el mes elegido, o 12 meses en "Todos los meses"
  const nCols = todos ? 12 : 6;
  const meses = Array.from({ length: nCols }, (_, i) => mesAnterior(mes, nCols - 1 - i));
  const tend = meses.map(m => ({ m, v: sum(base.filter(e => monthOf(e.fecha) === m)) }));
  const maxT = Math.max(...tend.map(t => t.v), 1);

  const tituloSuc = filtros.sucursal ? (filtros.sucursal === '-' ? 'Sin sucursal' : filtros.sucursal) : 'Todas las sucursales';
  cont.innerHTML = `
    <div class="dash-titulo">${tituloSuc} · ${todos ? 'Todos los meses' : mesTxt(mes)}</div>
    <div class="summary-grid">
      <div class="summary-card highlight">
        <div class="label-row"><span class="label">${todos ? 'Total histórico' : 'Total del mes'}</span></div>
        <div class="value">${fmtCLP(total)}</div>
        <div class="sub">${todos ? `${mesesConDatos} ${mesesConDatos === 1 ? 'mes' : 'meses'} · prom. ${fmtCLP(mesesConDatos ? total / mesesConDatos : 0)}/mes` : variacion === null ? 'Sin datos del mes anterior' : (variacion >= 0 ? '▲ ' : '▼ ') + Math.abs(variacion).toFixed(1) + '% vs ' + mesTxt(mesAnterior(mes))}</div>
      </div>
      <div class="summary-card">
        <div class="label-row"><span class="label">Registros</span></div>
        <div class="value">${docsMes.length}</div>
        <div class="sub">${(n => n + (n === 1 ? ' proveedor' : ' proveedores'))(new Set(delMes.map(e => e.proveedor)).size)}</div>
      </div>
      <div class="summary-card">
        <div class="label-row"><span class="dot" style="background:var(--amber-dot)"></span><span class="label">Por facturar</span></div>
        <div class="value">${fmtCLP(sum(porFacturar))}</div>
        <div class="sub">${nPorFacturar} ${nPorFacturar === 1 ? 'registro' : 'registros'} pendiente o recibido</div>
      </div>
      <div class="summary-card">
        <div class="label-row"><span class="label">Con foto</span></div>
        <div class="value">${conFoto} / ${docsMes.length}</div>
        <div class="sub">${docsMes.length ? Math.round(conFoto / docsMes.length * 100) : 0}% respaldado</div>
      </div>
    </div>
    <div class="dash-grid">
      ${panelVales()}
      <div class="dash-panel">
        <div class="dash-panel-title">Por sucursal</div>
        ${barras(porSuc, totalTodas, 'suc')}
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title">Últimos ${nCols} meses</div>
        <div class="dash-cols${todos ? ' doce' : ''}">
          ${tend.map(t => `
            <div class="dash-col${t.m === mes ? ' actual' : ''}">
              <div class="dash-col-val">${t.v ? fmtCorto(t.v) : ''}</div>
              <div class="dash-col-track"><div class="dash-col-bar" style="height:${(t.v / maxT * 100).toFixed(1)}%"></div></div>
              <div class="dash-col-label">${mesTxt(t.m)}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title">Top proveedores</div>
        ${barras(agrupar(delMes, e => e.proveedor).slice(0, 6), total)}
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title">Top productos</div>
        ${barras(agrupar(delMes, e => e.producto).slice(0, 6), total)}
      </div>
    </div>`;
  cont.querySelector('[data-goto]')?.addEventListener('click', () => irA('documentos'));
}

function emptyStateHtml() {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
      <h3>No hay registros en este filtro</h3>
      <p>Agrega tu primer pedido o ajusta los filtros</p>
      <button class="btn btn-primary" id="empty-add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo registro
      </button>
    </div>`;
}

// ----------- Acciones sobre datos -----------
async function onEstadoChange(ev) {
  const g = ev.target.dataset.id;
  const nuevoEstado = ev.target.value;
  const items = itemsDe(g);
  if (!items.length) return;
  const nuevas = items.map(e => ({ ...e, estado: nuevoEstado, actualizadoEn: Date.now() }));
  setSyncStatus('loading','Guardando…');
  try {
    await guardarGrupo(g, nuevas);
    setSyncStatus('ok','Sincronizado');
    render();
  } catch (err) {
    setSyncStatus('error','Error al guardar · recargando…');
    setTimeout(loadEntries, 800);
  }
}

// ----------- Registrar por foto -----------
// Redimensiona/comprime la foto en el navegador antes de enviarla (las fotos de celular
// pueden pesar varios MB, lo que hace lento tanto el análisis con Gemini como la subida a Drive).
function resizeImage(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function handleFotoSeleccionada(e) {
  const file = e.target.files[0];
  e.target.value = ''; // permite volver a elegir la misma foto después
  if (!file) return;

  let dataUrl;
  try {
    dataUrl = await resizeImage(file);
  } catch {
    alert('No se pudo leer la imagen.');
    return;
  }
  const base64 = dataUrl.split(',')[1];
  const mimeType = 'image/jpeg';

  root.getElementById('foto-preview').src = dataUrl;
  const status = root.getElementById('foto-status');
  status.textContent = 'Extrayendo datos…';
  root.getElementById('modal-foto').classList.remove('hidden');
  // Gemini a veces tarda porque el servidor reintenta con otro modelo: se avisa para que no parezca pegado
  const aviso = setTimeout(() => { status.textContent = 'Gemini está lento, probando de nuevo…'; }, 12000);

  let data = {}, errorLectura = null;
  try {
    const res = await apiPost({ action: 'extract', image: base64, mimeType }, 100000);
    if (!res.ok) throw new Error(res.error || 'No se pudieron extraer los datos');
    data = res.data || {};
  } catch (err) {
    errorLectura = err.message; // la foto NO se pierde: se abre el registro con la foto adjunta
  } finally {
    clearTimeout(aviso);
    root.getElementById('modal-foto').classList.add('hidden');
  }
  abrirModalConDatosExtraidos(data, base64, mimeType, errorLectura);
}

function abrirModalConDatosExtraidos(data, fotoBase64, fotoMime, errorLectura) {
  openModal(); // limpia cualquier foto pendiente anterior
  fotoPendienteBase64 = fotoBase64 || null;
  fotoPendienteMime = fotoMime || null;
  root.getElementById('modal-foto-indicator').classList.toggle('hidden', !fotoPendienteBase64);
  // La fecha se fija al día de hoy (registro), no se usa la fecha manuscrita de la boleta.
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  root.getElementById('f-fecha').value = `${yyyy}-${mm}-${dd}`;
  if (data.proveedor) root.getElementById('f-proveedor').value = data.proveedor;
  if (data.documento) {
    root.getElementById('f-referencia').value = data.documento;
    root.getElementById('f-tipo').value = /factura/i.test(data.documento) ? 'factura' : /boleta/i.test(data.documento) ? 'boleta' : 'vale';
  }
  // Formato nuevo: data.items = [{producto, cantidad, costoUnitario}, ...]. Formato antiguo: un solo producto.
  const items = Array.isArray(data.items) && data.items.length ? data.items
    : (data.producto || data.costoUnitario != null) ? [data] : [];
  items.forEach((it, i) => {
    if (i === 0) {
      if (it.producto) root.getElementById('f-producto').value = it.producto;
      if (it.cantidad !== null && it.cantidad !== undefined) root.getElementById('f-cantidad').value = it.cantidad;
      if (it.costoUnitario !== null && it.costoUnitario !== undefined) root.getElementById('f-costo').value = it.costoUnitario;
    } else {
      agregarItem(it);
    }
  });
  root.getElementById('f-estado').value = 'recibido';
  root.getElementById('f-notas').value = errorLectura
    ? 'Foto adjunta — los datos no se pudieron extraer, ingresados a mano.'
    : 'Datos extraídos de la foto — revisa antes de guardar.';
  if (errorLectura) {
    setTimeout(() => alert('No se pudieron extraer los datos automáticamente.\n\n' + errorLectura + '\n\nLa foto quedó adjunta: completa los datos a mano y guarda.'), 50);
  } else if (items.length > 1) {
    setTimeout(() => alert('Se detectaron ' + items.length + ' ítems. Revísalos antes de guardar: quedan todos en un mismo registro.'), 50);
  }
  updateSubtotalPreview();
}

// Solo guarda la foto (sin Gemini): sirve para respaldar vales, guías o documentos que no hay que leer
async function leerFotoSinAnalisis(file) {
  const dataUrl = await resizeImage(file);
  return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}
async function handleSoloFoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let f;
  try { f = await leerFotoSinAnalisis(file); } catch { alert('No se pudo leer la imagen.'); return; }
  openModal();
  fotoPendienteBase64 = f.base64; fotoPendienteMime = f.mimeType;
  root.getElementById('modal-foto-indicator').classList.remove('hidden');
}
// Adjuntar o cambiar la foto desde el formulario (nuevo o edición), sin análisis
async function handleAdjuntarFoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const f = await leerFotoSinAnalisis(file);
    fotoPendienteBase64 = f.base64; fotoPendienteMime = f.mimeType;
    root.getElementById('modal-foto-indicator').classList.remove('hidden');
  } catch { alert('No se pudo leer la imagen.'); }
}

function verFoto(g) {
  const url = itemsDe(g).map(x => x.fotoUrl).find(Boolean);
  if (!url) return;
  root.getElementById('foto-ver-img').src = url;
  root.getElementById('modal-ver-foto').classList.remove('hidden');
}
function cerrarVerFoto() { root.getElementById('modal-ver-foto').classList.add('hidden'); }

async function openModal(id) {
  editingId = id || null;
  fotoPendienteBase64 = null;
  fotoPendienteMime = null;
  root.getElementById('modal-foto-indicator').classList.add('hidden');
  root.getElementById('items-extra').innerHTML = '';
  root.getElementById('item1-label').classList.add('hidden');
  root.getElementById('modal-title').textContent = editingId ? 'Editar registro' : 'Nuevo registro';
  root.getElementById('modal-save-label').textContent = editingId ? 'Guardar cambios' : 'Agregar registro';
  root.getElementById('f-sucursal').value = sucursalEquipo();
  const items = editingId ? itemsDe(editingId) : [];
  if (items.length) {
    const e = items[0];
    root.getElementById('f-sucursal').value = e.sucursal || '';
    root.getElementById('f-fecha').value = e.fecha;
    root.getElementById('f-proveedor').value = e.proveedor;
    root.getElementById('f-producto').value = e.producto;
    root.getElementById('f-cantidad').value = e.cantidad;
    root.getElementById('f-unidad').value = e.unidad;
    root.getElementById('f-costo').value = e.costoUnitario;
    root.getElementById('f-estado').value = e.estado;
    root.getElementById('f-tipo').value = e.tipoDoc || 'vale';
    root.getElementById('f-referencia').value = e.referencia;
    root.getElementById('f-notas').value = e.notas;
    items.slice(1).forEach(it => agregarItem(it));
  } else {
    editingId = null;
    root.getElementById('f-fecha').value = today();
    root.getElementById('f-proveedor').value = '';
    root.getElementById('f-producto').value = '';
    root.getElementById('f-cantidad').value = '';
    root.getElementById('f-unidad').value = 'unidad';
    root.getElementById('f-costo').value = '';
    root.getElementById('f-estado').value = 'pendiente';
    root.getElementById('f-tipo').value = 'vale';
    root.getElementById('f-referencia').value = '';
    root.getElementById('f-notas').value = '';
  }
  updateSubtotalPreview();
  root.getElementById('modal').classList.remove('hidden');
  setTimeout(() => root.getElementById('f-proveedor').focus(), 50);
}
function closeModal() {
  root.getElementById('modal').classList.add('hidden');
  editingId = null;
  fotoPendienteBase64 = null;
  fotoPendienteMime = null;
}

function updateSubtotalPreview() {
  const items = leerItems();
  const total = items.reduce((s, it) => s + (it.cantidad > 0 && it.costoUnitario > 0 ? it.cantidad * it.costoUnitario : 0), 0);
  const box = root.getElementById('subtotal-preview');
  box.querySelector('.label').textContent = items.length > 1 ? `Total (${items.length} ítems)` : 'Subtotal calculado';
  if (total > 0) {
    root.getElementById('subtotal-value').textContent = fmtCLP(total);
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
}

// ----------- Varios ítems por boleta/factura -----------
const UNIDADES = ['unidad','caja','resma','rollo','pallet','kg','m','lt','paquete'];
function agregarItem(it = {}) {
  const cont = root.getElementById('items-extra');
  const row = document.createElement('div');
  row.className = 'item-extra';
  const unidad = UNIDADES.includes(it.unidad) ? it.unidad : 'unidad';
  row.innerHTML = `
    <div class="item-extra-head">
      <span class="item-num"></span>
      <button type="button" class="icon-btn danger item-del" title="Quitar ítem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="field"><input type="text" class="input i-producto" placeholder="Producto / Descripción" value="${escapeHtml(it.producto || '')}"></div>
    <div class="field-grid-3">
      <div class="field"><input type="number" step="any" class="input font-mono i-cantidad" placeholder="Cantidad" value="${it.cantidad ?? ''}"></div>
      <div class="field"><select class="input i-unidad">${UNIDADES.map(u => `<option${u === unidad ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><input type="number" step="any" class="input font-mono i-costo" placeholder="Costo unitario" value="${it.costoUnitario ?? ''}"></div>
    </div>`;
  row.querySelector('.item-del').addEventListener('click', () => { row.remove(); renumerarItems(); updateSubtotalPreview(); });
  row.querySelectorAll('.i-cantidad, .i-costo').forEach(i => i.addEventListener('input', updateSubtotalPreview));
  cont.appendChild(row);
  renumerarItems();
  updateSubtotalPreview();
  return row;
}
function renumerarItems() {
  const rows = root.getElementById('items-extra').querySelectorAll('.item-extra');
  rows.forEach((r, i) => { r.querySelector('.item-num').textContent = 'Ítem ' + (i + 2); });
  root.getElementById('item1-label').classList.toggle('hidden', rows.length === 0);
}
// Ítem 1 = campos principales; los demás vienen de #items-extra (se ignoran filas totalmente vacías)
function leerItems() {
  const items = [{
    producto: root.getElementById('f-producto').value.trim(),
    cantidad: parseFloat(root.getElementById('f-cantidad').value),
    unidad: root.getElementById('f-unidad').value,
    costoUnitario: parseFloat(root.getElementById('f-costo').value),
  }];
  root.getElementById('items-extra').querySelectorAll('.item-extra').forEach(r => {
    const it = {
      producto: r.querySelector('.i-producto').value.trim(),
      cantidad: parseFloat(r.querySelector('.i-cantidad').value),
      unidad: r.querySelector('.i-unidad').value,
      costoUnitario: parseFloat(r.querySelector('.i-costo').value),
    };
    if (it.producto || !isNaN(it.cantidad) || !isNaN(it.costoUnitario)) items.push(it);
  });
  return items;
}

async function saveForm() {
  const fecha = root.getElementById('f-fecha').value;
  const sucursal = root.getElementById('f-sucursal').value;
  let proveedor = root.getElementById('f-proveedor').value.trim();
  const tipoDoc = root.getElementById('f-tipo').value;
  const estado = root.getElementById('f-estado').value;
  const referencia = root.getElementById('f-referencia').value.trim();
  const notas = root.getElementById('f-notas').value.trim();
  const items = leerItems();
  if (!sucursal) { alert('Elige la sucursal que recepciona la compra.'); root.getElementById('f-sucursal').focus(); return; }
  if (!fecha || !proveedor) { alert('Falta la fecha o el proveedor.'); return; }
  guardarSucursalEquipo(sucursal);
  const malo = items.findIndex(it => !it.producto || isNaN(it.cantidad) || isNaN(it.costoUnitario));
  if (malo !== -1) { alert('Al ítem ' + (malo + 1) + ' le falta producto, cantidad o costo unitario.'); return; }
  proveedor = proveedorCanonico(proveedor);
  // Posible duplicado: mismo proveedor, fecha y monto que un registro existente
  if (!editingId) {
    const totalNuevo = Math.round(items.reduce((s, it) => s + it.cantidad * it.costoUnitario, 0));
    const dup = agruparDocs(entries).find(d => d.fecha === fecha && Math.round(d.total) === totalNuevo && normProv(d.proveedor) === normProv(proveedor));
    if (dup && !confirm(`Ya existe un registro de ${dup.proveedor} del ${fecha} por ${fmtCLP(dup.total)}${dup.sucursal ? ' en ' + dup.sucursal : ''}.\n\n¿Es una compra distinta? Aceptar = guardar igual.`)) return;
  }

  const saveBtn = root.getElementById('modal-save');
  saveBtn.disabled = true;
  setSyncStatus('loading','Guardando…');

  try {
    const ahora = Date.now();
    const previos = editingId ? itemsDe(editingId) : [];
    const grupo = editingId || ('g_' + uid().slice(2));
    const fotoActual = previos.map(x => x.fotoUrl).find(Boolean) || '';
    const nuevas = items.map((it, i) => ({
      id: previos[i] ? previos[i].id : uid() + i,
      sucursal, fecha, proveedor, producto: it.producto, cantidad: it.cantidad, unidad: it.unidad,
      costoUnitario: it.costoUnitario, estado, referencia, notas, fotoUrl: fotoActual,
      tipoDoc, facturaId: (previos[0] && previos[0].facturaId) || '',
      creadoEn: previos[i] ? previos[i].creadoEn : ahora + i, actualizadoEn: ahora,
    }));
    await guardarGrupo(grupo, nuevas, fotoPendienteBase64, fotoPendienteMime);
    fotoPendienteBase64 = null;
    fotoPendienteMime = null;
    setSyncStatus('ok','Sincronizado');
    closeModal();
    render();
  } catch (err) {
    alert('Error al guardar: ' + err.message);
    setSyncStatus('error','Error al guardar');
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteEntry(g) {
  setSyncStatus('loading','Eliminando…');
  try {
    const res = await apiPost({ action: 'delete_group', grupo: g });
    if (!res.ok) throw new Error(res.error);
    entries = entries.filter(e => grupoDe(e) !== g);
    render();
    loadEntries(); // actualiza la papelera
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
    setSyncStatus('error','Error al eliminar');
  }
}

// ----------- Documentos tributarios (facturas/boletas reales) y conciliación con vales -----------
let editingDocId = null, docFotoB64 = null, docSeleccion = new Set();
function normDoc(d) {
  let grupos = [];
  try { grupos = Array.isArray(d.grupos) ? d.grupos : JSON.parse(d.grupos || '[]'); } catch {}
  return { id: String(d.id), tipo: d.tipo === 'boleta' ? 'boleta' : 'factura', numero: String(d.numero || ''), fecha: String(d.fecha || '').slice(0, 10),
    proveedor: String(d.proveedor || ''), sucursal: String(d.sucursal || ''), neto: Number(d.neto) || 0, iva: Number(d.iva) || 0, total: Number(d.total) || 0,
    fotoUrl: String(d.fotoUrl || ''), notas: String(d.notas || ''), grupos: grupos.map(String), creadoEn: Number(d.creadoEn) || 0 };
}
function normProv(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
// Si el proveedor ya existe escrito de otra forma (mayúsculas, tildes, espacios), se usa el nombre existente
function proveedorCanonico(p) { const k = normProv(p); return [...getProveedoresUnicos(), ...documentos.map(d => d.proveedor)].find(x => normProv(x) === k) || p; }
function docLabel(d) { return (d.tipo === 'boleta' ? 'Boleta' : 'Factura') + ' N° ' + d.numero; }
function tipoBadge(d) {
  if (d.tipoDoc === 'boleta') return '<div class="tipo-badge tipo-ok">Boleta</div>';
  if (d.tipoDoc === 'factura') return '<div class="tipo-badge tipo-ok">Factura</div>';
  if (d.facturaId) {
    const f = documentos.find(x => x.id === d.facturaId);
    return `<div class="tipo-badge tipo-ok">Vale · ${f ? escapeHtml(docLabel(f)) : 'facturado'}</div>`;
  }
  return '<div class="tipo-badge tipo-pend">Vale · sin factura</div>';
}
function valesPendientes(lista = entries) { return agruparDocs(lista).filter(d => d.tipoDoc === 'vale' && !d.facturaId); }
function diasDesde(f) { return Math.max(0, Math.floor((new Date(today() + 'T12:00:00') - new Date(f + 'T12:00:00')) / 86400000)); }
function cuadreTxt(suma, total, neto, n) {
  if (!n) return { n, suma, cls: 'cuadre-gris', txt: 'Sin vales asociados' };
  const dif = Math.round(total - suma);
  if (Math.abs(dif) <= 1) return { n, suma, cls: 'cuadre-ok', txt: 'Cuadra ✓' };
  if (neto && Math.abs(Math.round(neto - suma)) <= 1) return { n, suma, cls: 'cuadre-ok', txt: 'Cuadra con el neto ✓' };
  return { n, suma, cls: 'cuadre-mal', txt: (dif > 0 ? 'Factura mayor por ' : 'Vales mayores por ') + fmtCLP(Math.abs(dif)) };
}
function cuadreDoc(d) {
  const vales = agruparDocs(entries.filter(e => d.grupos.includes(grupoDe(e))));
  return cuadreTxt(vales.reduce((s, x) => s + x.total, 0), d.total, d.neto, vales.length);
}
function irA(v) {
  vista = v;
  root.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  render();
}

function panelVales() {
  const pend = valesPendientes(entries.filter(e => !filtros.proveedor || e.proveedor === filtros.proveedor));
  if (!pend.length) return `<div class="dash-panel dash-full"><div class="dash-panel-title">Vales sin factura</div><div class="dash-vacio vp-ok">Todos los vales tienen su factura ✓</div></div>`;
  const total = pend.reduce((s, d) => s + d.total, 0);
  const porSuc = new Map();
  pend.forEach(d => {
    const k = d.sucursal || 'Sin sucursal';
    const x = porSuc.get(k) || { n: 0, total: 0, dias: 0 };
    x.n++; x.total += d.total; x.dias = Math.max(x.dias, diasDesde(d.fecha));
    porSuc.set(k, x);
  });
  return `
    <div class="dash-panel dash-full">
      <div class="vp-head">
        <div class="dash-panel-title" style="margin:0;">Vales sin factura · ${pend.length} · ${fmtCLP(total)}</div>
        <button class="btn btn-secondary btn-adjuntar" data-goto="documentos">Registrar factura</button>
      </div>
      ${[...porSuc.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, x]) => `
        <div class="vp-row">
          <span class="vp-suc">${escapeHtml(k)}</span>
          <span class="text-muted">${x.n} ${x.n === 1 ? 'vale' : 'vales'}</span>
          <span class="${x.dias > 30 ? 'vp-alerta' : 'text-muted'}">${x.dias} ${x.dias === 1 ? 'día' : 'días'} el más antiguo</span>
          <span class="vp-monto">${fmtCLP(x.total)}</span>
        </div>`).join('')}
    </div>`;
}

function renderDocumentos() {
  const cont = root.getElementById('documentos-content');
  const q = filtros.busqueda.trim().toLowerCase();
  const lista = documentos
    .filter(d => !filtros.mes || monthOf(d.fecha) === filtros.mes)
    .filter(d => !filtros.sucursal || (filtros.sucursal === '-' ? !d.sucursal : d.sucursal === filtros.sucursal))
    .filter(d => !filtros.proveedor || d.proveedor === filtros.proveedor)
    .filter(d => !q || d.numero.toLowerCase().includes(q) || d.proveedor.toLowerCase().includes(q) || d.notas.toLowerCase().includes(q))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn);
  const pend = valesPendientes();
  const totalPend = pend.reduce((s, d) => s + d.total, 0);
  cont.innerHTML = `
    <div class="docs-bar">
      <div class="docs-pend ${pend.length ? '' : 'ok'}">${pend.length ? `<b>${pend.length}</b> ${pend.length === 1 ? 'vale' : 'vales'} sin factura · ${fmtCLP(totalPend)}` : 'Todos los vales tienen factura ✓'}</div>
      <button class="btn btn-primary" id="btn-nuevo-doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Registrar factura</button>
    </div>
    ${lista.length ? lista.map(d => { const c = cuadreDoc(d); return `
      <div class="doc-card">
        <div class="doc-card-main">
          <div class="doc-card-top"><span class="product-name">${escapeHtml(docLabel(d))}</span><span class="suc-badge${d.sucursal ? '' : ' suc-vacia'}" style="margin:0;">${escapeHtml(d.sucursal || 'Varias')}</span></div>
          <div class="text-muted">${escapeHtml(d.proveedor)} · ${d.fecha}</div>
          <div class="doc-card-vales">${c.n} ${c.n === 1 ? 'vale' : 'vales'} · ${fmtCLP(c.suma)}</div>
          ${d.notas ? `<div class="note-text">${escapeHtml(d.notas)}</div>` : ''}
        </div>
        <div class="doc-card-side">
          <div class="doc-card-total">${fmtCLP(d.total)}</div>
          <div class="cuadre-badge ${c.cls}">${c.txt}</div>
          <div class="row-actions" style="opacity:1;">
            ${d.fotoUrl ? `<button class="icon-btn" data-docfoto="${escapeHtml(d.id)}" title="Ver foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : ''}
            <button class="icon-btn" data-docedit="${escapeHtml(d.id)}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
            <button class="icon-btn danger" data-docdel="${escapeHtml(d.id)}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
          </div>
        </div>
      </div>`; }).join('') : `<div class="table-card"><div class="empty-state"><h3>No hay facturas en este filtro</h3><p>Registra la factura del proveedor y marca los vales que cubre</p></div></div>`}`;
  root.getElementById('btn-nuevo-doc').addEventListener('click', () => abrirDoc());
  cont.querySelectorAll('[data-docedit]').forEach(b => b.addEventListener('click', () => abrirDoc(b.dataset.docedit)));
  cont.querySelectorAll('[data-docdel]').forEach(b => b.addEventListener('click', () => eliminarDoc(b.dataset.docdel)));
  cont.querySelectorAll('[data-docfoto]').forEach(b => b.addEventListener('click', () => {
    const d = documentos.find(x => x.id === b.dataset.docfoto);
    if (!d) return;
    root.getElementById('foto-ver-img').src = d.fotoUrl;
    root.getElementById('modal-ver-foto').classList.remove('hidden');
  }));
}

function abrirDoc(id) {
  const d = id ? documentos.find(x => x.id === id) : null;
  editingDocId = d ? d.id : null;
  docFotoB64 = null;
  root.getElementById('doc-title').textContent = d ? 'Editar ' + docLabel(d) : 'Registrar factura';
  root.getElementById('d-tipo').value = d ? d.tipo : 'factura';
  root.getElementById('d-numero').value = d ? d.numero : '';
  root.getElementById('d-fecha').value = d ? d.fecha : today();
  root.getElementById('d-proveedor').value = d ? d.proveedor : (filtros.proveedor || '');
  root.getElementById('d-sucursal').value = d ? d.sucursal : (filtros.sucursal && filtros.sucursal !== '-' ? filtros.sucursal : '');
  root.getElementById('d-neto').value = d && d.neto ? d.neto : '';
  root.getElementById('d-iva').value = d && d.iva ? d.iva : '';
  root.getElementById('d-total').value = d && d.total ? d.total : '';
  root.getElementById('d-notas').value = d ? d.notas : '';
  const ind = root.getElementById('d-foto-ind');
  ind.textContent = 'Tiene foto';
  ind.classList.toggle('hidden', !(d && d.fotoUrl));
  docSeleccion = new Set(d ? d.grupos : []);
  renderValesDoc();
  root.getElementById('modal-doc').classList.remove('hidden');
}
function cerrarDoc() { root.getElementById('modal-doc').classList.add('hidden'); editingDocId = null; docFotoB64 = null; }

function candidatosDoc() {
  const prov = normProv(root.getElementById('d-proveedor').value);
  const suc = root.getElementById('d-sucursal').value;
  return agruparDocs(entries)
    .filter(x => docSeleccion.has(x.grupo) || (x.tipoDoc === 'vale' && !x.facturaId
      && (!prov || normProv(x.proveedor).includes(prov)) && (!suc || x.sucursal === suc)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function renderValesDoc() {
  const c = candidatosDoc();
  const cont = root.getElementById('d-vales');
  cont.innerHTML = c.length ? c.map(x => `
    <label class="vale-row">
      <input type="checkbox" data-g="${escapeHtml(x.grupo)}" ${docSeleccion.has(x.grupo) ? 'checked' : ''}>
      <span class="vale-info"><b>${x.fecha}</b> · ${escapeHtml(x.sucursal || 'Sin sucursal')}<br><span class="text-muted">${escapeHtml(x.proveedor)} · ${escapeHtml(x.items.map(i => fmtNum(i.cantidad) + ' ' + i.producto).join(', '))}</span></span>
      <span class="vale-monto">${fmtCLP(x.total)}</span>
    </label>`).join('') : '<div class="dash-vacio">No hay vales sin factura para este proveedor' + (root.getElementById('d-sucursal').value ? ' y sucursal' : '') + '.</div>';
  cont.querySelectorAll('input[type=checkbox]').forEach(ch => ch.addEventListener('change', () => {
    ch.checked ? docSeleccion.add(ch.dataset.g) : docSeleccion.delete(ch.dataset.g);
    actualizarCuadreDoc();
  }));
  root.getElementById('d-vales-info').textContent = c.length ? `${c.length} ${c.length === 1 ? 'vale disponible' : 'vales disponibles'}` : '';
  actualizarCuadreDoc();
}
function actualizarCuadreDoc() {
  const sel = agruparDocs(entries).filter(x => docSeleccion.has(x.grupo));
  const suma = sel.reduce((s, x) => s + x.total, 0);
  const total = parseFloat(root.getElementById('d-total').value) || 0;
  const neto = parseFloat(root.getElementById('d-neto').value) || 0;
  const c = cuadreTxt(suma, total, neto, sel.length);
  root.getElementById('d-cuadre').innerHTML = `
    <div><span class="text-muted">Vales marcados</span><b>${sel.length} · ${fmtCLP(suma)}</b></div>
    <div><span class="text-muted">Total documento</span><b>${fmtCLP(total)}</b></div>
    <div class="cuadre-badge ${c.cls}">${c.txt}</div>`;
}
function onNetoDoc() {
  const neto = parseFloat(root.getElementById('d-neto').value);
  if (!isNaN(neto)) {
    const iva = Math.round(neto * 0.19);
    root.getElementById('d-iva').value = iva;
    root.getElementById('d-total').value = Math.round(neto + iva);
  }
  actualizarCuadreDoc();
}
function onIvaDoc() {
  const neto = parseFloat(root.getElementById('d-neto').value) || 0;
  const iva = parseFloat(root.getElementById('d-iva').value) || 0;
  root.getElementById('d-total').value = Math.round(neto + iva);
  actualizarCuadreDoc();
}
async function guardarDoc() {
  const tipo = root.getElementById('d-tipo').value;
  const numero = root.getElementById('d-numero').value.trim();
  const fecha = root.getElementById('d-fecha').value;
  const proveedor = proveedorCanonico(root.getElementById('d-proveedor').value.trim());
  const sucursal = root.getElementById('d-sucursal').value;
  const neto = parseFloat(root.getElementById('d-neto').value) || 0;
  const iva = parseFloat(root.getElementById('d-iva').value) || 0;
  const total = parseFloat(root.getElementById('d-total').value) || 0;
  const notas = root.getElementById('d-notas').value.trim();
  if (!numero || !fecha || !proveedor) { alert('Faltan el N° de documento, la fecha o el proveedor.'); return; }
  if (total <= 0) { alert('Falta el total del documento.'); return; }
  const repetido = documentos.find(x => x.id !== editingDocId && x.numero === numero && normProv(x.proveedor) === normProv(proveedor) && x.tipo === tipo);
  if (repetido && !confirm(`Ya existe ${docLabel(repetido)} de ${repetido.proveedor}. ¿Guardar igual?`)) return;
  const previo = editingDocId ? documentos.find(x => x.id === editingDocId) : null;
  const d = { id: editingDocId || ('d_' + uid().slice(2)), tipo, numero, fecha, proveedor, sucursal, neto, iva, total, notas,
    fotoUrl: previo ? previo.fotoUrl : '', creadoEn: previo ? previo.creadoEn : Date.now(), actualizadoEn: Date.now() };
  const grupos = [...docSeleccion];
  const btn = root.getElementById('doc-save');
  btn.disabled = true;
  setSyncStatus('loading', 'Guardando…');
  try {
    const body = { action: 'doc_save', documento: d, grupos };
    if (docFotoB64) { body.image = docFotoB64; body.mimeType = 'image/jpeg'; }
    const res = await apiPost(body);
    if (!res.ok) throw new Error(res.error || 'Error al guardar');
    if (res.fotoUrl) d.fotoUrl = res.fotoUrl;
    const nd = normDoc({ ...d, grupos });
    documentos = documentos.filter(x => x.id !== nd.id).concat(nd);
    const set = new Set(grupos);
    entries.forEach(e => {
      if (set.has(grupoDe(e))) { e.facturaId = nd.id; e.estado = 'facturado'; }
      else if (e.facturaId === nd.id) { e.facturaId = ''; e.estado = 'recibido'; }
    });
    setSyncStatus('ok', 'Sincronizado');
    cerrarDoc();
    render();
  } catch (err) {
    alert('Error al guardar: ' + err.message);
    setSyncStatus('error', 'Error al guardar');
  } finally { btn.disabled = false; }
}
async function eliminarDoc(id) {
  const d = documentos.find(x => x.id === id);
  if (!d || !confirm(`¿Eliminar ${docLabel(d)}? Se moverá a la papelera y sus vales quedarán sin factura.`)) return;
  setSyncStatus('loading', 'Eliminando…');
  try {
    const res = await apiPost({ action: 'doc_delete', id });
    if (!res.ok) throw new Error(res.error);
    await loadEntries();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
    setSyncStatus('error', 'Error al eliminar');
  }
}

// ----------- Papelera -----------
function abrirPapelera() { renderPapelera(); root.getElementById('modal-papelera').classList.remove('hidden'); }
function cerrarPapelera() { root.getElementById('modal-papelera').classList.add('hidden'); }
function renderPapelera() {
  const cont = root.getElementById('pap-list');
  cont.innerHTML = eliminados.length ? eliminados.map(x => `
    <div class="pap-row">
      <div class="pap-info">
        <div class="pap-res">${escapeHtml(x.resumen)}</div>
        <div class="text-faint" style="font-size:11px;">${x.tipo === 'documento' ? 'Factura / boleta' : 'Registro de compra'} · eliminado ${escapeHtml(x.eliminadoEn)}</div>
      </div>
      <button class="btn btn-secondary btn-adjuntar" data-rest="${escapeHtml(x.eliminadoId)}">Restaurar</button>
    </div>`).join('') : '<div class="dash-vacio">La papelera está vacía.</div>';
  cont.querySelectorAll('[data-rest]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Restaurando…';
    try {
      const res = await apiPost({ action: 'restore', eliminadoId: b.dataset.rest });
      if (!res.ok) throw new Error(res.error);
      await loadEntries();
      renderPapelera();
    } catch (err) { alert('No se pudo restaurar: ' + err.message); b.disabled = false; b.textContent = 'Restaurar'; }
  }));
}

// ----------- Ordenar proveedores -----------
function abrirProveedores() { renderProveedores(); root.getElementById('modal-prov').classList.remove('hidden'); }
function cerrarProveedores() { root.getElementById('modal-prov').classList.add('hidden'); }
function renderProveedores() {
  const m = new Map();
  entries.forEach(e => {
    if (!e.proveedor) return;
    const x = m.get(e.proveedor) || { g: new Set(), total: 0 };
    x.g.add(grupoDe(e)); x.total += e.cantidad * e.costoUnitario;
    m.set(e.proveedor, x);
  });
  documentos.forEach(d => { if (d.proveedor && !m.has(d.proveedor)) m.set(d.proveedor, { g: new Set(), total: 0 }); });
  const nombres = [...m.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  const primera = s => normProv(s).split(' ')[0];
  const cont = root.getElementById('prov-list');
  cont.innerHTML = nombres.length ? nombres.map(n => {
    const x = m.get(n);
    const sim = nombres.filter(o => o !== n && (normProv(o) === normProv(n) || (primera(o) && primera(o) === primera(n))));
    const otros = [...sim, ...nombres.filter(o => o !== n && !sim.includes(o))];
    return `
      <div class="prov-row${sim.length ? ' prov-sim' : ''}">
        <div class="prov-info">
          <div class="product-name">${escapeHtml(n)}</div>
          <div class="text-faint" style="font-size:11px;">${x.g.size} ${x.g.size === 1 ? 'registro' : 'registros'} · ${fmtCLP(x.total)}${sim.length ? ` · <span class="prov-aviso">¿es el mismo que ${sim.map(escapeHtml).join(', ')}?</span>` : ''}</div>
        </div>
        <div class="prov-acc">
          <select class="input prov-sel"><option value="">Unir con…</option>${otros.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>
          <button class="btn btn-secondary btn-adjuntar" data-unir="${escapeHtml(n)}">Unir</button>
        </div>
      </div>`;
  }).join('') : '<div class="dash-vacio">Todavía no hay proveedores.</div>';
  cont.querySelectorAll('[data-unir]').forEach(b => b.addEventListener('click', () => {
    unirProveedor(b.dataset.unir, b.parentElement.querySelector('.prov-sel').value);
  }));
}
async function unirProveedor(de, a) {
  if (!a) { alert('Elige con qué proveedor unirlo.'); return; }
  if (!confirm(`Todos los registros de "${de}" pasarán a llamarse "${a}". ¿Continuar?`)) return;
  setSyncStatus('loading', 'Guardando…');
  try {
    const res = await apiPost({ action: 'rename_proveedor', de, a });
    if (!res.ok) throw new Error(res.error);
    entries.forEach(e => { if (e.proveedor === de) e.proveedor = a; });
    documentos.forEach(d => { if (d.proveedor === de) d.proveedor = a; });
    if (filtros.proveedor === de) filtros.proveedor = a;
    setSyncStatus('ok', 'Sincronizado');
    renderProveedores();
    render();
  } catch (err) {
    alert('Error al unir: ' + err.message);
    setSyncStatus('error', 'Error al guardar');
  }
}

// ----------- Export CSV -----------
function exportarCSV() {
  const list = getFiltered();
  if (list.length === 0) return;
  const headers = ['Fecha','Sucursal','Tipo','Factura','Proveedor','Producto','Cantidad','Unidad','Costo Unitario','Subtotal','Estado','Referencia','Notas'];
  const rows = list.map(e => [
    e.fecha, e.sucursal, e.tipoDoc, (documentos.find(d => d.id === e.facturaId) || {}).numero || '', e.proveedor, e.producto, e.cantidad, e.unidad, e.costoUnitario,
    (e.cantidad * e.costoUnitario).toFixed(0), ESTADOS[e.estado].label, e.referencia, (e.notas||'').replace(/\n/g,' '),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `compras_${filtros.mes || 'todas'}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ----------- Eventos -----------

root.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  root.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  vista = t.dataset.view;
  render();
}));
root.getElementById('btn-nuevo').addEventListener('click', () => openModal());
root.getElementById('btn-foto').addEventListener('click', () => root.getElementById('foto-input').click());
root.getElementById('foto-input').addEventListener('change', handleFotoSeleccionada);
root.getElementById('btn-export').addEventListener('click', exportarCSV);
root.getElementById('btn-papelera').addEventListener('click', abrirPapelera);
root.getElementById('pap-close').addEventListener('click', cerrarPapelera);
root.getElementById('modal-papelera').addEventListener('click', e => { if (e.target.id === 'modal-papelera') cerrarPapelera(); });
root.getElementById('btn-proveedores').addEventListener('click', abrirProveedores);
root.getElementById('prov-close').addEventListener('click', cerrarProveedores);
root.getElementById('modal-prov').addEventListener('click', e => { if (e.target.id === 'modal-prov') cerrarProveedores(); });
root.getElementById('doc-close').addEventListener('click', cerrarDoc);
root.getElementById('doc-cancel').addEventListener('click', cerrarDoc);
root.getElementById('doc-save').addEventListener('click', guardarDoc);
root.getElementById('d-neto').addEventListener('input', onNetoDoc);
root.getElementById('d-iva').addEventListener('input', onIvaDoc);
root.getElementById('d-total').addEventListener('input', actualizarCuadreDoc);
root.getElementById('d-proveedor').addEventListener('input', renderValesDoc);
root.getElementById('d-sucursal').addEventListener('change', renderValesDoc);
root.getElementById('d-vales-todos').addEventListener('click', () => { candidatosDoc().forEach(x => docSeleccion.add(x.grupo)); renderValesDoc(); });
root.getElementById('d-foto-btn').addEventListener('click', () => root.getElementById('d-foto-input').click());
root.getElementById('d-foto-input').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const f = await leerFotoSinAnalisis(file);
    docFotoB64 = f.base64;
    const ind = root.getElementById('d-foto-ind'); ind.textContent = 'Foto lista para guardar'; ind.classList.remove('hidden');
  } catch { alert('No se pudo leer la imagen.'); }
});
root.getElementById('btn-refresh').addEventListener('click', loadEntries);
root.getElementById('modal-close').addEventListener('click', closeModal);
root.getElementById('modal-cancel').addEventListener('click', closeModal);
root.getElementById('modal-save').addEventListener('click', saveForm);
root.getElementById('f-cantidad').addEventListener('input', updateSubtotalPreview);
root.getElementById('f-costo').addEventListener('input', updateSubtotalPreview);
root.getElementById('btn-add-item').addEventListener('click', () => { const r = agregarItem(); r.querySelector('.i-producto').focus(); });

root.getElementById('filtro-mes').addEventListener('change', e => { filtros.mes = e.target.value; render(); });
root.getElementById('filtro-sucursal').addEventListener('change', e => { filtros.sucursal = e.target.value; render(); });
root.getElementById('btn-solo-foto').addEventListener('click', () => root.getElementById('solo-foto-input').click());
root.getElementById('solo-foto-input').addEventListener('change', handleSoloFoto);
root.getElementById('btn-adjuntar-foto').addEventListener('click', () => root.getElementById('adjuntar-foto-input').click());
root.getElementById('adjuntar-foto-input').addEventListener('change', handleAdjuntarFoto);
root.getElementById('f-sucursal').addEventListener('change', e => { if (e.target.value) guardarSucursalEquipo(e.target.value); });
root.getElementById('filtro-proveedor').addEventListener('change', e => { filtros.proveedor = e.target.value; render(); });
root.getElementById('filtro-estado').addEventListener('change', e => { filtros.estado = e.target.value; render(); });
root.getElementById('busqueda').addEventListener('input', e => { filtros.busqueda = e.target.value; render(); });

root.getElementById('del-cancel').addEventListener('click', () => {
  root.getElementById('modal-delete').classList.add('hidden');
  confirmDeleteId = null;
});
root.getElementById('del-confirm').addEventListener('click', () => {
  const id = confirmDeleteId;
  root.getElementById('modal-delete').classList.add('hidden');
  confirmDeleteId = null;
  if (id) deleteEntry(id);
});

root.getElementById('ver-foto-close').addEventListener('click', cerrarVerFoto);
root.getElementById('modal-ver-foto').addEventListener('click', e => { if (e.target.id === 'modal-ver-foto') cerrarVerFoto(); });

root.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
root.getElementById('modal-delete').addEventListener('click', e => {
  if (e.target.id === 'modal-delete') {
    root.getElementById('modal-delete').classList.add('hidden');
    confirmDeleteId = null;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && root.host && root.host.isConnected) {
    closeModal();
    root.getElementById('modal-delete').classList.add('hidden');
    cerrarVerFoto();
  }
});

// Refrescar cuando vuelve el foco a la pestaña, solo si la sección está en pantalla
window.addEventListener('focus', () => { if (root.host && root.host.isConnected) loadEntries(); });

// ----------- Init -----------
loadEntries();
