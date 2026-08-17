/* ============================================
   reposicion.js
   Responsabilidad única: UI de la sección
   "Reposición de Productos".

   Flujo:
   1) Importar el Excel de stock consolidado (SAN FRANCISCO 918,
      VIEL, ALDUNATE).
   2) ReposicionAnalysis detecta productos con stock bajo (≤30)
      en los centros de distribución y sugiere de qué bodega
      trasladar (prioridad VIEL, luego el otro centro sin bajar
      del 70% de su stock).
   3) Se muestra la tabla en pantalla (filtrable por bodega y
      estado) y se puede descargar el PDF "Orden de Traslado"
      (siempre con TODOS los traslados sugeridos, sin importar
      el filtro activo en pantalla).
============================================ */

const ReposicionSection = (() => {

  let allRecords = null;   // registros crudos del Excel importado
  let filas = null;        // resultado de ReposicionAnalysis.analizar()

  let filtroRuta = '';     // '' = todas | 'viel-aldunate' | 'viel-sanFco' | 'aldunate-sanFco' | 'sanFco-aldunate'
  let filtroEstado = '';   // '' = todos  | 'resuelto' | 'sinSolucion'

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

      <div class="results-panel" id="reposicionResults">
        ${renderResults()}
      </div>
    `;
  }

  // ---------- Resultados ----------

  function filasFiltradas() {
    return filas.filter(f => {
      if (filtroRuta && `${f.origen}-${f.destino}` !== filtroRuta) return false;
      if (filtroEstado === 'resuelto' && !f.resuelto) return false;
      if (filtroEstado === 'sinSolucion' && f.resuelto) return false;
      return true;
    });
  }

  function renderResults() {
    if (!allRecords) {
      return `
        <div class="empty-state">
          <div class="icon">🔄</div>
          <strong>Importa el Excel de stock consolidado</strong>
          <span>Debe incluir las columnas Código Producto, Nombre Producto, Unidad de Medida, SAN FRANCISCO 918, VIEL y ALDUNATE.</span>
        </div>`;
    }

    const r = ReposicionAnalysis.resumen(filas);

    const cards = `
      <div class="reposicion-summary">
        <div class="reposicion-card">
          <span class="reposicion-card-label">Productos con stock bajo (≤ ${ReposicionAnalysis.UMBRAL_STOCK_BAJO})</span>
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

    if (filas.length === 0) {
      return `
        ${cards}
        <div class="empty-state">
          <div class="icon">✅</div>
          <strong>Todo el stock está en niveles saludables</strong>
          <span>Ningún producto de SAN FRANCISCO 918 o ALDUNATE está en ${ReposicionAnalysis.UMBRAL_STOCK_BAJO} unidades o menos.</span>
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
        ${filterBar}
        <div class="empty-state">
          <div class="icon">🔎</div>
          <strong>No hay resultados con ese filtro</strong>
          <span>Prueba con otra combinación de bodega y estado.</span>
        </div>
        <div class="import-row">
          <span>No hay traslados que exportar con este filtro.</span>
          <button class="btn-primary" id="generateTrasladoPdf" type="button" disabled>🖨 Generar PDF de orden de traslado</button>
        </div>`;
    }

    const rows = filtradas.map(f => `
      <tr>
        <td>${f.codigo}</td>
        <td>${f.nombre}</td>
        <td>${f.unidad}</td>
        <td>${f.destinoLabel}</td>
        <td style="text-align:right;">${f.stockDestino.toLocaleString('es-CL')}</td>
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

  function attachResultEvents() {
    const rutaSelect = document.getElementById('filtroRutaSelect');
    if (rutaSelect) {
      rutaSelect.addEventListener('change', (e) => {
        filtroRuta = e.target.value;
        document.getElementById('reposicionResults').innerHTML = renderResults();
        attachResultEvents();
      });
    }

    const estadoSelect = document.getElementById('filtroEstadoSelect');
    if (estadoSelect) {
      estadoSelect.addEventListener('change', (e) => {
        filtroEstado = e.target.value;
        document.getElementById('reposicionResults').innerHTML = renderResults();
        attachResultEvents();
      });
    }

    const btn = document.getElementById('generateTrasladoPdf');
    if (btn) {
      btn.addEventListener('click', () => {
        ReposicionOutputPdf.build(filasFiltradas(), ReposicionParser.todayLabel());
      });
    }
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
      filas = ReposicionAnalysis.analizar(records);
      filtroRuta = '';
      filtroEstado = '';

      statusEl.textContent = `${records.length.toLocaleString('es-CL')} productos importados desde "${file.name}".`;

      document.getElementById('reposicionResults').innerHTML = renderResults();
      attachResultEvents();

      if (closeModal) closeModal();
    } catch (err) {
      const msg = describeError(err);
      console.error('Reposición:', err);
      statusEl.textContent = `Error: ${msg}`;
      if (setModalStatus) setModalStatus(`Error: ${msg}`);
    }
  }

  // ---------- Eventos generales ----------

  function attachEvents() {
    document.getElementById('openReposicionImport').addEventListener('click', () => {
      ImportModal.open({
        title: 'Importar stock consolidado',
        hint: 'Excel exportado con el stock de todas las bodegas (.xlsx, .xls)',
        accept: '.xlsx,.xls',
        onFile: (file, { setStatus, close }) => importFile(file, setStatus, close)
      });
    });

    attachResultEvents();
  }

  function render(container) {
    container.innerHTML = template();
    attachEvents();
  }

  return { render };
})();
