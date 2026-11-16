# WalterLund — Plataforma Interna

Dashboard modular en HTML/CSS/JS vanilla, sin frameworks, listo para desplegar en Vercel.

## Estructura

```
proyecto/
├── index.html         → shell de la app (sidebar + topbar + contenedor de contenido)
├── css/
│   └── style.css       → tokens de diseño y estilos de todos los módulos
├── js/
│   ├── app.js           → router SPA: cambia de sección sin recargar la página
│   ├── excel.js         → lee y normaliza archivos .xlsx/.xls
│   ├── search.js        → buscador inteligente (contiene / comienza con)
│   └── stock.js          → módulo Stock (UI + import + búsqueda + tabla)
├── assets/              → íconos, logo, imágenes (vacío por ahora)
├── data/                → archivos de ejemplo para pruebas
└── README.md
```

## Cómo probarlo localmente

1. Abre `index.html` directamente en el navegador (doble clic), o sirve la carpeta
   con cualquier servidor estático, por ejemplo:
   ```
   npx serve .
   ```
2. La sección **Stock** carga por defecto.
3. Click en **Importar Excel** y selecciona un informe de stock (.xlsx).
4. Escribe en el buscador — funciona por palabras parciales, ignora mayúsculas/tildes
   y también encuentra medidas tipo `77x110`.

## Cómo agregar un nuevo módulo

1. Agrega el link en `index.html`:
   ```html
   <a href="#" class="nav-item" data-section="compras">📋 Compras</a>
   ```
2. Crea `js/compras.js` con un objeto `ComprasSection = { render(container) {...} }`
   siguiendo el mismo patrón que `stock.js`.
3. Impórtalo en `index.html` (`<script src="js/compras.js"></script>`).
4. En `app.js`, agrega un `case 'compras': ComprasSection.render(content); break;`
   dentro de `loadSection()`.

No hace falta tocar nada más — el sidebar, el router y el resto de los módulos
quedan intactos.

## Pendiente / próximos pasos

- Conectar `Exportar` a una generación real de Excel/CSV.
- Definir origen de datos de Familia si no viene desde el mismo Excel.
- `git init`, repo en GitHub y deploy en Vercel (paso 6-9 del flujo original).

## Producción · Kao Chimigraf

Reemplaza los Excel de fórmulas Kao (Chimigraf y Engatel): maestro de materias primas,
colores con su fórmula, calculadora (kg → cantidades, descontar stock +merma, costo y margen)
y producciones cargadas desde el "Informe de Guías de Recepción" de Softland.

Activar la base de datos (una vez):
1. Google Sheet nueva "Producción Kao" → Extensiones → Apps Script → pegar `gas/ProduccionKaoAPI.gs`.
2. Implementar como aplicación web (ejecutar como: yo · acceso: cualquier usuario) y copiar la URL `/exec`.
3. Pegarla en `api/kao.js` (`APPS_SCRIPT_URL`) y desplegar.
4. En la web: Producción → Kao Chimigraf → "Cargar datos iniciales" (usa `data/kao-seed.json`).

Mientras no esté configurada, la sección funciona en modo vista previa con `data/kao-seed.json` (no guarda cambios).
