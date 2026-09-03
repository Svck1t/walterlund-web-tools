/* ============================================
   nivelesMinimosStore.js
   Responsabilidad única: guardar y recuperar los niveles
   mínimo/máximo de stock configurados por producto, para
   SAN FRANCISCO 918 y ALDUNATE (los únicos que disparan
   necesidad de reposición). El mínimo reemplaza, producto
   por producto, el umbral fijo por defecto del motor de
   reposición; el máximo queda como dato de referencia.

   Vive en la misma hoja de Google Sheets que Control de
   Facturas (pestaña "StockNiveles"), vía el mismo Apps
   Script Web App — así se sincroniza entre equipos y
   usuarios. Las llamadas pasan por /api/stock-niveles (una
   función serverless propia de este proyecto en Vercel) en
   vez de ir directo a Apps Script, porque Apps Script no
   permite devolver el header CORS que el navegador exige
   para llamadas entre dominios distintos — ver api/stock-niveles.js.

   Mantiene un caché en memoria para que las lecturas dentro
   de la sesión sean instantáneas (el motor de análisis las
   necesita de forma síncrona).

   IMPORTANTE: antes de leer con `get`/`getAll`, hay que
   esperar `await NivelesMinimosStore.cargar()` al menos una
   vez (la sección de Reposición ya lo hace en su render).

   No sabe nada de UI ni del motor de análisis.
============================================ */

const NivelesMinimosStore = (() => {

  const API_URL = '/api/stock-niveles'; // proxy propio del proyecto (ver api/stock-niveles.js), no Apps Script directo

  let cache = null;      // { codigo: { nombre, unidad, sanFco:{min,max}, aldunate:{min,max}, actualizado, familia } }
  let cargando = null;   // Promise en curso, para no disparar cargas duplicadas en paralelo

  /** Carga (o recarga si `forzar`) todo el listado desde Sheets al caché en memoria. */
  async function cargar(forzar = false) {
    if (cache && !forzar) return cache;
    if (cargando) return cargando;

    cargando = fetch(API_URL)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'No se pudieron cargar los niveles mínimos');
        const mapa = {};
        data.productos.forEach(p => { mapa[p.codigo] = p; });
        cache = mapa;
        return cache;
      })
      .finally(() => { cargando = null; });

    return cargando;
  }

  /** True una vez que `cargar()` terminó con éxito al menos una vez en esta sesión. */
  function estaCargado() {
    return cache !== null;
  }

  /** Devuelve { nombre, unidad, sanFco:{min,max}, aldunate:{min,max}, actualizado, familia } o null. Síncrono: usa el caché. */
  function get(codigo) {
    if (!cache) return null;
    return cache[codigo] || null;
  }

  /** Devuelve el objeto completo { codigo: {...}, ... } ya cargado. */
  function getAll() {
    return cache || {};
  }

  /** Cantidad total de productos registrados en la hoja (con o sin mínimo/máximo configurado). */
  function count() {
    return cache ? Object.keys(cache).length : 0;
  }

  /** Cantidad de productos que tienen efectivamente algún mínimo o máximo configurado. */
  function countConfigurados() {
    if (!cache) return 0;
    return Object.values(cache).filter(p =>
      p.sanFco?.min != null || p.sanFco?.max != null ||
      p.aldunate?.min != null || p.aldunate?.max != null
    ).length;
  }

  async function post(body) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /**
   * Actualiza el mínimo/máximo de un producto (merge parcial contra lo ya guardado).
   * Campos no incluidos en el objeto mantienen su valor actual.
   * Pasar '' en un campo lo borra (queda vacío, no elimina la fila completa).
   */
  async function set(codigo, { nombre, unidad, sanFcoMin, sanFcoMax, aldunateMin, aldunateMax } = {}) {
    const data = await post({
      accion: 'stockNiveles_set',
      codigo, nombre, unidad,
      minSanFco: sanFcoMin, maxSanFco: sanFcoMax,
      minAldunate: aldunateMin, maxAldunate: aldunateMax,
    });
    if (data.ok) await cargar(true);
    return data;
  }

  /** Elimina por completo la fila de un producto (mínimo, máximo y registro). */
  async function remove(codigo) {
    const data = await post({ accion: 'stockNiveles_remove', codigo });
    if (data.ok) await cargar(true);
    return data;
  }

  /**
   * Sincroniza con la base los productos detectados al importar un Excel:
   * registra los que todavía no existen (sin mínimo/máximo configurado,
   * nunca pisa productos ya existentes), y actualiza la Familia de los que
   * ya existen si el Excel trae una distinta a la guardada.
   * `productos`: [{ codigo, nombre, unidad, familia }, ...]
   */
  async function registrarNuevos(productos) {
    if (!productos || !productos.length) return { ok: true, agregados: 0, familiasActualizadas: 0 };
    const data = await post({ accion: 'stockNiveles_bulkNuevos', productos });
    if (data.ok && (data.agregados > 0 || data.familiasActualizadas > 0)) await cargar(true);
    return data;
  }

  return { cargar, estaCargado, get, getAll, count, countConfigurados, set, remove, registrarNuevos };
})();
