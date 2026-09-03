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
Disponible siempre, sin necesidad de importar un Excel en
la sesión actual: la búsqueda por código/nombre y el listado
de productos configurados salen directo de la base en Sheets.
El filtro por Familia (columna "Grupo" del Excel) es la única
parte que sigue requiriendo un Excel importado en esta sesión,
porque esa columna no se guarda en Sheets.

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

// Productos marcados para NO incluir en el próximo PDF (exclusión manual, temporal
// para esta sesión de análisis — se reinicia solo al importar un Excel nuevo).
// Clave: "codigo::destino" (un producto puede tener dos filas, una por bodega destino).
let excluidosPdf = new Set();

function claveFila(f) {
return `${f.codigo}::${f.destino}`;
}

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

function mensajePdfInfo(filtradas) {
const incluidas = filtradas.filter(f => !excluidosPdf.has(claveFila(f)));
const excluidasCount = filtradas.length - incluidas.length;
const hayFiltroActivo = filtroRuta !== '' || filtroEstado !== '';

if (excluidasCount > 0) {
return `${incluidas.length.toLocaleString('es-CL')} de ${filtradas.length.toLocaleString('es-CL')} se incluirán en el PDF (${excluidasCount} excluido(s) manualmente).`;
}
return hayFiltroActivo
? 'El PDF se genera solo con los traslados que cumplen el filtro actual.'
: 'Revisa los traslados sugeridos antes de imprimir la orden.';
}

// Actualiza el aviso y el estado del botón de PDF sin re-renderizar toda la tabla
// (así no se pierde el estado de scroll ni el foco al tildar/destildar una fila).
function actualizarPdfIncludeInfo() {
const infoEl = document.getElementById('pdfIncludeInfo');
const btn = document.getElementById('generateTrasladoPdf');
if (!infoEl || !btn) return;

const filtradas = filasFiltradas();
infoEl.textContent = mensajePdfInfo(filtradas);

const incluidas = filtradas.filter(f => !excluidosPdf.has(claveFila(f)));
btn.disabled = incluidas.filter(f => f.resuelto).length === 0;
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

const todasIncluidas = filtradas.every(f => !excluidosPdf.has(claveFila(f)));

const rows = filtradas.map(f => {
const key = claveFila(f);
const incluido = !excluidosPdf.has(key);
return `
<tr ${incluido ? '' : 'style="opacity:0.45;"'}>
<td style="text-align:center;">
<input type="checkbox" class="fila-incluir-pdf" data-key="${key}" ${incluido ? 'checked' : ''} title="Incluir en el PDF" />
</td>
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
</tr>`;
}).join('');

const incluidasParaPdf = filtradas.filter(f => !excluidosPdf.has(claveFila(f)));
const resueltosFiltrados = incluidasParaPdf.filter(f => f.resuelto).length;

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
<th style="text-align:center;">
<input type="checkbox" id="pdfIncludeAllCheckbox" ${todasIncluidas ? 'checked' : ''} title="Incluir/excluir todos" />
</th>
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
<span id="pdfIncludeInfo">${mensajePdfInfo(filtradas)}</span>
<button class="btn-primary" id="generateTrasladoPdf" type="button" ${resueltosFiltrados === 0 ? 'disabled' : ''}>🖨 Generar PDF de orden de traslado</button>
</div>
`;
}

// ---------- Vista: Niveles Mínimos ----------

function nivelesSearchTerm() {
const input = document.getElementById('nivelesSearchInput');
return input ? input.value.trim().toLowerCase() : '';
}

function nivelesFamiliaSeleccionada() {
const select = document.getElementById('nivelesFamiliaSelect');
return select ? select.value : '';
}

/** Familias únicas conocidas: las guardadas en Sheets, más las del Excel importado en esta
sesión si trae alguna todavía no sincronizada (por ejemplo, justo mientras se está importando). */
function familiasDisponibles() {
const set = new Set();
Object.values(NivelesMinimosStore.getAll()).forEach(p => { if (p.familia) set.add(p.familia); });
if (allRecords) allRecords.forEach(r => { if (r.familia) set.add(r.familia); });
return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function tieneAlgunNivel(producto) {
if (!producto) return false;
return producto.sanFco?.min != null || producto.sanFco?.max != null ||
producto.aldunate?.min != null || producto.aldunate?.max != null;
}

const LIMITE_BUSQUEDA = 100;
const LIMITE_FAMILIA = 200;

/** Todos los productos conocidos por la base de Niveles Mínimos (Sheets), en forma de lista { codigo, nombre, unidad, familia }. */
function productosDesdeStore() {
const overrides = NivelesMinimosStore.getAll();
return Object.keys(overrides)
.sort((a, b) => a.localeCompare(b, 'es'))
.map(codigo => ({
codigo,
nombre: overrides[codigo].nombre,
unidad: overrides[codigo].unidad,
familia: overrides[codigo].familia || '',
}));
}

function productosParaNiveles() {
const term = nivelesSearchTerm();
const familia = nivelesFamiliaSeleccionada();

if (familia) {
// Preferir el Excel importado en esta sesión (más fresco); si no hay uno,
// usar la Familia ya sincronizada a Sheets en una importación anterior.
let productos = allRecords
? allRecords.filter(r => r.familia === familia)
: productosDesdeStore().filter(r => r.familia === familia);
if (term.length >= 2) {
productos = productos.filter(r => r.codigo.toLowerCase().includes(term) || r.nombre.toLowerCase().includes(term));
}
return productos.slice(0, LIMITE_FAMILIA);
}

if (term.length >= 2) {
return productosDesdeStore()
.filter(r => r.codigo.toLowerCase().includes(term) || (r.nombre || '').toLowerCase().includes(term))
.slice(0, LIMITE_BUSQUEDA);
}

// Sin búsqueda ni familia: mostrar los productos que ya tienen mínimo o máximo configurado,
// sacados directamente de la base en Sheets (no depende de haber importado un Excel en esta sesión).
const overrides = NivelesMinimosStore.getAll();
return productosDesdeStore().filter(r => tieneAlgunNivel(overrides[r.codigo]));
}

function renderNiveles() {
const familias = familiasDisponibles();
const familiaSelectHtml = familias.length > 0 ? `
<div class="field" style="max-width:280px;">
<label>FAMILIA</label>
<select id="nivelesFamiliaSelect">
<option value="">Todas</option>
${familias.map(f => `<option value="${f}">${f}</option>`).join('')}
</select>
</div>` : '';

return `
<div class="panel">
<div class="filter-bar">▽ Buscar producto</div>
<div style="padding:16px 24px; display:flex; gap:16px; flex-wrap:wrap;">
<div class="field" style="max-width:420px; flex:1;">
<label>CÓDIGO O NOMBRE</label>
<input type="text" id="nivelesSearchInput" placeholder="Ej: 1070005009 o DUPLEX..." autocomplete="off" />
</div>
${familiaSelectHtml}
</div>
</div>
<div id="nivelesResultsBody">${renderNivelesResultsBody()}</div>
`;
}

function renderNivelesResultsBody() {
const term = nivelesSearchTerm();
const familia = nivelesFamiliaSeleccionada();
const productos = productosParaNiveles();

const modoFamilia = !!familia;
const modoBusqueda = !modoFamilia && term.length >= 2;

if (productos.length === 0) {
let strong, span;
if (modoFamilia) {
strong = 'Sin productos en esa familia';
span = term.length >= 2 ? 'Prueba con otro código o nombre dentro de esta familia.' : 'Prueba con otra familia.';
} else if (modoBusqueda) {
strong = 'Sin resultados para esa búsqueda';
span = 'Prueba con otro código o nombre.';
} else {
strong = 'Todavía no has configurado ningún nivel mínimo o máximo';
span = 'Busca un producto o selecciona una familia arriba para asignarle un nivel distinto al de por defecto (30 unidades).';
}
return `
<div class="empty-state">
<div class="icon">🔎</div>
<strong>${strong}</strong>
<span>${span}</span>
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

let nota;
if (modoFamilia) {
nota = productos.length === LIMITE_FAMILIA
? `<div class="results-count">Mostrando los primeros ${LIMITE_FAMILIA} resultados de esta familia — usa el buscador para acotar más.</div>`
: `<div class="results-count">${productos.length.toLocaleString('es-CL')} producto(s) en esta familia${term.length >= 2 ? ' que coinciden con la búsqueda' : ''}.</div>`;
} else if (modoBusqueda) {
nota = productos.length === LIMITE_BUSQUEDA
? `<div class="results-count">Mostrando los primeros ${LIMITE_BUSQUEDA} resultados — sigue escribiendo para acotar la búsqueda.</div>`
: `<div class="results-count">${productos.length.toLocaleString('es-CL')} producto(s) encontrados.</div>`;
} else {
nota = `<div class="results-count">${productos.length.toLocaleString('es-CL')} producto(s) con nivel personalizado.</div>`;
}

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

// Checkbox por fila: incluir/excluir del PDF (no re-renderiza toda la tabla)
document.querySelectorAll('.fila-incluir-pdf').forEach(cb => {
cb.addEventListener('change', (e) => {
const key = e.target.dataset.key;
if (e.target.checked) excluidosPdf.delete(key); else excluidosPdf.add(key);

const tr = e.target.closest('tr');
if (tr) tr.style.opacity = e.target.checked ? '' : '0.45';

const selectAllCb = document.getElementById('pdfIncludeAllCheckbox');
if (selectAllCb) {
selectAllCb.checked = filasFiltradas().every(f => !excluidosPdf.has(claveFila(f)));
}

actualizarPdfIncludeInfo();
});
});

// Checkbox del encabezado: incluir/excluir todas las filas visibles de una vez
const selectAllCb = document.getElementById('pdfIncludeAllCheckbox');
if (selectAllCb) {
selectAllCb.addEventListener('change', (e) => {
filasFiltradas().forEach(f => {
const key = claveFila(f);
if (e.target.checked) excluidosPdf.delete(key); else excluidosPdf.add(key);
});
rerenderResults();
});
}

const btn = document.getElementById('generateTrasladoPdf');
if (btn) {
btn.addEventListener('click', () => {
const paraPdf = filasFiltradas().filter(f => !excluidosPdf.has(claveFila(f)));
ReposicionOutputPdf.build(paraPdf, ReposicionParser.todayLabel());
});
}
} else {
const searchInput = document.getElementById('nivelesSearchInput');
if (searchInput) {
searchInput.addEventListener('input', () => refreshNivelesResults());
}

const familiaSelect = document.getElementById('nivelesFamiliaSelect');
if (familiaSelect) {
familiaSelect.addEventListener('change', () => refreshNivelesResults());
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
excluidosPdf.clear();

statusEl.textContent = `${records.length.toLocaleString('es-CL')} productos importados desde "${file.name}".`;

rerenderResults();

if (closeModal) closeModal();

// Sincroniza con la base de Niveles Mínimos en segundo plano, sin bloquear la UI:
// registra los productos nuevos y actualiza la Familia de los que ya existan
// (para que el filtro por Familia funcione después sin depender de este Excel).
// Nunca pisa mínimo/máximo ya configurados.
NivelesMinimosStore
.registrarNuevos(records.map(r => ({ codigo: r.codigo, nombre: r.nombre, unidad: r.unidad, familia: r.familia })))
.then(res => {
if (res.ok && (res.agregados > 0 || res.familiasActualizadas > 0)) {
if (res.agregados > 0) statusEl.textContent += ` ${res.agregados} producto(s) nuevo(s) agregado(s) a Niveles Mínimos.`;
if (vista === 'niveles') refreshNivelesResults();
}
})
.catch(err => console.error('No se pudieron sincronizar productos con Niveles Mínimos:', err));
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
