/* ============================================
   controlFacturas.js
   Responsabilidad única: cargar la webapp de "Control de
   Facturas" (originalmente hospedada aparte en Vercel) de
   forma NATIVA dentro de esta sección — sin iframe.

   Cómo funciona:
   - El markup/CSS/JS de esa app viven en
     js/control-facturas-assets/ (extraídos de su index.html
     original, prácticamente intactos).
   - Se montan dentro de un Shadow DOM: así su CSS (que usa
     selectores genéricos como body, header, input, table)
     queda aislado y no pisa los estilos del resto de la
     plataforma, y viceversa.
   - Su JS original usaba `document.getElementById(...)` /
     `document.querySelectorAll(...)` apuntando al documento
     completo; en logic.js esas llamadas fueron reemplazadas
     por `root.getElementById(...)` etc., donde `root` es el
     shadow root — así los selectores solo buscan dentro de
     su propio contenido, no en el resto de la plataforma.
   - Sigue hablando directo con el mismo backend (Apps Script
     + Google Sheets) que la web original: es la misma app,
     mismos datos, no una copia.
   - El botón "Imprimir guía" fue adaptado para abrir una
     ventana aparte con solo la guía (ver print.css), porque
     el truco original de "ocultar todo el <body> salvo el
     área de impresión" no puede alcanzar contenido fuera del
     Shadow DOM.
============================================ */

const ControlFacturasSection = (() => {

  const ASSETS_BASE = 'js/control-facturas-assets/';

  // El host y su shadow root se crean UNA sola vez y se reutilizan entre
  // visitas a la sección (moviendo el mismo nodo en el DOM), para no volver
  // a pedir los assets ni perder el estado (pestaña activa, caché en memoria)
  // cada vez que el usuario navega a otra sección y vuelve.
  let hostEl = null;
  let shadowRoot = null;
  let loadPromise = null;

  async function fetchText(path) {
    const res = await fetch(ASSETS_BASE + path);
    if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`);
    return res.text();
  }

  async function buildShadowApp() {
    hostEl = document.createElement('div');
    hostEl.id = 'controlFacturasHost';
    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = '<div class="cf-loading" style="padding:24px; color:#5b6b7a;">Cargando Control de Facturas...</div>';

    const [css, markup, logic, printCss] = await Promise.all([
      fetchText('style.css'),
      fetchText('markup.html'),
      fetchText('logic.js'),
      fetchText('print.css')
    ]);

    shadowRoot.innerHTML = `<style>${css}</style>${markup}`;

    // Ejecuta la lógica original con `root` apuntando al shadow root
    // (en vez del document completo) y `CF_PRINT_CSS` disponible para
    // el botón de impresión de la guía de transporte.
    const run = new Function('root', 'CF_PRINT_CSS', logic);
    run(shadowRoot, printCss);
  }

  function template() {
    return `
      <div class="section-header">
        <div>
          <h1>Control de Facturas</h1>
          <p>Registro y consulta de facturas.</p>
        </div>
      </div>
      <div id="controlFacturasMount"></div>
    `;
  }

  async function render(container) {
    container.innerHTML = template();
    const mount = document.getElementById('controlFacturasMount');

    if (!loadPromise) {
      loadPromise = buildShadowApp().catch((err) => {
        loadPromise = null; // permite reintentar si falló
        throw err;
      });
    }

    try {
      await loadPromise;
      mount.appendChild(hostEl);
    } catch (err) {
      console.error('Control de Facturas:', err);
      mount.innerHTML = `
        <div class="empty-state">
          <div class="icon">⚠️</div>
          <strong>No se pudo cargar Control de Facturas</strong>
          <span>${describeError(err)}</span>
        </div>`;
    }
  }

  return { render };
})();
