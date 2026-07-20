/* ============================================
   reposicionParser.js
   Responsabilidad única:
   1) Leer el Excel de stock consolidado (todas las bodegas)
      — puede venir como .xlsx/.xls binario real, o como el
      export típico de Softland: un .xls que en realidad es
      una tabla HTML.
   2) Generar y descargar los 2 Excels de reposición
      (Stock Viel / Stock Aldunate) a partir de esos datos.
   No sabe nada de la UI del módulo (eso vive en reposicion.js).
============================================ */

const ReposicionParser = (() => {

  const COL = {
    codigo: 'Código Producto',
    nombre: 'Nombre Producto',
    unidad: 'Unidad de Medida',
    viel: 'VIEL',
    aldunate: 'ALDUNATE'
  };

  /** "1.359,06" -> 1359.06 (formato numérico chileno) */
  function parseChileanNumber(value) {
    if (typeof value === 'number') return value;
    if (value === undefined || value === null) return 0;
    const clean = value.toString().trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function extractRecordsFromRows(headerRow, dataRows, getCell) {
    const idx = {
      codigo: headerRow.indexOf(COL.codigo),
      nombre: headerRow.indexOf(COL.nombre),
      unidad: headerRow.indexOf(COL.unidad),
      viel: headerRow.indexOf(COL.viel),
      aldunate: headerRow.indexOf(COL.aldunate)
    };

    if (idx.codigo === -1 || idx.viel === -1 || idx.aldunate === -1) {
      throw new Error('El archivo no tiene las columnas esperadas (Código Producto, VIEL, ALDUNATE).');
    }

    const records = [];
    for (const row of dataRows) {
      const codigo = getCell(row, idx.codigo);
      if (!codigo) continue;
      records.push({
        codigo,
        nombre: getCell(row, idx.nombre),
        unidad: getCell(row, idx.unidad),
        viel: parseChileanNumber(getCell(row, idx.viel)),
        aldunate: parseChileanNumber(getCell(row, idx.aldunate))
      });
    }
    return records;
  }

  /** Caso: el .xls en realidad es una tabla HTML (export típico de Softland/CRM) */
  function parseHtmlTable(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('table');
    if (!table) throw new Error('No se encontró una tabla en el archivo.');

    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) throw new Error('La tabla no tiene datos.');

    const headerRow = Array.from(rows[0].querySelectorAll('th,td')).map(c => c.textContent.trim());
    const dataRows = rows.slice(1).map(tr => Array.from(tr.querySelectorAll('td')).map(c => c.textContent.trim()));

    return extractRecordsFromRows(headerRow, dataRows, (row, i) => (row[i] ?? '').toString().trim());
  }

  /** Caso: archivo binario real (.xlsx o .xls verdadero) */
  function parseBinaryWorkbook(arrayBuffer) {
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) throw new Error('El archivo no tiene datos.');

    const headerRow = rows[0].map(c => (c ?? '').toString().trim());
    const dataRows = rows.slice(1);

    return extractRecordsFromRows(headerRow, dataRows, (row, i) => (row[i] ?? '').toString().trim());
  }

  /**
   * Lee el archivo (detecta automáticamente si es HTML disfrazado de .xls
   * o un binario real) y devuelve los registros consolidados por producto.
   */
  async function readFile(file) {
    const text = await readAsText(file);
    const sniff = text.trim().slice(0, 300).toLowerCase();

    if (sniff.startsWith('<') || sniff.includes('<table') || sniff.includes('<html')) {
      return parseHtmlTable(text);
    }

    const buffer = await readAsArrayBuffer(file);
    return parseBinaryWorkbook(buffer);
  }

  function todayLabel() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  /**
   * Arma la hoja de una bodega con el formato pedido:
   * - Encabezado en negrita, fuente 14; datos en fuente 14
   * - Bordes finos solo dentro de la tabla (encabezado + datos)
   * - Autofiltro en el encabezado
   * - Solo productos con stock > 0 en esa bodega (equivalente al filtro manual de "Stock 0")
   * - Configuración de página: vertical, ajustar a 1 hoja de ancho x 20 de alto,
   *   tamaño carta, márgenes 0,3, centrado horizontalmente
   */
  function buildBodegaWorkbook(records, bodegaField, bodegaLabel) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');

    const headers = [COL.codigo, COL.nombre, COL.unidad, bodegaLabel, 'Solicitado'];
    sheet.addRow(headers);

    const filtered = records.filter(r => r[bodegaField] > 0);
    filtered.forEach(r => {
      sheet.addRow([r.codigo, r.nombre, r.unidad, r[bodegaField], '']);
    });

    sheet.columns = [
      { width: 18 }, { width: 42 }, { width: 14 }, { width: 10 }, { width: 12 }
    ];

    const lastRow = filtered.length + 1;
    const lastCol = headers.length;

    for (let r = 1; r <= lastRow; r++) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = sheet.getCell(r, c);
        cell.font = { size: 14, bold: r === 1 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastCol } };

    sheet.pageSetup = {
      orientation: 'portrait',
      paperSize: 1, // Carta / Letter
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 20,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.3, footer: 0.3 }
    };

    return { workbook, records: filtered };
  }

  async function downloadWorkbook(workbook, filename) {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Genera y descarga los dos Excels de reposición a partir de los registros
   * ya leídos. Devuelve los nombres de archivo y cuántos productos (con stock > 0)
   * quedaron en cada uno.
   */
  async function generateReposicionFiles(records) {
    const fecha = todayLabel();

    const vielFilename = `Stock Viel ${fecha}.xlsx`;
    const { workbook: vielWb, records: vielRecords } = buildBodegaWorkbook(records, 'viel', 'VIEL');
    await downloadWorkbook(vielWb, vielFilename);

    const aldunateFilename = `Stock Aldunate ${fecha}.xlsx`;
    const { workbook: aldunateWb, records: aldunateRecords } = buildBodegaWorkbook(records, 'aldunate', 'ALDUNATE');
    await downloadWorkbook(aldunateWb, aldunateFilename);

    return {
      vielFilename, aldunateFilename,
      vielCount: vielRecords.length, aldunateCount: aldunateRecords.length,
      vielRecords, aldunateRecords,
      fecha
    };
  }

  return { readFile, generateReposicionFiles, todayLabel };
})();
