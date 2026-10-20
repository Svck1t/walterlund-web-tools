/* ============================================
   app.js
   Punto de entrada. Maneja:
   - navegación entre secciones (SPA sin recarga)
   - submenús colapsables e íconos SVG
   - sidebar: rail de íconos (escritorio) / menú deslizable (teléfono)
   Cada sección nueva solo requiere: agregar el <a data-section="x">
   en index.html y un caso en el switch de loadSection().
============================================ */

document.addEventListener('DOMContentLoaded', () => {


  // ---------- Íconos SVG (se ven igual en Windows, Android y iPhone) ----------
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
    container: '<rect x="2" y="7" width="20" height="12" rx="1.5"/><path d="M6 10v6M10 10v6M14 10v6M18 10v6"/><path d="M5 7l2-3h10l2 3"/>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    boxes: '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    transfer: '<path d="M4 8h13"/><path d="m14 4 4 4-4 4"/><path d="M20 16H7"/><path d="m10 12-4 4 4 4"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  document.querySelectorAll('[data-icon]').forEach(el => {
    const d = ICONS[el.dataset.icon];
    if (d) el.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  });

  // ---------- Sidebar: en escritorio se colapsa a íconos; en teléfono se abre encima ----------
  const sidebar = document.getElementById('sidebar');
  const mq = window.matchMedia('(max-width: 900px)');
  const abrirMovil = abierto => document.body.classList.toggle('nav-open', abierto);

  const content = document.getElementById('content');
  const navItems = document.querySelectorAll('.nav-item[data-section]');

  const SECTION_TITLES = {
    inicio: 'Inicio',
    despachos: 'Despachos',
    'cola-contenedores': 'Cola de Contenedores',
    'control-facturas': 'Control de Facturas',
    traslados: 'Control de Traslados',
    stock: 'Stock',
    reposicion: 'Reposición de Productos',
    descargas: 'Descargas',
    supervision: 'Supervisión',
    apilador: 'Apilador',
    corte: 'Corte'
  };

  function placeholder(section) {
    return `
      <div class="section-header">
        <div>
          <h1>${SECTION_TITLES[section] || section}</h1>
          <p>Este módulo está en construcción.</p>
        </div>
      </div>
      <div class="placeholder-section">
        La sección "${SECTION_TITLES[section] || section}" todavía no está implementada.
      </div>`;
  }

  function loadSection(section) {
    switch (section) {
      case 'cola-contenedores':
        ContendedoresSection.init(content);
        break;
      case 'traslados':
        TrasladosSection.render(content);
        break;
      case 'stock':
        StockSection.render(content);
        break;
      case 'reposicion':
        ReposicionSection.render(content);
        break;
      case 'control-facturas':
        ControlFacturasSection.render(content);
        break;
      default:
        content.innerHTML = placeholder(section);
    }
  }

  function setActive(clicked) {
    navItems.forEach(el => el.classList.remove('active'));
    clicked.classList.add('active');
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      setActive(item);
      loadSection(section);
      if (mq.matches) abrirMovil(false); // en teléfono, cerrar el menú al elegir
      window.scrollTo(0, 0);
    });
  });

  // Submenús colapsables (en modo íconos no se colapsan para no esconder accesos)
  document.querySelectorAll('[data-toggle]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      if (sidebar.classList.contains('collapsed') && !mq.matches) return;
      const target = document.getElementById(toggle.dataset.toggle);
      target.classList.toggle('collapsed');
      toggle.classList.toggle('is-collapsed', target.classList.contains('collapsed'));
    });
  });

  document.getElementById('menuToggle').addEventListener('click', () => {
    if (mq.matches) abrirMovil(!document.body.classList.contains('nav-open'));
    else sidebar.classList.toggle('collapsed');
  });
  document.getElementById('sidebarClose').addEventListener('click', () => abrirMovil(false));
  document.getElementById('sidebarBackdrop').addEventListener('click', () => abrirMovil(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') abrirMovil(false); });
  mq.addEventListener('change', () => abrirMovil(false));

  document.getElementById('logout').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Cerrar sesión: pendiente de conectar con el sistema de autenticación.');
  });

  // Carga inicial: Stock (igual que en la captura de referencia)
  loadSection('stock');
});
