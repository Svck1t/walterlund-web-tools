/* ============================================
   controlFacturas.js
   Responsabilidad única: renderizar la sección "Control de
   Facturas" embebiendo la webapp externa de registro de
   facturas (Vercel + Google Sheets) dentro de un iframe.
   No duplica datos: es la misma app en vivo, así que alguien
   puede seguir registrando facturas directamente en la URL
   externa mientras otra persona la consulta desde acá — ambas
   ven y escriben sobre el mismo backend (Google Sheets).
============================================ */

const ControlFacturasSection = (() => {

  const APP_URL = 'https://beta-khaki-tau.vercel.app/';

  function template() {
    return `
      <div class="section-header">
        <div>
          <h1>Control de Facturas</h1>
          <p>Registro y consulta de facturas. Es la misma aplicación en vivo — lo que se ingresa acá o en la web original se ve reflejado en ambos lugares.</p>
        </div>
        <a class="btn-outline" href="${APP_URL}" target="_blank" rel="noopener">↗ Abrir en pestaña nueva</a>
      </div>

      <div class="iframe-wrap">
        <iframe
          id="controlFacturasFrame"
          src="${APP_URL}"
          title="Control de Facturas"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade">
        </iframe>
      </div>
    `;
  }

  function render(container) {
    container.innerHTML = template();
  }

  return { render };
})();
