// =====================================================
// SECCIÓN: COLA DE CONTENEDORES (v3)
// KPIs + Tabs (Próximos/Recepcionados) + Checkboxes
// =====================================================

const ContendedoresSection = (() => {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDNIXS9XyYviXNTTkm2fR1wsLOl0y1Cyfm3udLOzAR4zh7KEQhvatuwSEat3L8Gz3QgFRYFk7DfJFz/pub?gid=0&single=true&output=csv';
  
  let allContainers = [];
  let currentTab = 'proximos'; // proximos | recepcionados
  let autoRefreshInterval = null;

  // ============ INICIALIZAR ============
  async function init() {
    console.log('ContendedoresSection.init() iniciando...');
    
    const container = document.getElementById('main-content');
    if (!container) {
      console.error('No se encontró #main-content');
      return;
    }

    container.innerHTML = `
      <div class="section-header">
        <div>
          <h1>📦 Cola de Contenedores</h1>
          <p>Seguimiento de importaciones y recepciones</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-primary" id="btn-refresh-contenedores">🔄 Actualizar Ahora</button>
        </div>
      </div>

      <!-- KPIs DASHBOARD -->
      <div class="contenedores-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Hoy (antes 14:00)</div>
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
    `;

    // Event listeners
    document.getElementById('btn-refresh-contenedores')?.addEventListener('click', loadData);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Cargar datos
    await loadData();

    // Auto-refresh cada 30 segundos
    autoRefreshInterval = setInterval(loadData, 30000);
  }

  // ============ CARGAR DATOS ============
  async function loadData() {
    try {
      const response = await fetch(CSV_URL);
      const csv = await response.text();
      
      // Parsear CSV
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
          horaRecepcion: cells[10] || '',
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
      ${renderPanel('📍 HOY (Antes 14:00)', 'hoy', hoy)}
      ${renderPanel('⏰ PRÓXIMOS DÍAS (Semana)', 'proximos', proximos)}
      ${renderPanel('📅 PRÓXIMA SEMANA', 'semana', semana)}
    `;
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

    const html = `
      <div class="dashboard-panel">
        <h3 class="panel-title">${title}</h3>
        <div class="panel-count">${containers.length}</div>
        <div class="panel-content">
          ${renderImportGroups(containers)}
        </div>
      </div>
    `;
    
    return html;
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
    return `
      <div class="panel-item">
        <div class="item-container">${c.numero}</div>
        <div class="item-details">
          <span class="item-peso">📦 ${c.cantidad}</span>
          <span class="item-peso">${c.peso} kg</span>
          <span style="font-size: 11px; color: #999;">Ref: ${c.ref || 'N/A'}</span>
        </div>
      </div>
    `;
  }

  // ============ RECEPCIONADOS (con checkbox) ============
  function renderRecepcionados() {
    const list = document.getElementById('recepcionados-list');
    if (!list) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    const hace7 = new Date(hoy);
    hace7.setDate(hace7.getDate() - 7);

    // Filtrar: solo los recepcionados en últimos 7 días
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

    // Agrupar por fecha de recepción
    const byDate = {};
    recientes.forEach(c => {
      const key = c.horaRecepcion || 'Sin hora';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(c);
    });

    list.innerHTML = `
      <div style="padding: 20px;">
        ${Object.entries(byDate).map(([hora, items]) => `
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
                  <div style="font-size: 11px; color: #999; margin-top: 4px;">
                    Recibido por: ${c.remitente}
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
    const las14 = new Date(hoy);
    las14.setHours(14, 0, 0);

    return allContainers.filter(c => {
      if (c.estado === 'Recepcionado') return false;
      
      const parts = c.fechaLectura.split('/');
      const fecha = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      
      return fecha.getTime() === hoy.getTime();
    });
  }

  function filterProximosDias() {
    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const las14 = new Date(hoy);
    las14.setHours(14, 0, 0);

    const finSemana = new Date(hoy);
    finSemana.setDate(finSemana.getDate() + (7 - hoy.getDay()));
    finSemana.setHours(23, 59, 59);

    return allContainers.filter(c => {
      if (c.estado === 'Recepcionado') return false;
      
      const parts = c.fechaLectura.split('/');
      const fecha = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      
      return fecha > las14 && fecha <= finSemana;
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
      
      const parts = c.fechaLectura.split('/');
      const fecha = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      
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
    }
  }

  return { init };
})();
/* ============ SECCIÓN COLA DE CONTENEDORES v3 (KPIs + TABS) ============ */

/* KPIs Dashboard */
.contenedores-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 20px 0;
}

.kpi-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  transition: all 0.2s ease;
}

.kpi-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  border-color: #667eea;
}

.kpi-label {
  font-size: 11px;
  font-weight: 700;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.kpi-value {
  font-size: 32px;
  font-weight: 800;
  color: #667eea;
  line-height: 1;
}

.contenedores-refresh-info {
  padding: 0 0 16px;
  text-align: right;
  font-size: 12px;
  color: #999;
}

/* Tabs */
.contenedores-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e0e0e0;
  margin: 20px 0 0 0;
  background: white;
}

.tab-btn {
  flex: 1;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: #5b6b7a;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 3px solid transparent;
  position: relative;
  bottom: -2px;
}

.tab-btn:hover {
  color: #667eea;
}

.tab-btn.active {
  color: #667eea;
  border-bottom-color: #667eea;
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

/* Dashboard (para próximos) */
.contenedores-section {
  padding: 0 20px 20px;
}

.contenedores-dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 20px;
  margin: 20px 0;
}

.dashboard-panel {
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  transition: all 0.3s ease;
}

.dashboard-panel:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  border-color: #ccc;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 14px 16px;
  margin: 0;
}

.panel-count {
  font-size: 28px;
  font-weight: 800;
  color: #667eea;
  padding: 12px 16px;
  text-align: center;
  background: #f9f9f9;
  border-bottom: 1px solid #f0f0f0;
}

.panel-empty {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 20px;
}

.panel-content {
  padding: 12px;
  max-height: 500px;
  overflow-y: auto;
}

.panel-import {
  margin-bottom: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
}

.panel-import-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  font-size: 12px;
}

.panel-import-header strong {
  font-weight: 600;
  color: #333;
}

.badge-count {
  background: #667eea;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
}

.panel-items {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-item {
  background: white;
  padding: 8px;
  border-radius: 4px;
  border-left: 3px solid #667eea;
  font-size: 12px;
}

.item-container {
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.item-details {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.item-peso {
  font-size: 11px;
  color: #666;
  background: #f0f0f0;
  padding: 2px 4px;
  border-radius: 2px;
}

/* Recepcionados list */
.recepcionados-list {
  background: white;
  border-radius: 8px;
  margin: 20px 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #999;
  text-align: center;
}

.empty-state .icon {
  font-size: 48px;
  margin-bottom: 14px;
  opacity: 0.6;
}

.empty-state strong {
  color: #333;
  font-size: 16px;
  margin-bottom: 8px;
  display: block;
}

.empty-state span {
  font-size: 13px;
}

/* Error message */
.error-message {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  padding: 12px 16px;
  margin: 20px;
}

/* Scrollbar custom */
.panel-content::-webkit-scrollbar {
  width: 6px;
}

.panel-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.panel-content::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: #999;
}

/* Responsive */
@media (max-width: 768px) {
  .contenedores-kpis {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .kpi-value {
    font-size: 24px;
  }

  .contenedores-dashboard {
    grid-template-columns: 1fr;
  }

  .panel-content {
    max-height: 300px;
  }

  .tab-btn {
    padding: 10px 12px;
    font-size: 13px;
  }

  .contenedores-tabs {
    gap: 4px;
  }
}
