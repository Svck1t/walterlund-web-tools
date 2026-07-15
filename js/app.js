/* ============================================
   app.js
   Punto de entrada. Maneja:
   - navegación entre secciones (SPA sin recarga)
   - toggle del submenú Picking
   - toggle de la sidebar
   Cada sección nueva solo requiere: agregar el <a data-section="x">
   en index.html y un caso en el switch de loadSection().
============================================ */

document.addEventListener('DOMContentLoaded', () => {

  const content = document.getElementById('content');
  const navItems = document.querySelectorAll('.nav-item[data-section]');

  const SECTION_TITLES = {
    inicio: 'Inicio',
    despachos: 'Despachos',
    stock: 'Stock',
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
      case 'stock':
        StockSection.render(content);
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
    });
  });

  // Submenú Picking (colapsable)
  document.querySelectorAll('[data-toggle]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const target = document.getElementById(toggle.dataset.toggle);
      target.classList.toggle('collapsed');
    });
  });

  // Colapsar/expandir sidebar completa
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  document.getElementById('logout').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Cerrar sesión: pendiente de conectar con el sistema de autenticación.');
  });

  // Carga inicial: Stock (igual que en la captura de referencia)
  loadSection('stock');
});
