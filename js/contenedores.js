// =====================================================
// SECCIÓN: COLA DE CONTENEDORES (v4)
// KPIs + Tabs + Checkbox + Hora Salida + Configurable
// =====================================================

const ContendedoresSection = (() => {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDNIXS9XyYviXNTTkm2fR1wsLOl0y1Cyfm3udLOzAR4zh7KEQhvatuwSEat3L8Gz3QgFRYFk7DfJFz/pub?gid=0&single=true&output=csv';
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/d/AKfycbyYourScriptIdHere/usercontent'; // ← Reemplazar con tu ID
  
  // ⚙️ CONFIGURACIÓN
  const HORA_LIMITE = 14; // Cambiar aquí si el límite no es 2 PM (14:00)
  
  let allContainers = [];
  let currentTab = 'proximos';
  let autoRefreshInterval = null;

  // ============ INICIALIZAR ============
  async function init(container) {
    console.log('ContendedoresSection.init() iniciando...');
    
    if (!container) {
      console.error('No se pasó container a ContendedoresSection.init()');
      return;
    }

    container.innerHTML = `
      <div class="section-header">
        <div>
          <h1>📦 Cola de Contenedores</h1>
          <p>Seguimiento de importaciones y recepciones (Límite: ${HORA_LIMITE}:00 PM)</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-primary" id="btn-refresh-contenedores">🔄 Actualizar Ahora</button>
        </div>
      </div>

      <!-- KPIs DASHBOARD -->
      <div class="contenedores-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Hoy (antes ${HORA_LIMITE}:00)</div>
          <div class="kpi-value" id="kpi-hoy">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Próximos Días</div>
          <div class="kpi-value" id="kpi-proximos">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Próxima Semana</div>
          <div class="kpi-value" id="kpi-semana">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">✅ Recepcionados</div>
          <div class="kpi-value" id="kpi-recepcionados">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">⏳ Pendientes</div>
          <div class="kpi-value" id="kpi-pendientes">0</div>
        </div>
      </div>

      <div class="contenedores-refresh-info">
        <span id="last-refresh">Cargando...</span>
      </div>

      <!-- TABS -->
      <div class="contenedores-tabs">
        <button class="tab-btn active" data-tab="proximos">📅 Próximos</button>
        <button class="tab-btn" data-tab="recepcionados">✅ Recepcionados</button>
      </div>

      <!-- CONTENIDO TABS -->
      <div id="tab-proximos" class="tab-content active">
        <div class="contenedores-dashboard" id="dashboard-proximos"></div>
      </div>

      <div id="tab-recepcionados" class="tab-content">
        <div class="recepcionados-list" id="recepcionados-list"></div>
      </div>

      <div id="error-message" class="error-message" style="display: none;"></div>
      <div id="success-message" class="success-message" style="display: none;"></div>
    `;

    document.getElementById('btn-refresh-contenedores')?.addEventListener('click', loadData);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    await loadData();
    autoRefreshInterval = setInterval(loadData, 30000);
  }

  // ============ CARGAR DATOS ============
  async function loadData() {
    try {
      const response = await fetch(CSV_URL);
      const csv = await response.text();
      
      const lines = csv.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      allContainers = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const cells = lines[i].split(',').map(c => c.trim());
        const container = {
          fechaLectura: cells[0],
          numero: cells[1],
          importNum: cells[2],
          cantidad: cells[3],
          peso: cells[4],
          ref: cells[5],
          devolucion: cells[6],
          remitente: cells[7],
          idCorreo: cells[8],
          estado: cells[9] || 'Pendiente',
          horaSalida: cells[11] || '', // ← Columna L (Hora Salida)
          index: i
        };
        allContainers.push(container);
      }

      console.log(`Cargados ${allContainers.length} contenedores`);
      
      renderKPIs();
      renderTabs();
      updateLastRefresh();

    } catch (err) {
      showError(`Error al cargar datos: ${err.message}`);
      console.error(err);
    }
  }

  // ============ KPIs ============
  function renderKPIs() {
    const hoy = filterHoy();
    const proximos = filterProximosDias();
    const semana = filterProximaSemana();
    const recepcionados = allContainers.filter(c => c.estado === 'Recepcionado');
    const pendientes = allContainers.filter(c => c.estado === 'Pendiente');

    document.getElementById('kpi-hoy').textContent = hoy.length;
    document.getElementById('kpi-proximos').textContent = proximos.length;
    document.getElementById('kpi-semana').textContent = semana.length;
    document.getElementById('kpi-recepcionados').textContent = recepcionados.length;
    document.getElementById('kpi-pendientes').textContent = pendientes.length;
  }

  // ============ TABS ============
  function switchTab(tabName) {
    currentTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabName}`);
    });

    if (tabName === 'proximos') {
      renderTabs();
    } else if (tabName === 'recepcionados') {
      renderRecepcionados();
    }
  }

  // ============ RENDER PRÓXIMOS (3 ventanas) ============
  function renderTabs() {
    const dashboard = document.getElementById('dashboard-proximos');
    if (!dashboard) return;

    const hoy = filterHoy();
    const proximos = filterProximosDias();
    const semana = filterProximaSemana();

    dashboard.innerHTML = `
      ${renderPanel(`📍 HOY (Antes ${HORA_LIMITE}:00)`, 'hoy', hoy)}
      ${renderPanel('⏰ PRÓXIMOS DÍAS (Semana)', 'proximos', proximos)}
      ${renderPanel('📅 PRÓXIMA SEMANA', 'semana', semana)}
    `;

    // Agregar event listeners a los checkboxes
    document.querySelectorAll('.checkbox-recibir').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => handleRecibir(e, checkbox.dataset.index));
    });
  }

  function renderPanel(title, id, containers) {
    if (containers.length === 0) {
      return `
        <div class="dashboard-panel">
          <h3 class="panel-title">${title}</h3>
          <div class="panel-count">0</div>
          <div class="panel-empty">Sin contenedores</div>
        </div>
      `;
    }

    return `
      <div class="dashboard-panel">
        <h3 class="panel-title">${title}</h3>
        <div class="panel-count">${containers.length}</div>
        <div class="panel-content">
          ${renderImportGroups(containers)}
        </div>
      </div>
    `;
  }

  function renderImportGroups(containers) {
    const groups = {};
    
    containers.forEach(c => {
      const key = c.importNum;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    return Object.entries(groups).map(([importNum, items]) => `
      <div class="panel-import">
        <div class="panel-import-header">
          <strong>${importNum}</strong>
          <span class="badge-count">${items.length}</span>
        </div>
        <div class="panel-items">
          ${items.map(c => renderContainerItem(c)).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderContainerItem(c) {
    const horaSalidaText = c.horaSalida ? `📤 ${c.horaSalida}` : '⏳ Sin hora';
    
    return `
      <div class="panel-item">
        <div class="item-header">
          <div class="item-container">${c.numero}</div>
          <label class="checkbox-container">
            <input type="checkbox" class="checkbox-recibir" data-index="${c.index}" 
              ${c.estado === 'Recepcionado' ? 'checked' : ''}>
            <span class="checkmark"></span>
          </label>
        </div>
        <div class="item-details">
          <span class="item-peso">📦 ${c.cantidad}</span>
          <span class="item-peso">${c.peso} kg</span>
          <span class="item-hora">${horaSalidaText}</span>
          <span style="font-size: 11px; color: #999;">Ref: ${c.ref || 'N/A'}</span>
        </div>
      </div>
    `;
  }

  // ============ HANDLE CHECKBOX ============
  async function handleRecibir(e, index) {
    const checked = e.target.checked;
    const container = allContainers.find(c => c.index == index);
    
    if (!container) return;

    try {
      const now = new Date();
      const horaRecepcion = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const newEstado = checked ? 'Recepcionado' : 'Pendiente';
      const newHora = checked ? horaRecepcion : '';

      // Llamar a Apps Script
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `index=${index}&estado=${newEstado}&horaRecepcion=${newHora}`
      });

      // Actualizar localmente
      container.estado = newEstado;
      container.horaRecepcion = newHora;

      showSuccess(`Contenedor ${newEstado === 'Recepcionado' ? 'recepcionado' : 'marcado pendiente'} ✓`);
      
      // Rerender
      setTimeout(() => {
        renderKPIs();
        renderTabs();
      }, 500);

    } catch (err) {
      console.error('Error al guardar:', err);
      showError(`Error al guardar cambios: ${err.message}`);
      e.target.checked = !e.target.checked;
    }
  }

  // ============ RECEPCIONADOS ============
  function renderRecepcionados() {
    const list = document.getElementById('recepcionados-list');
    if (!list) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    const hace7 = new Date(hoy);
    hace7.setDate(hace7.getDate() - 7);

    const recientes = allContainers.filter(c => {
      if (c.estado !== 'Recepcionado') return false;
      
      const parts = c.fechaLectura.split('/');
      const fecha = new Date(parts[2], parts[1] - 1, parts[0]);
      return fecha >= hace7;
    });

    if (recientes.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <strong>Sin recepcionados</strong>
          <span>No hay contenedores recepcionados en los últimos 7 días</span>
        </div>
      `;
      return;
    }

    const byHora = {};
    recientes.forEach(c => {
      const key = c.horaRecepcion || 'Sin hora';
      if (!byHora[key]) byHora[key] = [];
      byHora[key].push(c);
    });

    list.innerHTML = `
      <div style="padding: 20px;">
        ${Object.entries(byHora).map(([hora, items]) => `
          <div style="margin-bottom: 20px;">
            <div style="font-weight: 700; color: #667eea; margin-bottom: 10px;">
              🕐 Recepcionados a las ${hora}
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${items.map(c => `
                <div style="padding: 10px; border-left: 3px solid #1e7d34; background: #f0f7f0; border-radius: 4px;">
                  <div style="font-weight: 600; color: #1c2733;">${c.numero}</div>
                  <div style="font-size: 12px; color: #5b6b7a; margin-top: 4px;">
                    ${c.importNum} • ${c.cantidad} un. • ${c.peso} kg
                  </div>
                  ${c.horaSalida ? `<div style="font-size: 11px; color: #667eea; margin-top: 4px;">📤 Salida: ${c.horaSalida}</div>` : ''}
                  <div style="font-size: 11px; color: #999; margin-top: 4px;">
                    Remitente: ${c.remitente}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ============ FILTROS ============
  function filterHoy() {
    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const limiteHora = new Date(hoy);
    limiteHora.setHours(HORA_LIMITE, 0, 0);

    return allContainers.filter(c => {
      if (c.estado === 'Recepcionado') return false;
      if (!c.horaSalida) return false;
      
      const parts = c.horaSalida.split(' ');
      if (!parts[1]) return false;
      
      const timeParts = parts[1].split(':');
      const fechaParts = parts[0].split('/');
      const fecha = new Date(fechaParts[2], fechaParts[1] - 1, fechaParts[0], 
                             parseInt(timeParts[0]), parseInt(timeParts[1]));
      
      return fecha.getTime() === hoy.getTime() || 
             (fecha >= hoy && fecha < limiteHora);
    });
  }

  function filterProximosDias() {
    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const limiteHora = new Date(hoy);
    limiteHora.setHours(HORA_LIMITE, 0, 0);

    const finSemana = new Date(hoy);
    finSemana.setDate(finSemana.getDate() + (7 - hoy.getDay()));
    finSemana.setHours(23, 59, 59);

    return allContainers.filter(c => {
      if (c.estado === 'Recepcionado') return false;
      if (!c.horaSalida) return false;
      
      const parts = c.horaSalida.split(' ');
      if (!parts[1]) return false;
      
      const timeParts = parts[1].split(':');
      const fechaParts = parts[0].split('/');
      const fecha = new Date(fechaParts[2], fechaParts[1] - 1, fechaParts[0], 
                             parseInt(timeParts[0]), parseInt(timeParts[1]));
      
      return fecha > limiteHora && fecha <= finSemana;
    });
  }

  function filterProximaSemana() {
    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(inicioSemana.getDate() + (8 - hoy.getDay()));
    inicioSemana.setHours(0, 0, 0);

    const finSemana = new Date(inicioSemana);
    finSemana.setDate(finSemana.getDate() + 6);
    finSemana.setHours(23, 59, 59);

    return allContainers.filter(c => {
      if (c.estado === 'Recepcionado') return false;
      if (!c.horaSalida) return false;
      
      const parts = c.horaSalida.split(' ');
      if (!parts[1]) return false;
      
      const timeParts = parts[1].split(':');
      const fechaParts = parts[0].split('/');
      const fecha = new Date(fechaParts[2], fechaParts[1] - 1, fechaParts[0], 
                             parseInt(timeParts[0]), parseInt(timeParts[1]));
      
      return fecha >= inicioSemana && fecha <= finSemana;
    });
  }

  // ============ UTILS ============
  function updateLastRefresh() {
    const now = new Date();
    const time = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('last-refresh').textContent = `Última actualización: ${time}`;
  }

  function showError(msg) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
      errorDiv.textContent = msg;
      errorDiv.style.display = 'block';
      setTimeout(() => errorDiv.style.display = 'none', 4000);
    }
  }

  function showSuccess(msg) {
    const successDiv = document.getElementById('success-message');
    if (successDiv) {
      successDiv.textContent = msg;
      successDiv.style.display = 'block';
      setTimeout(() => successDiv.style.display = 'none', 3000);
    }
  }

  return { init };
})();
