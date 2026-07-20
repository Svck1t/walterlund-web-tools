/* ============================================
   stock.js
   Responsabilidad única: renderizar la sección Stock
   y conectar Excel + buscador + tabla de resultados.
   El modal de importación vive en importModal.js
   (componente compartido).
============================================ */

const StockSection = (() => {

  let allRecords = [];   // todo lo importado del Excel
  let searchMode = 'contains';

  function template() {
    return `
      <div class="section-header">
        <div>
          <h1>Stock</h1>
          <p>Consulta de inventario disponible por producto y bodega.</p>
        </div>
        <button class="btn-primary" id="exportBtn">⬇ Exportar</button>
      </div>

      <div class="panel">
        <div class="filter-bar">▽ Filtros</div>
        <div class="filter-body">
          <div class="field">
            <label>PRODUCTO</label>
            <input type="text" id="searchInput" placeholder="Buscar por código o nombre" autocomplete="off">
            <div class="search-mode">
              <label><input type="radio" name="mode" value="contains" checked> Contiene</label>
              <label><input type="radio" name="mode" value="starts"> Comienza con</label>
            </div>
          </div>
          <div class="field">
            <label>FAMILIA</label>
            <select id="familiaSelect">
              <option value="">Todas</option>
            </select>
          </div>
          <button class="btn-search" id="searchBtn">🔍 Buscar</button>
          <button class="btn-clear" id="clearBtn">Limpiar</button>
        </div>
        <div class="import-row">
          <span id="importStatus">${allRecords.length ? `${allRecords.length} productos cargados.` : 'Aún no se ha importado ningún Excel.'}</span>
          <button class="btn-outline" id="openImportModal" type="button">Importar Excel</button>
        </div>
      </div>

      <div class="results-panel" id="resultsPanel">
        ${renderResults(allRecords, true)}
      </div>
    `;
  }

  function renderResults(records, isEmptyInitial = false) {
    if (records.length === 0) {
      return `
        <div class="empty-state">
          <div class="icon">🗄️</div>
          <strong>${isEmptyInitial ? 'Busca productos para ver el stock' : 'Sin resultados'}</strong>
          <span>${isEmptyInitial ? 'Importa un Excel y filtra por nombre, código o familia.' : 'Prueba con otro término de búsqueda.'}</span>
        </div>`;
    }

    const rows = records.map(r => `
      <tr>
        <td>${r.codGrupo}</td>
        <td>${r.codProducto}</td>
        <td>${r.producto}</td>
        <td>${r.unidadMedida}</td>
        <td>${r.pesoUnitario.toLocaleString('es-CL')}</td>
        <td>${r.stockTotal.toLocaleString('es-CL')}</td>
      </tr>`).join('');

    return `
      <div class="results-count">${records.length.toLocaleString('es-CL')} producto(s) encontrado(s)</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código Grupo</th>
              <th>Código Producto</th>
              <th>Descripción</th>
              <th>Unidad</th>
              <th>Peso Unitario</th>
              <th>Stock Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function populateFamilias() {
    const select = document.getElementById('familiaSelect');
    if (!select) return;
    const familias = [...new Set(allRecords.map(r => r.grupo).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todas</option>' +
      familias.map(f => `<option value="${f}">${f}</option>`).join('');
  }

  function runSearch() {
    const query = document.getElementById('searchInput').value;
    const familia = document.getElementById('familiaSelect').value;

    let results = SmartSearch.search(query, searchMode, allRecords);
    if (familia) {
      results = results.filter(r => r.grupo === familia);
    }

    document.getElementById('resultsPanel').innerHTML = renderResults(results, allRecords.length === 0);
  }

  function attachEvents() {
    document.getElementById('searchBtn').addEventListener('click', runSearch);

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    document.getElementById('familiaSelect').addEventListener('change', runSearch);

    document.querySelectorAll('input[name="mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        searchMode = e.target.value;
        runSearch();
      });
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      document.getElementById('searchInput').value = '';
      document.getElementById('familiaSelect').value = '';
      document.getElementById('resultsPanel').innerHTML = renderResults([], true);
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
      alert('Exportar: pendiente de definir formato de salida.');
    });

    document.getElementById('openImportModal').addEventListener('click', () => {
      ImportModal.open({
        title: 'Importar Excel',
        hint: 'Formatos aceptados: .xlsx, .xls',
        accept: '.xlsx,.xls',
        onFile: (file, { setStatus, close }) => importFile(file, setStatus, close)
      });
    });
  }

  async function importFile(file, setModalStatus, closeModal) {
    const statusEl = document.getElementById('importStatus');

    statusEl.textContent = 'Leyendo archivo...';
    if (setModalStatus) setModalStatus(`Leyendo "${file.name}"...`);

    try {
      allRecords = await ExcelReader.readFile(file);
      statusEl.textContent = `${allRecords.length.toLocaleString('es-CL')} productos cargados desde "${file.name}".`;
      populateFamilias();
      runSearch();
      if (closeModal) closeModal();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      if (setModalStatus) setModalStatus(`Error: ${err.message}`);
    }
  }

  function render(container) {
    container.innerHTML = template();
    populateFamilias();
    attachEvents();
  }

  return { render };
})();
