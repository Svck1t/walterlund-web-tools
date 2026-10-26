/* ============================================
   compras.js
   Sección "Compras Nacionales": carga la webapp Control de Compras
   (antes en control-ingresos-wl.vercel.app) de forma NATIVA dentro
   de la plataforma, igual que Control de Despachos (controlFacturas.js):
   - markup/CSS/JS en js/compras-assets/, montados en un Shadow DOM
     para que su CSS no choque con el de la plataforma.
   - Habla con el mismo Apps Script + Google Sheets que la web original:
     mismos datos, no una copia.
============================================ */

const ComprasSection = (() => {

  const ASSETS_BASE = 'js/compras-assets/';
  const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';

  // Host y shadow root se crean una sola vez y se reutilizan entre visitas
  let hostEl = null;
  let shadowRoot = null;
  let loadPromise = null;

  async function fetchText(path) {
    const res = await fetch(ASSETS_BASE + path);
    if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`);
    return res.text();
  }

  // Las @font-face no funcionan declaradas dentro de un Shadow DOM: las fuentes se cargan en el documento
  function cargarFuentes() {
    if (document.getElementById('compras-fonts')) return;
    const l = document.createElement('link');
    l.id = 'compras-fonts';
    l.rel = 'stylesheet';
    l.href = FONTS_URL;
    document.head.appendChild(l);
  }

  async function buildShadowApp() {
    cargarFuentes();
    hostEl = document.createElement('div');
    hostEl.id = 'comprasHost';
    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<div style="padding:24px; color:#5b6b7a;">Cargando Compras Nacionales...</div>';

    const [css, markup, logic] = await Promise.all([
      fetchText('style.css'),
      fetchText('markup.html'),
      fetchText('logic.js')
    ]);

    shadowRoot.innerHTML = `<style>${css}</style>${markup}`;
    const run = new Function('root', logic);
    run(shadowRoot);
  }

  async function render(container) {
    container.innerHTML = '<div id="comprasMount"></div>';
    const mount = document.getElementById('comprasMount');

    if (!loadPromise) {
      loadPromise = buildShadowApp().catch((err) => {
        loadPromise = null; // permite reintentar si falló
        throw err;
      });
    } else if (hostEl) {
      // Vuelve a la sección: refresca los datos por si cambiaron desde otro dispositivo
      const btn = shadowRoot.getElementById('btn-refresh');
      if (btn) btn.click();
    }

    try {
      await loadPromise;
      mount.appendChild(hostEl);
    } catch (err) {
      console.error('Compras Nacionales:', err);
      mount.innerHTML = `
        <div class="empty-state">
          <div class="icon">⚠️</div>
          <strong>No se pudo cargar Compras Nacionales</strong>
          <span>${describeError(err)}</span>
        </div>`;
    }
  }

  return { render };
})();
