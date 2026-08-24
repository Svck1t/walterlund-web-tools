/* ============================================
   search.js
   Responsabilidad única: dado un texto de búsqueda,
   un modo ('starts' | 'contains') y un set de registros,
   devolver los que coinciden.
============================================ */

const SmartSearch = (() => {

  /** Normaliza texto: minúsculas, sin tildes, espacios simples */
  function normalize(text) {
    return (text ?? '')
      .toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Convierte el texto buscado en tokens.
   * Cada token debe encontrarse en el texto objetivo (en cualquier orden),
   * lo que permite que "Duplex 77" encuentre "Duplex 350 grs 77x110 cms".
   */
  function tokenize(text) {
    return normalize(text).split(' ').filter(Boolean);
  }

  /**
   * @param {string} query texto escrito por el usuario
   * @param {'starts'|'contains'} mode
   * @param {Array} records salida de ExcelReader.readFile
   * @returns registros filtrados
   */
  function search(query, mode, records) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return records;

    return records.filter((record) => {
      const haystack = normalize(`${record.codProducto} ${record.producto} ${record.codGrupo} ${record.grupo}`);

      if (mode === 'starts') {
        // El primer token debe estar al inicio de alguna palabra del texto;
        // los tokens restantes solo deben aparecer en cualquier parte.
        const words = haystack.split(' ');
        const firstOk = words.some(w => w.startsWith(tokens[0]));
        if (!firstOk) return false;
        return tokens.slice(1).every(t => haystack.includes(t));
      }

      // modo 'contains' (default): todos los tokens deben aparecer en cualquier parte
      return tokens.every(t => haystack.includes(t));
    });
  }

  return { search, normalize };
})();
