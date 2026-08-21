/* ============================================
   nivelesMinimosStore.js
   Responsabilidad única: guardar y recuperar los niveles
   mínimos de stock configurados MANUALMENTE por producto,
   para SAN FRANCISCO 918 y ALDUNATE (los únicos que disparan
   necesidad de reposición). Reemplazan, producto por producto,
   el umbral fijo por defecto del motor de reposición.

   Vive en localStorage de ESTE navegador — no se sincroniza
   entre equipos ni usuarios. Si un producto no tiene override
   configurado acá, el motor de reposición sigue usando el
   umbral por defecto.
   No sabe nada de UI ni del motor de análisis.
============================================ */

const NivelesMinimosStore = (() => {

  const KEY = 'wl_niveles_minimos_v1';

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error('No se pudo leer los niveles mínimos guardados:', err);
      return {};
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('No se pudo guardar los niveles mínimos:', err);
      return false;
    }
  }

  /** Devuelve { sanFco, aldunate } (cada uno number|undefined) o null si no hay override. */
  function get(codigo) {
    const all = readAll();
    return all[codigo] || null;
  }

  /** Devuelve el objeto completo { codigo: {sanFco, aldunate}, ... } */
  function getAll() {
    return readAll();
  }

  /**
   * Actualiza el override de un producto (merge parcial).
   * Pasar `null`/`undefined`/'' en un campo lo borra.
   * Si ambos campos quedan vacíos, se elimina la entrada completa.
   */
  function set(codigo, { sanFco, aldunate } = {}) {
    const all = readAll();
    const actual = all[codigo] || {};

    const limpiar = (v) => (v === null || v === undefined || v === '' || isNaN(v) ? undefined : Number(v));

    const nuevo = {
      sanFco: sanFco === undefined ? actual.sanFco : limpiar(sanFco),
      aldunate: aldunate === undefined ? actual.aldunate : limpiar(aldunate)
    };

    if (nuevo.sanFco === undefined && nuevo.aldunate === undefined) {
      delete all[codigo];
    } else {
      all[codigo] = nuevo;
    }

    return writeAll(all);
  }

  function remove(codigo) {
    const all = readAll();
    delete all[codigo];
    return writeAll(all);
  }

  function count() {
    return Object.keys(readAll()).length;
  }

  return { get, getAll, set, remove, count };
})();
