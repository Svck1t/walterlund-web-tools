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
let editingId = null;
let confirmDeleteId = null;
let vista = 'lista';
let filtros = { mes: monthOf(today()), proveedor: '', estado: 'todos', busqueda: '' };
let fotoPendienteBase64 = null;
let fotoPendienteMime = null;

function today() { return new Date().toISOString().slice(0,10); }
function monthOf(d) { return (d||'').slice(0,7); }
function fmtCLP(n) { return new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(n)||0); }
function fmtNum(n) { return new Intl.NumberFormat('es-CL',{maximumFractionDigits:2}).format(Number(n)||0); }
function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
function uid() { return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

// ----------- API -----------
async function apiGet() {
  const res = await fetch(API_URL, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
async function apiPost(body) {
  // No establecer Content-Type para evitar preflight CORS con Apps Script
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    redirect: 'follow',
  });
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
    creadoEn: Number(e.creadoEn) || Date.now(),
    actualizadoEn: Number(e.actualizadoEn) || Date.now(),
  };
}

// ----------- Lógica filtros / totales -----------
function getFiltered() {
  const q = filtros.busqueda.trim().toLowerCase();
  return entries
    .filter(e => !filtros.mes || monthOf(e.fecha) === filtros.mes)
    .filter(e => !filtros.proveedor || e.proveedor === filtros.proveedor)
    .filter(e => filtros.estado === 'todos' || e.estado === filtros.estado)
    .filter(e => !q || e.producto.toLowerCase().includes(q) || e.proveedor.toLowerCase().includes(q) || e.referencia.toLowerCase().includes(q) || e.notas.toLowerCase().includes(q))
    .sort((a,b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn);
}
function getTotales(list) {
  const t = { total:0, pendiente:0, recibido:0, facturado:0, count:list.length };
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
  renderSummary(); renderFiltros();
  if (vista === 'lista') {
    root.getElementById('vista-lista').classList.remove('hidden');
    root.getElementById('vista-resumen').classList.add('hidden');
    renderLista();
  } else {
    root.getElementById('vista-lista').classList.add('hidden');
    root.getElementById('vista-resumen').classList.remove('hidden');
    renderResumen();
  }
  root.getElementById('total-registros').textContent = entries.length === 1 ? '1 registro total' : entries.length + ' registros totales';
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
  const t = getTotales(list);
  const rows = list.map(e => `
    <tr data-id="${e.id}">
      <td class="mono text-muted" style="font-size:12px;">
        ${e.fecha}${e.referencia ? `<div class="text-faint">${escapeHtml(e.referencia)}</div>` : ''}
      </td>
      <td>
        <div class="product-name">${escapeHtml(e.proveedor)}</div>
        <div class="text-muted">${escapeHtml(e.producto)}</div>
        ${e.notas ? `<div class="note-text">${escapeHtml(e.notas)}</div>` : ''}
      </td>
      <td class="right mono">${fmtNum(e.cantidad)} <span class="text-faint">${escapeHtml(e.unidad)}</span></td>
      <td class="right mono">${fmtCLP(e.costoUnitario)}</td>
      <td class="right mono" style="font-weight:600;">${fmtCLP(e.cantidad * e.costoUnitario)}</td>
      <td>
        <select class="estado-select ${ESTADOS[e.estado].cls}" data-id="${e.id}" data-action="estado">
          ${Object.entries(ESTADOS).map(([k,v]) => `<option value="${k}" ${k===e.estado?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="row-actions">
          ${e.fotoUrl ? `<button class="icon-btn" data-id="${e.id}" data-action="ver-foto" title="Ver foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : ''}
          <button class="icon-btn" data-id="${e.id}" data-action="edit" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
          <button class="icon-btn danger" data-id="${e.id}" data-action="delete" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
      </td>
    </tr>`).join('');

  cont.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Proveedor / Producto</th><th class="right">Cantidad</th>
          <th class="right">C. Unit.</th><th class="right">Subtotal</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="4">Total · ${t.count} ${t.count===1?'registro':'registros'}</td>
          <td class="total">${fmtCLP(t.total)}</td>
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
            <div class="item-detail">${e.fecha} · ${fmtNum(e.cantidad)} ${escapeHtml(e.unidad)} × ${fmtCLP(e.costoUnitario)}${e.referencia ? ' · ' + escapeHtml(e.referencia) : ''}</div>
          </div>
          <div class="item-estado ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].label}</div>
          <div class="item-subtotal">${fmtCLP(e.cantidad * e.costoUnitario)}</div>
        </div>`).join('')}
    </div>`).join('');
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
  const id = ev.target.dataset.id;
  const nuevoEstado = ev.target.value;
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  const updated = { ...entry, estado: nuevoEstado, actualizadoEn: Date.now() };
  // Optimistic update
  Object.assign(entry, updated);
  render();
  setSyncStatus('loading','Guardando…');
  try {
    const res = await apiPost({ action: 'update', entry: updated });
    if (!res.ok) throw new Error(res.error);
    setSyncStatus('ok','Sincronizado');
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
  root.getElementById('foto-status').textContent = 'Analizando boleta…';
  root.getElementById('modal-foto').classList.remove('hidden');

  try {
    const res = await apiPost({ action: 'extract', image: base64, mimeType });
    root.getElementById('modal-foto').classList.add('hidden');
    if (!res.ok) throw new Error(res.error || 'No se pudo leer la boleta');
    abrirModalConDatosExtraidos(res.data || {}, base64, mimeType);
  } catch (err) {
    root.getElementById('modal-foto').classList.add('hidden');
    alert('No se pudo extraer la información automáticamente (' + err.message + '). Completa el registro a mano y revisa que esté todo correcto.');
    openModal();
  }
}

function abrirModalConDatosExtraidos(data, fotoBase64, fotoMime) {
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
  if (data.producto) root.getElementById('f-producto').value = data.producto;
  if (data.cantidad !== null && data.cantidad !== undefined) root.getElementById('f-cantidad').value = data.cantidad;
  if (data.costoUnitario !== null && data.costoUnitario !== undefined) root.getElementById('f-costo').value = data.costoUnitario;
  root.getElementById('f-estado').value = 'recibido';
  root.getElementById('f-notas').value = 'Registrado desde foto de boleta — revisa los datos antes de guardar.';
  updateSubtotalPreview();
}

function verFoto(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !e.fotoUrl) return;
  root.getElementById('foto-ver-img').src = e.fotoUrl;
  root.getElementById('modal-ver-foto').classList.remove('hidden');
}
function cerrarVerFoto() { root.getElementById('modal-ver-foto').classList.add('hidden'); }

async function openModal(id) {
  editingId = id || null;
  fotoPendienteBase64 = null;
  fotoPendienteMime = null;
  root.getElementById('modal-foto-indicator').classList.add('hidden');
  root.getElementById('modal-title').textContent = editingId ? 'Editar registro' : 'Nuevo registro';
  root.getElementById('modal-save-label').textContent = editingId ? 'Guardar cambios' : 'Agregar registro';
  if (editingId) {
    const e = entries.find(x => x.id === editingId);
    root.getElementById('f-fecha').value = e.fecha;
    root.getElementById('f-proveedor').value = e.proveedor;
    root.getElementById('f-producto').value = e.producto;
    root.getElementById('f-cantidad').value = e.cantidad;
    root.getElementById('f-unidad').value = e.unidad;
    root.getElementById('f-costo').value = e.costoUnitario;
    root.getElementById('f-estado').value = e.estado;
    root.getElementById('f-referencia').value = e.referencia;
    root.getElementById('f-notas').value = e.notas;
  } else {
    root.getElementById('f-fecha').value = today();
    root.getElementById('f-proveedor').value = '';
    root.getElementById('f-producto').value = '';
    root.getElementById('f-cantidad').value = '';
    root.getElementById('f-unidad').value = 'unidad';
    root.getElementById('f-costo').value = '';
    root.getElementById('f-estado').value = 'pendiente';
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
  const c = parseFloat(root.getElementById('f-cantidad').value);
  const u = parseFloat(root.getElementById('f-costo').value);
  const box = root.getElementById('subtotal-preview');
  if (!isNaN(c) && !isNaN(u) && c > 0 && u > 0) {
    root.getElementById('subtotal-value').textContent = fmtCLP(c * u);
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
}

async function saveForm() {
  const fecha = root.getElementById('f-fecha').value;
  const proveedor = root.getElementById('f-proveedor').value.trim();
  const producto = root.getElementById('f-producto').value.trim();
  const cantidad = parseFloat(root.getElementById('f-cantidad').value);
  const unidad = root.getElementById('f-unidad').value;
  const costoUnitario = parseFloat(root.getElementById('f-costo').value);
  const estado = root.getElementById('f-estado').value;
  const referencia = root.getElementById('f-referencia').value.trim();
  const notas = root.getElementById('f-notas').value.trim();
  if (!fecha || !proveedor || !producto || isNaN(cantidad) || isNaN(costoUnitario)) return;

  const saveBtn = root.getElementById('modal-save');
  saveBtn.disabled = true;
  setSyncStatus('loading','Guardando…');

  try {
    if (editingId) {
      const existing = entries.find(e => e.id === editingId);
      const updated = { ...existing, fecha, proveedor, producto, cantidad, unidad, costoUnitario, estado, referencia, notas, actualizadoEn: Date.now() };
      const res = await apiPost({ action: 'update', entry: updated });
      if (!res.ok) throw new Error(res.error);
      Object.assign(existing, updated);
    } else {
      const entry = { id: uid(), fecha, proveedor, producto, cantidad, unidad, costoUnitario, estado, referencia, notas, fotoUrl: '', creadoEn: Date.now(), actualizadoEn: Date.now() };
      const body = { action: 'add', entry };
      if (fotoPendienteBase64) { body.image = fotoPendienteBase64; body.mimeType = fotoPendienteMime; }
      const res = await apiPost(body);
      if (!res.ok) throw new Error(res.error);
      if (res.entry && res.entry.fotoUrl) entry.fotoUrl = res.entry.fotoUrl;
      entries.unshift(entry);
    }
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

async function deleteEntry(id) {
  setSyncStatus('loading','Eliminando…');
  try {
    const res = await apiPost({ action: 'delete', id });
    if (!res.ok) throw new Error(res.error);
    entries = entries.filter(e => e.id !== id);
    setSyncStatus('ok','Sincronizado');
    render();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
    setSyncStatus('error','Error al eliminar');
  }
}

// ----------- Export CSV -----------
function exportarCSV() {
  const list = getFiltered();
  if (list.length === 0) return;
  const headers = ['Fecha','Proveedor','Producto','Cantidad','Unidad','Costo Unitario','Subtotal','Estado','Referencia','Notas'];
  const rows = list.map(e => [
    e.fecha, e.proveedor, e.producto, e.cantidad, e.unidad, e.costoUnitario,
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
root.getElementById('btn-refresh').addEventListener('click', loadEntries);
root.getElementById('modal-close').addEventListener('click', closeModal);
root.getElementById('modal-cancel').addEventListener('click', closeModal);
root.getElementById('modal-save').addEventListener('click', saveForm);
root.getElementById('f-cantidad').addEventListener('input', updateSubtotalPreview);
root.getElementById('f-costo').addEventListener('input', updateSubtotalPreview);

root.getElementById('filtro-mes').addEventListener('change', e => { filtros.mes = e.target.value; render(); });
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
