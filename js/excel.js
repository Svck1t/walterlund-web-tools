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
    codProducto: ['Cod. Producto', 'Cod.Producto', 'Código de Producto', 'Código Producto', 'Codigo Producto'],
    producto: ['Producto', 'Descripción', 'Descripcion del Producto', 'Nombre Producto'],
    pesoUnitario: ['Peso Kgs.', 'Peso Unitario', 'Peso Kgs', 'Peso Kilos'],
    // 'General' = stock total del export web (formato 2, columnas por bodega)
    stockTotal: ['Stock Total', 'General'],
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
   * Convierte un valor a número. Acepta números reales (xlsx) y textos en
   * formato chileno del export HTML: "1.010,00" -> 1010, "5,00" -> 5.
   */
  function toNumber(value) {
    if (typeof value === 'number') return value;
    let txt = (value ?? '').toString().trim();
    if (!txt) return 0;
    if (txt.includes(',')) txt = txt.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(txt);
    return Number.isFinite(n) ? n : 0;
  }

  /** ¿El archivo es en realidad una página HTML con extensión .xls? (formato 2: export web) */
  function isHtml(bytes) {
    const head = new TextDecoder('utf-8').decode(bytes.slice(0, 512)).replace(/^\uFEFF/, '').trim().toLowerCase();
    return head.startsWith('<html') || head.startsWith('<!doctype') || head.startsWith('<table') || head.includes('<html');
  }

  /**
   * Lee la primera <table> de un HTML y devuelve array de arrays de texto,
   * igual que sheet_to_json({header:1}). Se lee como texto para que SheetJS
   * no malinterprete "5,00" como 500.
   */
  function htmlToRows(bytes) {
    const html = new TextDecoder('utf-8').decode(bytes);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return [];
    return [...table.querySelectorAll('tr')].map(tr =>
      [...tr.querySelectorAll('th,td')].map(cell => cell.textContent.trim())
    );
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
          let rows;
          if (isHtml(data)) {
            // Formato 2: "export_stock.xls" (HTML con stock por bodega)
            rows = htmlToRows(data);
          } else {
            // Formato 1: informe Softland "Stock Acumulado Valorizado" (.xlsx/.xls real)
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            // header:1 -> array de arrays, sin asumir que la fila 1 son encabezados
            rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          }

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

            let codGrupo = (row[columnIndex.codGrupo] ?? '').toString().trim();
            const grupo = (row[columnIndex.grupo] ?? '').toString().trim();
            // En el formato 2 la columna "Grupo" trae el código (ej. 1029), no el nombre.
            if (columnIndex.codGrupo === undefined && /^\d+$/.test(grupo)) codGrupo = grupo;

            records.push({
              codGrupo,
              grupo,
              codProducto,
              producto: (row[columnIndex.producto] ?? '').toString().trim(),
              pesoUnitario: columnIndex.pesoUnitario === undefined ? null : toNumber(row[columnIndex.pesoUnitario]),
              stockTotal: toNumber(row[columnIndex.stockTotal]),
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
