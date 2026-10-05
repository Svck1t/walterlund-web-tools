/* ============================================
   contenedores.js
   Sección: Cola de Contenedores
   - Consulta CSV desde Google Sheets
   - Renderiza 3 ventanas: Hoy, Semana Actual, Próxima Semana
   - Actualiza cada 30 segundos
============================================ */

const ContendedoresSection = {
  
  CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDNIXS9XyYviXNTTkm2fR1wsLOl0y1Cyfm3udLOzAR4zh7KEQhvatuwSEat3L8Gz3QgFRYFk7DfJFz/pub?gid=0&single=true&output=csv',
  
  data: [],
  refreshInterval: null,
  
  async fetchData() {
    try {
      const response = await fetch(this.CSV_URL);
      const csv = await response.text();
      this.parseCSV(csv);
      this.render(document.getElementById('content'));
    } catch (error) {
      console.error('Error al cargar CSV:', error);
      document.getElementById('content').innerHTML = `
        <div class="section-header">
          <h1>Cola de Contenedores</h1>
        </div>
        <div class="error-message">
          Error al cargar datos: ${error.message}
        </div>
      `;
    }
  },
  
  parseCSV(csv) {
    const lines = csv.trim().split('\n');
    this.data = [];
    
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 9 && parts[0].match(/\d+\/\d+\/\d+/)) {
        this.data.push({
          fechaHora: parts[0].trim(),
          contenedor: parts[1].trim(),
          importNum: parts[2].trim(),
          cantidad: parts[3].trim(),
          peso: parts[4].trim(),
          ref: parts[5].trim(),
          devolucion: parts[6].trim(),
          remitente: parts[7].trim(),
          correoId: parts[8].trim()
        });
      }
    }
    
    // Ordena por fecha/hora descendente
    this.data.reverse();
  },
  
  getDateInfo() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + (6 - today.getDay()));
    
    const nextWeekEnd = new Date(weekEnd);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);
    
    return { today, tomorrow, weekEnd, nextWeekEnd };
  },
  
  parseDateTime(dateStr) {
    // Formato: "5/10/2026 12:17:34"
    const parts = dateStr.split(' ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1].split(':');
    
    return new Date(
      parseInt(dateParts[2]), 
      parseInt(dateParts[1]) - 1, 
      parseInt(dateParts[0]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1]),
      parseInt(timeParts[2])
    );
  },
  
  filterHoy() {
    const { today } = this.getDateInfo();
    const cutoffTime = new Date(today);
    cutoffTime.setHours(14, 0, 0, 0); // 2 PM
    
    return this.data.filter(item => {
      const dt = this.parseDateTime(item.fechaHora);
      return dt >= today && dt < cutoffTime;
    });
  },
  
  filterProximosDias() {
    const { today, weekEnd } = this.getDateInfo();
    const cutoffTime = new Date(today);
    cutoffTime.setHours(14, 0, 0, 0);
    
    return this.data.filter(item => {
      const dt = this.parseDateTime(item.fechaHora);
      return (dt >= cutoffTime && dt < new Date(today).setDate(today.getDate() + 1)) ||
             (dt >= new Date(today).setDate(today.getDate() + 1) && dt <= weekEnd);
    });
  },
  
  filterProximaSemana() {
    const { weekEnd, nextWeekEnd } = this.getDateInfo();
    const nextMonday = new Date(weekEnd);
    nextMonday.setDate(nextMonday.getDate() + 1);
    
    return this.data.filter(item => {
      const dt = this.parseDateTime(item.fechaHora);
      return dt >= nextMonday && dt <= nextWeekEnd;
    });
  },
  
  render(container) {
    const hoy = this.filterHoy();
    const proximosDias = this.filterProximosDias();
    const proximaSemana = this.filterProximaSemana();
    
    const html = `
      <div class="section-header">
        <div>
          <h1>📦 Cola de Contenedores</h1>
          <p>Importaciones desde correos (actualiza cada 30s)</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-primary" onclick="ContendedoresSection.fetchData()">🔄 Actualizar</button>
        </div>
      </div>
      
      <div class="contenedores-dashboard">
        <div class="dashboard-panel">
          <div class="panel-title">📅 HOY (Antes de 2 PM)</div>
          <div class="panel-count">${hoy.length}</div>
          ${hoy.length === 0 
            ? '<div class="panel-empty">Sin contenedores</div>' 
            : this.renderPanel(hoy)}
        </div>
        
        <div class="dashboard-panel">
          <div class="panel-title">📆 PRÓXIMOS DÍAS (Semana Actual)</div>
          <div class="panel-count">${proximosDias.length}</div>
          ${proximosDias.length === 0 
            ? '<div class="panel-empty">Sin contenedores</div>' 
            : this.renderPanel(proximosDias)}
        </div>
        
        <div class="dashboard-panel">
          <div class="panel-title">📅 PRÓXIMA SEMANA</div>
          <div class="panel-count">${proximaSemana.length}</div>
          ${proximaSemana.length === 0 
            ? '<div class="panel-empty">Sin contenedores</div>' 
            : this.renderPanel(proximaSemana)}
        </div>
      </div>
    `;
    
    container.innerHTML = html;
  },
  
  renderPanel(containers) {
    const grouped = {};
    containers.forEach(c => {
      if (!grouped[c.importNum]) grouped[c.importNum] = [];
      grouped[c.importNum].push(c);
    });
    
    let html = '<div class="panel-content">';
    
    for (const importNum in grouped) {
      const items = grouped[importNum];
      html += `
        <div class="panel-import">
          <div class="panel-import-header">
            <strong>${importNum}</strong>
            <span class="badge badge-count">${items.length}</span>
          </div>
          <div class="panel-items">
            ${items.map(c => `
              <div class="panel-item">
                <div class="item-container">${c.contenedor}</div>
                <div class="item-details">
                  <span class="item-peso">${c.peso} ton</span>
                  ${c.devolucion ? `<span class="badge ${c.devolucion === 'pendiente' ? 'badge-warning' : 'badge-info'}">${c.devolucion}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    html += '</div>';
    return html;
  },
  
  init() {
    this.fetchData();
    
    // Actualiza cada 30 segundos
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.fetchData(), 30000);
  },
  
  destroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }
};
