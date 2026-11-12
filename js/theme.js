/* ============================================
   theme.js — Modo noche
   Se carga en el <head>, antes que todo, para que la página no parpadee en blanco.
   Funciona invirtiendo los colores de toda la página (incluye secciones con
   Shadow DOM, el iframe de Bodega y los gráficos) y re-invirtiendo fotos y videos
   para que se vean normales. Así no hay que tocar los colores de cada sección.
   Preferencia: la elegida con el botón (se guarda en este equipo) o, si no hay,
   la del sistema operativo.
============================================ */
(function () {
  const KEY = 'wl-tema';
  const html = document.documentElement;
  // contra-filtro: deshace exactamente el filtro de <html> (ver css/style.css)
  const CONTRA = 'invert(1) contrast(1.163) hue-rotate(180deg)';
  const REGLA = `img, video, picture { filter: ${CONTRA}; }`;

  // hoja compartida para las secciones con Shadow DOM (Control de Despachos, Control de Gas)
  let hojaShadow = null;
  try { hojaShadow = new CSSStyleSheet(); } catch (e) {}
  if (hojaShadow && Element.prototype.attachShadow) {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = orig.call(this, init);
      try { root.adoptedStyleSheets = [...root.adoptedStyleSheets, hojaShadow]; } catch (e) {}
      return root;
    };
  }

  const guardado = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const sistemaOscuro = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const esOscuro = () => (guardado() || (sistemaOscuro() ? 'oscuro' : 'claro')) === 'oscuro';

  const LUNA = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  const SOL = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';

  function aplicar() {
    const oscuro = esOscuro();
    html.classList.toggle('dark', oscuro);
    if (hojaShadow) { try { hojaShadow.replaceSync(oscuro ? `@media screen { ${REGLA} }` : ''); } catch (e) {} }
    const b = document.getElementById('themeToggle');
    if (b) {
      b.title = oscuro ? 'Modo día' : 'Modo noche';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${oscuro ? SOL : LUNA}</svg>`;
    }
  }

  aplicar();
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const cambio = () => { if (!guardado()) aplicar(); };
    mq.addEventListener ? mq.addEventListener('change', cambio) : mq.addListener(cambio);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('themeToggle');
    if (b) b.addEventListener('click', () => {
      try { localStorage.setItem(KEY, esOscuro() ? 'claro' : 'oscuro'); } catch (e) {}
      aplicar();
    });
    aplicar();
  });
})();
