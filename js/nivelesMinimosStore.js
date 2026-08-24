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
   usuarios. Mantiene un caché en memoria para que las
   lecturas dentro de la sesión sean instantáneas (el motor
   de análisis las necesita de forma síncrona).

   IMPORTANTE: antes de leer con `get`/`getAll`, hay que
   esperar `await NivelesMinimosStore.cargar()` al menos una
   vez (la sección de Reposición ya lo hace en su render).

   No sabe nada de UI ni del motor de análisis.
============================================ */

const NivelesMinimosStore = (() => {

  // Pega aquí la misma URL del Web App de Apps Script que usa Control de Facturas
  // (Implementar > Administrar implementaciones > copiar URL de la implementación activa)
  const API_URL = 'PEGA_AQUI_LA_URL_DE_TU_WEB_APP';

  let cache = null;      // { codigo: { nombre, unidad, sanFco:{min,max}, aldunate:{min,max}, actualizado } }
  let cargando = null;   // Promise en curso, para no disparar cargas duplicadas en paralelo

  function limpiarNumero(v) {
    return (v === null || v === undefined || v === '' || isNaN(v)) ? undefined : Number(v);
  }

  /** Carga (o recarga si `forzar`) todo el listado desde Sheets al caché en memoria. */
  async function cargar(forzar = false) {
    if (cache && !forzar) return cache;
    if (cargando) return cargando;

    cargando = fetch(`${API_URL}?action=stockNiveles`)
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

  /** Devuelve { nombre, unidad, sanFco:{min,max}, aldunate:{min,max}, actualizado } o null. Síncrono: usa el caché. */
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

  /**
   * Actualiza el mínimo/máximo de un producto (merge parcial contra lo ya guardado).
   * Campos no incluidos en el objeto mantienen su valor actual.
   * Pasar '' en un campo lo borra (queda vacío, no elimina la fila completa).
   */
  async function set(codigo, { nombre, unidad, sanFcoMin, sanFcoMax, aldunateMin, aldunateMax } = {}) {
    const body = {
      accion: 'stockNiveles_set',
      codigo, nombre, unidad,
      minSanFco: sanFcoMin, maxSanFco: sanFcoMax,
      minAldunate: aldunateMin, maxAldunate: aldunateMax,
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS con Apps Script
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) await cargar(true);
    return data;
  }

  /** Elimina por completo la fila de un producto (mínimo, máximo y registro). */
  async function remove(codigo) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'stockNiveles_remove', codigo }),
    });
    const data = await res.json();
    if (data.ok) await cargar(true);
    return data;
  }

  /**
   * Registra en la base los productos importados que todavía no existen
   * (sin mínimo/máximo configurado). Nunca pisa productos ya existentes.
   * `productos`: [{ codigo, nombre, unidad }, ...]
   */
  async function registrarNuevos(productos) {
    if (!productos || !productos.length) return { ok: true, agregados: 0 };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'stockNiveles_bulkNuevos', productos }),
    });
    const data = await res.json();
    if (data.ok && data.agregados > 0) await cargar(true);
    return data;
  }

  return { cargar, estaCargado, get, getAll, count, countConfigurados, set, remove, registrarNuevos };
})();
