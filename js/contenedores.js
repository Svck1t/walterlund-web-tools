/* ============================================
   contenedores.js
   Sección: Cola de Contenedores
   - Consulta CSV desde Google Sheets
   - Renderiza tabla con contenedores
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
          fecha: parts[0].trim(),
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
    
    // Ordena por fecha descendente (más recientes arriba)
    this.data.reverse();
  },
  
  render(container) {
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
      
      <div class="contenedores-section">
        ${this.data.length === 0 
          ? '<div class="placeholder-section">No hay contenedores</div>' 
          : this.renderTable()}
      </div>
    `;
    
    container.innerHTML = html;
  },
  
  renderTable() {
    const grouped = this.groupByImportacion();
    
    let html = '<div class="contenedores-list">';
    
    for (const importNum in grouped) {
      const containers = grouped[importNum];
      html += `
        <div class="import-group">
          <div class="import-header">
            <h3>${importNum}</h3>
            <span class="container-count">${containers.length} contenedor${containers.length > 1 ? 'es' : ''}</span>
          </div>
          <table class="contenedores-table">
            <thead>
              <tr>
                <th>Contenedor</th>
                <th>Cantidad</th>
                <th>Peso (ton)</th>
                <th>Referencia</th>
                <th>Devolución</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              ${containers.map(c => `
                <tr>
                  <td><strong>${c.contenedor}</strong></td>
                  <td>${c.cantidad}</td>
                  <td>${c.peso}</td>
                  <td>${c.ref || '-'}</td>
                  <td>
                    <span class="badge ${c.devolucion === 'pendiente' ? 'badge-warning' : 'badge-info'}">
                      ${c.devolucion || '-'}
                    </span>
                  </td>
                  <td>${new Date(c.fecha).toLocaleDateString('es-CL')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    
    html += '</div>';
    return html;
  },
  
  groupByImportacion() {
    const grouped = {};
    this.data.forEach(c => {
      if (!grouped[c.importNum]) grouped[c.importNum] = [];
      grouped[c.importNum].push(c);
    });
    return grouped;
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
