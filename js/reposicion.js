/* ============================================
   reposicion.js
   Responsabilidad única: UI de la sección
   "Reposición de Productos".
   Dos flujos:
   1) Importar el stock consolidado -> genera Excels Viel/Aldunate.
   2) Adjuntar el PDF escaneado ya con las cantidades a mano ->
      OCR dirigido + verificación manual -> genera el PDF final.
============================================ */

const ReposicionSection = (() => {

  // Flujo 1: stock consolidado
  let lastRecords = null;
  let lastFilenames = null;   // incluye vielRecords / aldunateRecords (referencia para el OCR)

  // Flujo 2: escaneo OCR
  let scanBodega = 'viel';
  let scanResults = null;     // [{codigo, nombre, unidad, ocrRaw, cantidad, cropDataUrl}]

  function template() {
    return `
      <div class="section-header">
        <div>
          <h1>Reposición de Productos</h1>
          <p>Importa el stock consolidado por bodega, genera las planillas de solicitud, y luego sube el archivo ya completado para generar el PDF final.</p>
        </div>
      </div>

      <div class="panel">
        <div class="filter-bar">▽ 1. Importar stock consolidado</div>
        <div class="import-row">
          <span id="reposicionStatus">Aún no se ha importado ningún Excel.</span>
          <button class="btn-outline" id="openReposicionImport" type="button">Importar Excel</button>
        </div>
      </div>

      <div class="results-panel" id="reposicionResults">
        ${renderResult()}
      </div>

      <div class="panel" style="margin-top:20px;">
        <div class="filter-bar">▽ 2. Adjuntar archivo escaneado con las cantidades</div>
        <div class="import-row">
          <div class="field" style="max-width:220px;">
            <label>BODEGA</label>
            <select id="scanBodegaSelect">
              <option value="viel">Viel</option>
              <option value="aldunate">Aldunate</option>
            </select>
          </div>
          <span id="scanStatus" style="flex:1;">Sube el PDF firmado/escaneado por la bodega.</span>
          <button class="btn-outline" id="openScanImport" type="button">Adjuntar Archivo</button>
        </div>
      </div>

      <div class="results-panel" id="scanResultsPanel">
        ${renderScanResults()}
      </div>
    `;
  }

  // ---------- Flujo 1: stock consolidado ----------

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
          <span class="reposicion-card-label">Productos importados</span>
          <span class="reposicion-card-value">${lastRecords.length.toLocaleString('es-CL')}</span>
        </div>
        <div class="reposicion-card">
          <span class="reposicion-card-label">${lastFilenames.vielCount.toLocaleString('es-CL')} productos con stock &gt; 0</span>
          <span class="reposicion-card-value reposicion-filename">${lastFilenames.vielFilename}</span>
          <button class="btn-outline reposicion-redownload" data-bodega="viel">Descargar de nuevo</button>
        </div>
        <div class="reposicion-card">
          <span class="reposicion-card-label">${lastFilenames.aldunateCount.toLocaleString('es-CL')} productos con stock &gt; 0</span>
          <span class="reposicion-card-value reposicion-filename">${lastFilenames.aldunateFilename}</span>
          <button class="btn-outline reposicion-redownload" data-bodega="aldunate">Descargar de nuevo</button>
        </div>
      </div>`;
  }

  function attachResultEvents() {
    document.querySelectorAll('.reposicion-redownload').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!lastRecords) return;
        lastFilenames = await ReposicionParser.generateReposicionFiles(lastRecords);
      });
    });
  }

  async function importFile(file, setModalStatus, closeModal) {
    const statusEl = document.getElementById('reposicionStatus');

    statusEl.textContent = 'Leyendo archivo...';
    if (setModalStatus) setModalStatus(`Leyendo "${file.name}"...`);

    try {
      const records = await ReposicionParser.readFile(file);
      if (records.length === 0) throw new Error('No se encontraron productos en el archivo.');

      lastRecords = records;
      if (setModalStatus) setModalStatus('Generando planillas de reposición...');
      lastFilenames = await ReposicionParser.generateReposicionFiles(records);

      statusEl.textContent = `${records.length.toLocaleString('es-CL')} productos procesados desde "${file.name}". Se descargaron ${lastFilenames.vielFilename} y ${lastFilenames.aldunateFilename}.`;

      document.getElementById('reposicionResults').innerHTML = renderResult();
      attachResultEvents();

      if (closeModal) closeModal();
    } catch (err) {
      const msg = describeError(err);
      console.error('Reposición:', err);
      statusEl.textContent = `Error: ${msg}`;
      if (setModalStatus) setModalStatus(`Error: ${msg}`);
    }
  }

  // ---------- Flujo 2: escaneo OCR ----------

  function renderScanResults() {
    if (!scanResults) {
      return `
        <div class="empty-state">
          <div class="icon">🖋️</div>
          <strong>Adjunta el PDF con las cantidades escritas a mano</strong>
          <span>El sistema detecta automáticamente qué productos tienen una cantidad anotada.</span>
        </div>`;
    }

    if (scanResults.length === 0) {
      return `
        <div class="empty-state">
          <div class="icon">🖋️</div>
          <strong>No se detectó ninguna cantidad escrita</strong>
          <span>Revisa que el PDF corresponda a la bodega seleccionada.</span>
        </div>`;
    }

    const rows = scanResults.map((r, i) => `
      <tr>
        <td>${r.codigo}</td>
        <td>${r.nombre}</td>
        <td><img src="${r.cropDataUrl}" alt="recorte" class="scan-crop"></td>
        <td><input type="number" min="0" step="1" class="scan-qty-input" data-index="${i}" value="${r.cantidad ?? ''}" placeholder="?"></td>
      </tr>`).join('');

    return `
      <div class="results-count">
        ${scanResults.length.toLocaleString('es-CL')} producto(s) con anotación detectada — revisa cada cantidad contra el recorte antes de generar el PDF.
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Escrito en el PDF</th>
              <th>Cantidad a confirmar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="import-row">
        <span>Corrige los valores que no coincidan con el recorte antes de continuar.</span>
        <button class="btn-primary" id="generateSolicitudPdf" type="button">Generar PDF de solicitud</button>
      </div>
    `;
  }

  function attachScanResultEvents() {
    document.querySelectorAll('.scan-qty-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.index);
        const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
        scanResults[idx].cantidad = isNaN(val) ? null : val;
      });
    });

    const generateBtn = document.getElementById('generateSolicitudPdf');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        const confirmedRows = scanResults.filter(r => r.cantidad > 0);
        if (confirmedRows.length === 0) {
          alert('No hay cantidades confirmadas mayores a 0 para generar el PDF.');
          return;
        }
        const bodegaLabel = scanBodega === 'viel' ? 'Viel' : 'Aldunate';
        ReposicionOutputPdf.build(confirmedRows, bodegaLabel, ReposicionParser.todayLabel());
      });
    }
  }

  async function runScan(file, setModalStatus, closeModal) {
    const statusEl = document.getElementById('scanStatus');
    const referenceRecords = scanBodega === 'viel'
      ? (lastFilenames && lastFilenames.vielRecords)
      : (lastFilenames && lastFilenames.aldunateRecords);

    if (!referenceRecords) {
      const msg = 'Primero importa el Excel de stock consolidado (paso 1) para tener la lista de productos de referencia.';
      statusEl.textContent = msg;
      if (setModalStatus) setModalStatus(msg);
      return;
    }

    const onProgress = (text) => {
      statusEl.textContent = text;
      if (setModalStatus) setModalStatus(text);
    };

    try {
      onProgress('Iniciando lectura del PDF...');
      scanResults = await ReposicionScan.scan(file, referenceRecords, onProgress);

      statusEl.textContent = `Listo: ${scanResults.length.toLocaleString('es-CL')} cantidad(es) detectada(s) en "${file.name}". Revísalas abajo antes de generar el PDF.`;

      document.getElementById('scanResultsPanel').innerHTML = renderScanResults();
      attachScanResultEvents();

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

    document.getElementById('scanBodegaSelect').addEventListener('change', (e) => {
      scanBodega = e.target.value;
    });

    document.getElementById('openScanImport').addEventListener('click', () => {
      ImportModal.open({
        title: 'Adjuntar archivo escaneado',
        hint: 'PDF escaneado con las cantidades solicitadas a mano (.pdf)',
        accept: '.pdf',
        onFile: (file, { setStatus, close }) => runScan(file, setStatus, close)
      });
    });

    attachResultEvents();
    attachScanResultEvents();
  }

  function render(container) {
    container.innerHTML = template();
    attachEvents();
  }

  return { render };
})();
