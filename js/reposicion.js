/* ============================================
   reposicion.js
   Responsabilidad única: UI de la sección
   "Reposición de Productos" — importar el Excel
   consolidado de bodegas y generar los 2 Excels
   de reposición (Viel / Aldunate).
============================================ */

const ReposicionSection = (() => {

  let lastRecords = null;
  let lastFilenames = null;

  function template() {
    return `
      <div class="section-header">
        <div>
          <h1>Reposición de Productos</h1>
          <p>Importa el stock consolidado por bodega y genera las planillas de solicitud para Viel y Aldunate.</p>
        </div>
      </div>

      <div class="panel">
        <div class="filter-bar">▽ Importar stock consolidado</div>
        <div class="import-row">
          <span id="reposicionStatus">Aún no se ha importado ningún Excel.</span>
          <button class="btn-outline" id="openReposicionImport" type="button">Importar Excel</button>
        </div>
      </div>

      <div class="results-panel" id="reposicionResults">
        ${renderResult()}
      </div>
    `;
  }

  function renderResult() {
    if (!lastRecords) {
      return `
        <div class="empty-state">
          <div class="icon">🔄</div>
          <strong>Importa el Excel de stock por bodega</strong>
          <span>Debe incluir las columnas Código Producto, Nombre Producto, Unidad de Medida, VIEL y ALDUNATE.</span>
        </div>`;
    }

    return `
      <div class="reposicion-summary">
        <div class="reposicion-card">
          <span class="reposicion-card-label">Productos procesados</span>
          <span class="reposicion-card-value">${lastRecords.length.toLocaleString('es-CL')}</span>
        </div>
        <div class="reposicion-card">
          <span class="reposicion-card-label">Archivo generado</span>
          <span class="reposicion-card-value reposicion-filename">${lastFilenames.vielFilename}</span>
          <button class="btn-outline reposicion-redownload" data-bodega="viel">Descargar de nuevo</button>
        </div>
        <div class="reposicion-card">
          <span class="reposicion-card-label">Archivo generado</span>
          <span class="reposicion-card-value reposicion-filename">${lastFilenames.aldunateFilename}</span>
          <button class="btn-outline reposicion-redownload" data-bodega="aldunate">Descargar de nuevo</button>
        </div>
      </div>`;
  }

  function attachResultEvents() {
    document.querySelectorAll('.reposicion-redownload').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!lastRecords) return;
        // Vuelve a generar ambos archivos (ambos se regeneran juntos porque
        // comparten los mismos datos y la misma fecha).
        lastFilenames = ReposicionParser.generateReposicionFiles(lastRecords);
      });
    });
  }

  async function importFile(file, setModalStatus, closeModal) {
    const statusEl = document.getElementById('reposicionStatus');

    statusEl.textContent = 'Leyendo archivo...';
    if (setModalStatus) setModalStatus(`Leyendo "${file.name}"...`);

    try {
      const records = await ReposicionParser.readFile(file);

      if (records.length === 0) {
        throw new Error('No se encontraron productos en el archivo.');
      }

      lastRecords = records;
      lastFilenames = ReposicionParser.generateReposicionFiles(records);

      statusEl.textContent = `${records.length.toLocaleString('es-CL')} productos procesados desde "${file.name}". Se descargaron ${lastFilenames.vielFilename} y ${lastFilenames.aldunateFilename}.`;

      document.getElementById('reposicionResults').innerHTML = renderResult();
      attachResultEvents();

      if (closeModal) closeModal();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      if (setModalStatus) setModalStatus(`Error: ${err.message}`);
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

    attachResultEvents();
  }

  function render(container) {
    container.innerHTML = template();
    attachEvents();
  }

  return { render };
})();
