/* ============================================
   stock.js
   Responsabilidad única: renderizar la sección Stock
   y conectar Excel + buscador + tabla de resultados.
   El modal de importación vive en importModal.js
   (componente compartido).
============================================ */

const StockSection = (() => {

  let allRecords = [];   // todo lo importado del Excel o del stock en vivo
  let searchMode = 'contains';
  let soloConStock = true;

  // Peso unitario y nombre de familia: el export en vivo no los trae, salen del
  // informe Softland "Stock Acumulado Valorizado" (data/productos-pesos.json)
  const PESOS_URL = 'data/productos-pesos.json';
  let maestro = null;          // { grupos: {cod: nombre}, productos: {cod: kg} }

  // Bodegas visibles (se recuerda en este navegador). Por defecto se ocultan las de poco movimiento.
  const KEY_BODEGAS = 'wl_stock_bodegas_ocultas';
  let ocultas = new Set(['SAN IGNACIO', 'SANTIAGO CONCHA']);
  try { const g = JSON.parse(localStorage.getItem(KEY_BODEGAS)); if (Array.isArray(g)) ocultas = new Set(g); } catch (_) {}
  const guardarOcultas = () => { try { localStorage.setItem(KEY_BODEGAS, JSON.stringify([...ocultas])); } catch (_) {} };

  // Nombres cortos para las columnas de bodega del export web
  const NOMBRE_BODEGA = {
    'SAN IGNACIO': 'San Ignacio', 'SAN FRANCISCO 918': 'SF 918', 'VIEL': 'Viel',
    'SANTIAGO CONCHA': 'Stgo Concha', 'ALDUNATE': 'Aldunate'
  };
  const corto = b => NOMBRE_BODEGA[b.toUpperCase()] || b;
  const num = n => n.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const celda = (n, cls = '') => `<td class="num ${cls}${n === 0 ? ' cero' : ''}${n < 0 ? ' neg' : ''}">${n === 0 ? '0' : num(n)}</td>`;
  let origen = '';       // texto del estado: de dónde vienen los datos
  let cargadoEn = 0;     // Date.now() de la última carga en vivo
  const LIVE_URL = '/api/stock-live';
  const VIGENCIA_MS = 60 * 1000;

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
              <label><input type="checkbox" id="soloConStock" ${soloConStock ? 'checked' : ''}> Solo con stock</label>
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
          <span id="importStatus">${origen || (allRecords.length ? `${allRecords.length} productos cargados.` : 'Cargando stock en vivo…')}</span>
          <span class="import-btns">
            <button class="btn-outline" id="liveBtn" type="button">⚡ Actualizar stock</button>
            <button class="btn-outline" id="openImportModal" type="button">Importar Excel</button>
          </span>
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

    const todas = records[0].bodegas ? Object.keys(records[0].bodegas) : null;
    const bodegas = todas ? todas.filter(b => !ocultas.has(b.toUpperCase())) : null;
    const kg = r => r.pesoUnitario == null ? '<td class="num cero">—</td>' : `<td class="num kg">${num(r.pesoUnitario)}</td>`;
    const conteo = `<div class="results-count">${records.length.toLocaleString('es-CL')} producto(s) encontrado(s)</div>`;

    // Formato export web: stock por bodega + reservas + disponible
    if (bodegas) {
      const rows = records.map(r => `
        <tr>
          <td class="cod">${r.codProducto}</td>
          <td class="desc">${r.producto} <span class="um">${r.unidadMedida}</span></td>
          ${kg(r)}
          ${bodegas.map(b => celda(r.bodegas[b] ?? 0)).join('')}
          ${celda(r.stockTotal, 'total')}
          ${r.reservas == null ? '' : celda(r.reservas, 'reserva')}
          ${r.disponible == null ? '' : celda(r.disponible, 'disp')}
        </tr>`).join('');
      const chips = todas.map(b => `<label class="bod-chip${ocultas.has(b.toUpperCase()) ? '' : ' on'}">
          <input type="checkbox" data-bodega="${b}" ${ocultas.has(b.toUpperCase()) ? '' : 'checked'}> ${corto(b)}</label>`).join('');
      return `<div class="results-head">${conteo}<div class="bod-chips"><span>Bodegas:</span>${chips}</div></div>
        <div class="table-scroll">
          <table class="data-table stock-bodegas">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th class="num" title="Peso unitario según informe Softland">Kg unit.</th>
                ${bodegas.map(b => `<th class="num">${corto(b)}</th>`).join('')}
                <th class="num">General</th>
                ${records[0].reservas == null ? '' : '<th class="num">Reservas</th>'}
                ${records[0].disponible == null ? '' : '<th class="num">Disponible</th>'}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    // Formato informe Softland: sin detalle por bodega
    const rows = records.map(r => `
      <tr>
        <td>${r.codGrupo}</td>
        <td>${r.codProducto}</td>
        <td>${r.producto}</td>
        <td>${r.unidadMedida}</td>
        <td>${r.pesoUnitario == null ? '—' : r.pesoUnitario.toLocaleString('es-CL')}</td>
        <td>${r.stockTotal.toLocaleString('es-CL')}</td>
      </tr>`).join('');

    return `${conteo}
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
    const nombre = f => (maestro && maestro.grupos[f]) ? `${f} — ${maestro.grupos[f]}` : f;
    const actual = select.value;
    select.innerHTML = '<option value="">Todas</option>' +
      familias.map(f => `<option value="${f}"${f === actual ? ' selected' : ''}>${nombre(f)}</option>`).join('');
  }

  function runSearch() {
    const query = document.getElementById('searchInput').value;
    const familia = document.getElementById('familiaSelect').value;

    let results = SmartSearch.search(query, searchMode, allRecords);
    if (familia) {
      results = results.filter(r => r.grupo === familia);
    }
    if (soloConStock) {
      // Con detalle por bodega, cuenta solo las bodegas visibles
      results = results.filter(r => r.bodegas
        ? Object.entries(r.bodegas).some(([b, v]) => v !== 0 && !ocultas.has(b.toUpperCase()))
        : r.stockTotal !== 0);
    }

    document.getElementById('resultsPanel').innerHTML = renderResults(results, allRecords.length === 0);
  }

  function attachEvents() {
    document.getElementById('searchBtn').addEventListener('click', runSearch);

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    document.getElementById('familiaSelect').addEventListener('change', runSearch);

    document.getElementById('resultsPanel').addEventListener('change', (e) => {
      const b = e.target.dataset && e.target.dataset.bodega;
      if (!b) return;
      if (e.target.checked) ocultas.delete(b.toUpperCase()); else ocultas.add(b.toUpperCase());
      guardarOcultas();
      runSearch();
    });

    document.getElementById('soloConStock').addEventListener('change', (e) => {
      soloConStock = e.target.checked;
      runSearch();
    });

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

    document.getElementById('liveBtn').addEventListener('click', () => cargarEnVivo(true));

    document.getElementById('openImportModal').addEventListener('click', () => {
      ImportModal.open({
        title: 'Importar Excel',
        hint: 'Formatos aceptados: informe Softland (.xlsx/.xls) o export de stock (.xls)',
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
      allRecords = await completarPesos(await ExcelReader.readFile(file));
      cargadoEn = 0;
      origen = `${allRecords.length.toLocaleString('es-CL')} productos cargados desde "${file.name}".`;
      statusEl.textContent = origen;
      populateFamilias();
      runSearch();
      if (closeModal) closeModal();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      if (setModalStatus) setModalStatus(`Error: ${err.message}`);
    }
  }

  async function cargarMaestro() {
    if (maestro) return maestro;
    try {
      const r = await fetch(PESOS_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      maestro = await r.json();
    } catch (err) {
      console.error('Pesos de productos:', err);
      maestro = { grupos: {}, productos: {} };
    }
    return maestro;
  }

  // Completa el peso unitario cuando el archivo no lo trae (export en vivo)
  async function completarPesos(records) {
    const m = await cargarMaestro();
    records.forEach(r => {
      if (r.pesoUnitario == null && m.productos[r.codProducto] != null) r.pesoUnitario = m.productos[r.codProducto];
    });
    return records;
  }

  // Stock en tiempo real: /api/stock-live inicia sesión en la web interna y
  // entrega el mismo export que se descarga a mano, así que lo lee ExcelReader.
  async function cargarEnVivo(forzar = false) {
    const statusEl = document.getElementById('importStatus');
    const btn = document.getElementById('liveBtn');
    if (!statusEl) return;
    statusEl.textContent = 'Cargando stock en vivo…';
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(LIVE_URL + (forzar ? '?fresh=1' : ''), { cache: 'no-store' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch (_) {}
        throw new Error(msg);
      }
      const generado = res.headers.get('X-Stock-Generado');
      const file = new File([await res.blob()], 'stock-en-vivo.xls', { type: 'application/vnd.ms-excel' });
      allRecords = await completarPesos(await ExcelReader.readFile(file));
      cargadoEn = Date.now();
      const hora = (generado ? new Date(generado) : new Date()).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      origen = `⚡ Stock en vivo · ${allRecords.length.toLocaleString('es-CL')} productos · actualizado a las ${hora}`;
      statusEl.textContent = origen;
      populateFamilias();
      runSearch();
    } catch (err) {
      console.error('Stock en vivo:', err);
      statusEl.textContent = `No se pudo cargar el stock en vivo (${err.message}).` +
        (allRecords.length ? ' Se mantiene la última carga.' : ' Puedes usar "Importar Excel".');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function render(container) {
    container.innerHTML = template();
    populateFamilias();
    attachEvents();
    // Al entrar a la sección: refresca si no hay datos o si la carga en vivo tiene más de 1 minuto
    if (!allRecords.length || (cargadoEn && Date.now() - cargadoEn > VIGENCIA_MS)) cargarEnVivo();
  }

  return { render };
})();
