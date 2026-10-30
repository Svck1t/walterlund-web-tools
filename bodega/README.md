# Bodega y Logística WL

Página web (HTML + JavaScript puro, sin build ni dependencias que instalar) para gestionar:

- **Planograma**: asistencia diaria por sucursal y puesto (presente, permiso, ausente, licencia, etc.), vacantes por contratar y cierre de jornada.
- **Flota**: vehículos con patente, estado diario y comentarios.
- **Reportes**: resumen por día, semana o mes, exportable a CSV y PDF de contingencias.
- **Personas**: alta, edición y baja de personal; carga masiva desde Excel (columnas `nombre, empresa, sucursal, puesto`); administración de sucursales, puestos y empresas.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La aplicación completa (diseño, lógica y datos iniciales del personal). |
| `claude-shim.js` | Adaptador de datos. Conecta la página a Firebase, o al navegador si no hay Firebase. **No hace falta editarlo.** |
| `firebase-config.js` | Aquí se pegan las credenciales de Firebase. Es el único archivo que hay que completar. |
| `firestore.rules` | Reglas de seguridad de la base de datos (se pegan en la consola de Firebase). |

Librerías externas (se cargan por CDN, no hay que descargarlas): SheetJS (leer Excel), jsPDF (crear PDF), Google Fonts y Firebase.

## Importante: de dónde vienen los datos

La versión original corría dentro de Claude y guardaba todo en una base de datos interna de Claude, que **no existe fuera de claude.ai**. Para que funcione en GitHub hay dos opciones:

### Opción A. Modo local (cero configuración)

Dejar `firebase-config.js` tal cual (`window.FIREBASE_CONFIG = null`). Funciona de inmediato, pero cada persona ve **solo sus propios datos** (se guardan en su navegador). Sirve para probar.

### Opción B. Datos compartidos con Firebase (recomendada)

Todos los usuarios ven y editan lo mismo, en tiempo real. Es gratis para este volumen de uso.

1. Entrar a <https://console.firebase.google.com> y **crear un proyecto**.
2. En el proyecto: **Compilación → Firestore Database → Crear base de datos** (modo producción; la región da igual).
3. En la pestaña **Reglas** de Firestore, pegar el contenido de `firestore.rules` y **Publicar**.
4. En **Configuración del proyecto (engranaje) → Tus apps → icono `</>` (Web)**, registrar una app web y copiar el objeto `firebaseConfig`.
5. Pegarlo en `firebase-config.js`:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
6. Subir los cambios a GitHub. Al primer ingreso, si la base está vacía, la página carga sola la lista inicial de personal.

La barra superior muestra el estado: punto verde "Conectado" cuando está guardando en Firebase.

> La `apiKey` de Firebase para web **no es un secreto**; es normal que quede en el repositorio. Lo que protege los datos son las reglas de Firestore.

## Cómo publicarlo con GitHub Pages

1. Subir estos archivos a la raíz del repositorio (o a una carpeta, por ejemplo `/bodega`).
2. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch** → elegir la rama (`main`) y la carpeta (`/ (root)` o `/docs`) → **Save**.
3. En un par de minutos queda en `https://TU-USUARIO.github.io/TU-REPO/`.

### Si ya tienen una web y quieren sumarla

- **Enlace**: subir la carpeta como subdirectorio (`/bodega/`) y enlazar desde el menú de la web existente.
- **Incrustada**: dentro de una página existente:

  ```html
  <iframe src="/bodega/index.html" style="width:100%;height:100vh;border:0"></iframe>
  ```
- Los archivos están pensados para ir **juntos en la misma carpeta**. Si se mueve `index.html`, mover también los otros tres.

## Seguridad

Las reglas incluidas (`firestore.rules`) dejan la base **abierta a cualquiera que conozca la dirección de la página**, para que funcione sin inicio de sesión. Es razonable para un uso interno con un link poco difundido, pero la dotación y asistencia son datos del personal. Si necesitan restringir el acceso:

- Activar **Firebase Authentication** (por ejemplo, Google o correo/clave) y cambiar la regla a `allow read, write: if request.auth != null;`. Esto requiere agregar una pantalla de ingreso a la página (no incluida).
- O mantener el repositorio y la página en un hosting con acceso restringido (GitHub Pages privado en planes de pago de GitHub, Cloudflare Access, etc.).

## Colecciones en Firestore

Se crean solas al usar la página: `personal`, `asistencia`, `catalogo`, `vacantes`, `flota`, `flotadia`.

## Solución de problemas

- **Dice "Sin conexión a la base de datos" o "Error de conexión"**: revisar que `firebase-config.js` esté completo y que las reglas de Firestore estén publicadas.
- **No aparece el personal**: debe haber Firestore creado y reglas que permitan escribir; la carga inicial ocurre solo cuando la colección `personal` está vacía.
- **Los datos no coinciden entre dos personas**: probablemente una está en modo local (sin `FIREBASE_CONFIG`).
- **Los botones de CSV/PDF no descargan**: algunos navegadores internos (dentro de apps) bloquean descargas; abrir en Chrome/Safari.
- **Se ve sin estilos de fuente**: Google Fonts no cargó; la página usa fuentes de respaldo y sigue funcionando.
