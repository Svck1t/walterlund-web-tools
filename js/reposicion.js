/* ============================================
reposicion.js
Responsabilidad única: UI de la sección
"Reposición de Productos".

Tiene dos vistas internas:
- "Análisis": importar el stock consolidado y ver los
traslados sugeridos (filtrables por ruta/estado, con PDF).
- "Niveles Mínimos": configurar por producto el nivel
mínimo (dispara reposición) y máximo de stock en SAN
FRANCISCO 918 y ALDUNATE. Se guarda en Google Sheets vía
NivelesMinimosStore — compartido entre equipos y usuarios.

El análisis SIEMPRE se recalcula al vuelo con los niveles
mínimos vigentes — no se cachea — así cualquier cambio hecho
en "Niveles Mínimos" se refleja de inmediato al volver a
"Análisis".
============================================ */

const ReposicionSection = (() => {

let allRecords = null; // registros crudos del último Excel importado

let vista = 'analisis'; // 'analisis' | 'niveles'

let filtroRuta = ''; // '' = todas | 'viel-aldunate' | 'viel-sanFco' | 'aldunate-sanFco' | 'sanFco-aldunate'
let filtroEstado = ''; // '' = todos | 'resuelto' | 'sinSolucion'

// ---------- Nivel mínimo configurado manualmente ----------

function obtenerMinimo(codigo, bodega) {
const producto = NivelesMinimosStore.get(codigo);
if (!producto) return null;
return producto[bodega]?.min ?? null;
}

function filasAnalisis() {
if (!allRecords) return [];
return ReposicionAnalysis.analizar(allRecords, obtenerMinimo);
}

// ---------- Estructura general ----------

function template() {
return `
<div class="section-header">
<div>
<h1>Reposición de Productos</h1>
<p>Importa el stock consolidado y el sistema sugiere automáticamente qué traslados hacer entre bodegas para cubrir los productos con stock bajo.</p>
</div>
</div>

<div class="panel">
<div class="filter-bar">▽ Importar stock consolidado</div>
<div class="import-row">
<span id="reposicionStatus">${allRecords ? `${allRecords.length.toLocaleString('es-CL')} productos importados.` : 'Aún no se ha importado ningún Excel.'}</span>
<button class="btn-outline" id="openReposicionImport" type="button">Importar Excel</button>
</div>
</div>

<div class="cf-tabs" style="display:flex; gap:8px; margin:18px 0 14px;">
<button class="btn-outline tab-toggle" data-vista="analisis" type="button" style="${vista === 'analisis' ? 'background:var(--accent-blue); color:#fff; border-color:var(--accent-blue);' : ''}">Análisis</button>
<button class="btn-outline tab-toggle" data-vista="niveles" type="button" style="${vista === 'niveles' ? 'background:var(--accent-blue); color:#fff; border-color:var(--accent-blue);' : ''}">Niveles Mínimos</button>
</div>

<div id="reposicionResults">
${vista === 'analisis' ? renderAnalisis() : renderNiveles()}
</div>
`;
}

// ---------- Vista: Análisis ----------

function filasFiltradas() {
return filasAnalisis().filter(f => {
if (filtroRuta && `${f.origen}-${f.destino}` !== filtroRuta) return false;
if (filtroEstado === 'resuelto' && !f.resuelto) return false;
if (filtroEstado === 'sinSolucion' && f.resuelto) return false;
return true;
});
}

function renderAnalisis() {
if (!allRecords) {
return `
<div class="empty-state">
<div class="icon">🔄</div>
<strong>Importa el Excel de stock consolidado</strong>
<span>Debe incluir las columnas Código Producto, Nombre Producto, Unidad de Medida, SAN FRANCISCO 918, VIEL y ALDUNATE.</span>
</div>`;
}

const filas = filasAnalisis();
const r = ReposicionAnalysis.resumen(filas);

const cards = `
<div class="reposicion-summary">
<div class="reposicion-card">
<span class="reposicion-card-label">Productos con stock bajo</span>
<span class="reposicion-card-value">${r.totalStockBajo.toLocaleString('es-CL')}</span>
</div>
<div class="reposicion-card">
<span class="reposicion-card-label">Traslados sugeridos</span>
<span class="reposicion-card-value">${r.totalConTraslado.toLocaleString('es-CL')}</span>
</div>
<div class="reposicion-card">
<span class="reposicion-card-label">Sin reposición disponible</span>
<span class="reposicion-card-value">${r.totalSinSolucion.toLocaleString('es-CL')}</span>
</div>
</div>`;

const nivelesNota = `
<p style="color:#6b7280; font-size:13px; margin:-6px 0 16px;">
Umbral por defecto: ${ReposicionAnalysis.UMBRAL_STOCK_BAJO_DEFAULT} unidades.
${NivelesMinimosStore.countConfigurados() > 0 ? `${NivelesMinimosStore.countConfigurados()} producto(s) con nivel mínimo personalizado — configúralos en la pestaña "Niveles Mínimos".` : 'Puedes personalizar el umbral por producto en la pestaña "Niveles Mínimos".'}
</p>`;

if (filas.length === 0) {
return `
${cards}
${nivelesNota}
<div class="empty-state">
<div class="icon">✅</div>
<strong>Todo el stock está en niveles saludables</strong>
<span>Ningún producto de SAN FRANCISCO 918 o ALDUNATE está bajo su nivel mínimo.</span>
</div>`;
}

const filtradas = filasFiltradas();

const filterBar = `
<div class="filter-body" style="padding:16px 24px 0;">
<div class="field" style="max-width:240px;">
<label>RUTA DE TRASLADO</label>
<select id="filtroRutaSelect">
<option value="" ${filtroRuta === '' ? 'selected' : ''}>Todas</option>
<option value="viel-aldunate" ${filtroRuta === 'viel-aldunate' ? 'selected' : ''}>Viel a Aldunate</option>
<option value="viel-sanFco" ${filtroRuta === 'viel-sanFco' ? 'selected' : ''}>Viel a San Francisco</option>
<option value="aldunate-sanFco" ${filtroRuta === 'aldunate-sanFco' ? 'selected' : ''}>Aldunate a San Francisco</option>
<option value="sanFco-aldunate" ${filtroRuta === 'sanFco-aldunate' ? 'selected' : ''}>San Francisco a Aldunate</option>
</select>
</div>
<div class="field" style="max-width:220px;">
<label>ESTADO</label>
<select id="filtroEstadoSelect">
<option value="" ${filtroEstado === '' ? 'selected' : ''}>Todos</option>
<option value="resuelto" ${filtroEstado === 'resuelto' ? 'selected' : ''}>Traslado sugerido</option>
<option value="sinSolucion" ${filtroEstado === 'sinSolucion' ? 'selected' : ''}>Evaluar compra</option>
</select>
</div>
</div>`;

if (filtradas.length === 0) {
return `
${cards}
${nivelesNota}
${filterBar}
<div class="empty-state">
<div class="icon">🔎</div>
<strong>No hay resultados con ese filtro</strong>
<span>Prueba con otra combinación de bodega y estado.</span>
</div>`;
}

const rows = filtradas.map(f => `
<tr>
<td>${f.codigo}</td>
<td>${f.nombre}</td>
<td>${f.unidad}</td>
<td>${f.destinoLabel}</td>
<td style="text-align:right;">${f.stockDestino.toLocaleString('es-CL')}</td>
<td style="text-align:right; color:#6b7280;">${f.umbralDestino.toLocaleString('es-CL')}</td>
<td>${f.origenLabel ?? '—'}</td>
<td style="text-align:right;">${f.resuelto ? f.cantidad.toLocaleString('es-CL') : '—'}</td>
<td>${f.resuelto
? '<span class="badge badge-ok">Traslado sugerido</span>'
: '<span class="badge badge-warn">Evaluar compra</span>'}
</td>
</tr>`).join('');

const resueltosFiltrados = filtradas.filter(f => f.resuelto).length;
const hayFiltroActivo = filtroRuta !== '' || filtroEstado !== '';

return `
${cards}
${nivelesNota}
${filterBar}
<div class="results-count">
${filtradas.length.toLocaleString('es-CL')} de ${filas.length.toLocaleString('es-CL')} producto(s) con stock bajo.
</div>
<div class="table-scroll">
<table class="data-table">
<thead>
<tr>
<th>Código</th>
<th>Producto</th>
<th>Unidad</th>
<th>Bodega con stock bajo</th>
<th>Stock actual</th>
<th>Nivel mín.</th>
<th>Origen sugerido</th>
<th>Cantidad a trasladar</th>
<th>Estado</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>
</div>
<div class="import-row">
<span>${hayFiltroActivo ? 'El PDF se genera solo con los traslados que cumplen el filtro actual.' : 'Revisa los traslados sugeridos antes de imprimir la orden.'}</span>
<button class="btn-primary" id="generateTrasladoPdf" type="button" ${resueltosFiltrados === 0 ? 'disabled' : ''}>🖨 Generar PDF de orden de traslado</button>
</div>
`;
}

// ---------- Vista: Niveles Mínimos ----------

function nivelesSearchTerm() {
const input = document.getElementById('nivelesSearchInput');
return input ? input.value.trim().toLowerCase() : '';
}

function tieneAlgunNivel(producto) {
if (!producto) return false;
return producto.sanFco?.min != null || producto.sanFco?.max != null ||
producto.aldunate?.min != null || producto.aldunate?.max != null;
}

function productosParaNiveles() {
const term = nivelesSearchTerm();

if (term.length >= 2) {
return allRecords
.filter(r => r.codigo.toLowerCase().includes(term) || r.nombre.toLowerCase().includes(term))
.slice(0, 100);
}

// Sin búsqueda: mostrar solo los productos que ya tienen mínimo o máximo configurado
// (no todos los registrados en la hoja — la importación registra a todos sin valores)
const overrides = NivelesMinimosStore.getAll();
return allRecords.filter(r => tieneAlgunNivel(overrides[r.codigo]));
}

function renderNiveles() {
if (!allRecords) {
return `
<div class="empty-state">
<div class="icon">🎚️</div>
<strong>Importa el Excel de stock consolidado primero</strong>
<span>Se usa para buscar productos por código o nombre y configurar su nivel mínimo y máximo.</span>
</div>`;
}

return `
<div class="panel">
<div class="filter-bar">▽ Buscar producto</div>
<div style="padding:16px 24px;">
<div class="field" style="max-width:420px;">
<label>CÓDIGO O NOMBRE</label>
<input type="text" id="nivelesSearchInput" placeholder="Ej: 1070005009 o DUPLEX..." autocomplete="off" />
</div>
</div>
</div>
<div id="nivelesResultsBody">${renderNivelesResultsBody()}</div>
`;
}

function renderNivelesResultsBody() {
const term = nivelesSearchTerm();
const productos = productosParaNiveles();

if (productos.length === 0) {
return `
<div class="empty-state">
<div class="icon">🔎</div>
<strong>${term.length >= 2 ? 'Sin resultados para esa búsqueda' : 'Todavía no has configurado ningún nivel mínimo o máximo'}</strong>
<span>${term.length >= 2 ? 'Prueba con otro código o nombre.' : 'Busca un producto arriba (mínimo 2 caracteres) para asignarle un nivel distinto al de por defecto (30 unidades).'}</span>
</div>`;
}

const overrides = NivelesMinimosStore.getAll();

const rows = productos.map(p => {
const ov = overrides[p.codigo];
const conNivel = tieneAlgunNivel(ov);
const sanFcoMin = ov?.sanFco?.min ?? '';
const sanFcoMax = ov?.sanFco?.max ?? '';
const aldunateMin = ov?.aldunate?.min ?? '';
const aldunateMax = ov?.aldunate?.max ?? '';
return `
<tr class="${conNivel ? 'row-override' : ''}" data-codigo="${p.codigo}" data-nombre="${p.nombre}" data-unidad="${p.unidad}">
<td>${p.codigo}</td>
<td>${p.nombre}</td>
<td>${p.unidad}</td>
<td style="text-align:right;">
<input type="number" min="0" step="1" class="nivel-input nivel-sanfco-min" placeholder="30" value="${sanFcoMin}" />
</td>
<td style="text-align:right;">
<input type="number" min="0" step="1" class="nivel-input nivel-sanfco-max" placeholder="—" value="${sanFcoMax}" />
</td>
<td style="text-align:right;">
<input type="number" min="0" step="1" class="nivel-input nivel-aldunate-min" placeholder="30" value="${aldunateMin}" />
</td>
<td style="text-align:right;">
<input type="number" min="0" step="1" class="nivel-input nivel-aldunate-max" placeholder="—" value="${aldunateMax}" />
</td>
<td>
<button class="btn-outline btn-quitar-nivel" type="button" ${conNivel ? '' : 'disabled'}>Quitar</button>
</td>
</tr>`;
}).join('');

const nota = term.length >= 2 && productos.length === 100
? `<div class="results-count">Mostrando los primeros 100 resultados — sigue escribiendo para acotar la búsqueda.</div>`
: `<div class="results-count">${productos.length.toLocaleString('es-CL')} producto(s)${term.length >= 2 ? ' encontrados' : ' con nivel personalizado'}.</div>`;

return `
${nota}
<div class="table-scroll">
<table class="data-table">
<thead>
<tr>
<th>Código</th>
<th>Producto</th>
<th>Unidad</th>
<th>San Fco. Mín.</th>
<th>San Fco. Máx.</th>
<th>Aldunate Mín.</th>
<th>Aldunate Máx.</th>
<th></th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>
</div>
`;
}

function refreshNivelesResults() {
const el = document.getElementById('nivelesResultsBody');
if (!el) return;
el.innerHTML = renderNivelesResultsBody();
attachNivelesRowEvents();
}

function attachNivelesRowEvents() {
document.querySelectorAll('#nivelesResultsBody tr[data-codigo]').forEach(tr => {
const codigo = tr.dataset.codigo;
const nombre = tr.dataset.nombre;
const unidad = tr.dataset.unidad;

const guardarCampo = async (campo, valor) => {
await NivelesMinimosStore.set(codigo, { nombre, unidad, [campo]: valor });
refreshNivelesResults();
};

tr.querySelector('.nivel-sanfco-min').addEventListener('change', e => guardarCampo('sanFcoMin', e.target.value));
tr.querySelector('.nivel-sanfco-max').addEventListener('change', e => guardarCampo('sanFcoMax', e.target.value));
tr.querySelector('.nivel-aldunate-min').addEventListener('change', e => guardarCampo('aldunateMin', e.target.value));
tr.querySelector('.nivel-aldunate-max').addEventListener('change', e => guardarCampo('aldunateMax', e.target.value));

const btnQuitar = tr.querySelector('.btn-quitar-nivel');
if (!btnQuitar.disabled) {
btnQuitar.addEventListener('click', async () => {
await NivelesMinimosStore.remove(codigo);
refreshNivelesResults();
});
}
});
}

// ---------- Eventos ----------

function attachResultEvents() {
if (vista === 'analisis') {
const rutaSelect = document.getElementById('filtroRutaSelect');
if (rutaSelect) {
rutaSelect.addEventListener('change', (e) => {
filtroRuta = e.target.value;
rerenderResults();
});
}

const estadoSelect = document.getElementById('filtroEstadoSelect');
if (estadoSelect) {
estadoSelect.addEventListener('change', (e) => {
filtroEstado = e.target.value;
rerenderResults();
});
}

const btn = document.getElementById('generateTrasladoPdf');
if (btn) {
btn.addEventListener('click', () => {
ReposicionOutputPdf.build(filasFiltradas(), ReposicionParser.todayLabel());
});
}
} else {
const searchInput = document.getElementById('nivelesSearchInput');
if (searchInput) {
searchInput.addEventListener('input', () => refreshNivelesResults());
}
attachNivelesRowEvents();
}
}

function rerenderResults() {
const el = document.getElementById('reposicionResults');
el.innerHTML = vista === 'analisis' ? renderAnalisis() : renderNiveles();
attachResultEvents();
}

function attachTabEvents() {
document.querySelectorAll('.tab-toggle').forEach(btn => {
btn.addEventListener('click', () => {
vista = btn.dataset.vista;
render(document.getElementById('content'));
});
});
}

// ---------- Importación ----------

async function importFile(file, setModalStatus, closeModal) {
const statusEl = document.getElementById('reposicionStatus');

statusEl.textContent = 'Leyendo archivo...';
if (setModalStatus) setModalStatus(`Leyendo "${file.name}"...`);

try {
const records = await ReposicionParser.readFile(file);
if (records.length === 0) throw new Error('No se encontraron productos en el archivo.');

allRecords = records;
filtroRuta = '';
filtroEstado = '';

statusEl.textContent = `${records.length.toLocaleString('es-CL')} productos importados desde "${file.name}".`;

rerenderResults();

if (closeModal) closeModal();

// Registra en la base de Niveles Mínimos los productos que sean nuevos (en segundo
// plano, sin bloquear la UI). Nunca pisa productos ya configurados.
NivelesMinimosStore
.registrarNuevos(records.map(r => ({ codigo: r.codigo, nombre: r.nombre, unidad: r.unidad })))
.then(res => {
if (res.ok && res.agregados > 0) {
statusEl.textContent += ` ${res.agregados} producto(s) nuevo(s) agregado(s) a Niveles Mínimos.`;
if (vista === 'niveles') refreshNivelesResults();
}
})
.catch(err => console.error('No se pudieron registrar productos nuevos en Niveles Mínimos:', err));
} catch (err) {
const msg = describeError(err);
console.error('Reposición:', err);
statusEl.textContent = `Error: ${msg}`;
if (setModalStatus) setModalStatus(`Error: ${msg}`);
}
}

function attachEvents() {
document.getElementById('openReposicionImport').addEventListener('click', () => {
ImportModal.open({
title: 'Importar stock consolidado',
hint: 'Excel exportado con el stock de todas las bodegas (.xlsx, .xls)',
accept: '.xlsx,.xls',
onFile: (file, { setStatus, close }) => importFile(file, setStatus, close)
});
});

attachTabEvents();
attachResultEvents();
}

// ---------- Render ----------

async function render(container) {
if (!NivelesMinimosStore.estaCargado()) {
container.innerHTML = `
<div class="empty-state">
<div class="icon">⏳</div>
<strong>Cargando niveles configurados...</strong>
<span>Conectando con la base de datos.</span>
</div>`;
try {
await NivelesMinimosStore.cargar();
} catch (err) {
container.innerHTML = `
<div class="empty-state">
<div class="icon">⚠️</div>
<strong>No se pudieron cargar los niveles mínimos</strong>
<span>${err.message}. Revisa tu conexión y vuelve a intentar.</span>
</div>`;
return;
}
}

container.innerHTML = template();
attachEvents();
}

return { render };
})();
