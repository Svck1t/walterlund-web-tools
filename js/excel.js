/* ============================================
   excel.js
   Responsabilidad única: leer un archivo Excel
   (.xlsx / .xls) y devolver filas de datos limpias.
   No sabe nada de la UI ni del buscador.
============================================ */

const ExcelReader = (() => {

  // Nombres de columna que reconocemos en el informe de stock (Softland).
  // Si el formato cambia, solo hay que ajustar este mapa.
  const COLUMN_ALIASES = {
    codGrupo: ['Cod.Grupo', 'Cod. Grupo', 'Codigo Grupo', 'Código de Grupo'],
    grupo: ['Grupo'],
    codProducto: ['Cod. Producto', 'Cod.Producto', 'Código de Producto'],
    producto: ['Producto', 'Descripción', 'Descripcion del Producto'],
    pesoUnitario: ['Peso Kgs.', 'Peso Unitario', 'Peso Kgs', 'Peso Kilos'],
    stockTotal: ['Stock Total'],
    unidadMedida: ['Cod. U. Medida', 'Cod.U.Medida', 'Unidad de Medida', 'U. Medida', 'Unidad Medida']
  };

  /**
   * Busca, dentro de las primeras N filas de la hoja, la fila de encabezados
   * (aquella que contiene "Cod. Producto" o equivalente).
   */
  function findHeaderRow(rows, maxScan = 15) {
    for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
      const row = rows[i].map(c => (c ?? '').toString().trim());
      const hasProducto = row.some(c => COLUMN_ALIASES.codProducto.includes(c));
      if (hasProducto) return i;
    }
    return -1;
  }

  /** Dada la fila de encabezados, arma un índice { campoInterno: columnaIndex } */
  function buildColumnIndex(headerRow) {
    const index = {};
    headerRow.forEach((cell, colIdx) => {
      const value = (cell ?? '').toString().trim();
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(value) && !(field in index)) {
          index[field] = colIdx;
        }
      }
    });
    return index;
  }

  /**
   * Lee un File (input type=file) y devuelve una Promise que resuelve
   * con un array de objetos: { codGrupo, grupo, codProducto, producto, pesoUnitario, stockTotal }
   */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];

          // header:1 -> array de arrays, sin asumir que la fila 1 son encabezados
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          const headerRowIdx = findHeaderRow(rows);
          if (headerRowIdx === -1) {
            reject(new Error('No se encontraron las columnas esperadas (Cod. Producto, Producto, etc.) en el archivo.'));
            return;
          }

          const columnIndex = buildColumnIndex(rows[headerRowIdx]);

          if (columnIndex.codProducto === undefined) {
            reject(new Error('El archivo no tiene columna de Código de Producto reconocible.'));
            return;
          }

          const records = [];
          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            const codProducto = (row[columnIndex.codProducto] ?? '').toString().trim();

            // Las filas de subtotal/total no traen código de producto -> se descartan.
            if (!codProducto) continue;

            records.push({
              codGrupo: (row[columnIndex.codGrupo] ?? '').toString().trim(),
              grupo: (row[columnIndex.grupo] ?? '').toString().trim(),
              codProducto,
              producto: (row[columnIndex.producto] ?? '').toString().trim(),
              pesoUnitario: parseFloat(row[columnIndex.pesoUnitario]) || 0,
              stockTotal: parseFloat(row[columnIndex.stockTotal]) || 0,
              unidadMedida: (row[columnIndex.unidadMedida] ?? '').toString().trim()
            });
          }

          resolve(records);
        } catch (err) {
          reject(err);
        }
      };

      reader.readAsArrayBuffer(file);
    });
  }

  return { readFile };
})();
