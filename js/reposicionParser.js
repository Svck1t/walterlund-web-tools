/* ============================================
   reposicionParser.js
   Responsabilidad única: leer el Excel de stock consolidado
   (export de Softland) y devolver los registros normalizados
   con el stock de las tres bodegas relevantes para reposición:
   SAN FRANCISCO 918, VIEL y ALDUNATE. El resto de las columnas
   del export (SAN IGNACIO, SANTIAGO CONCHA, Grupo, Reservas,
   Disponible, etc.) se ignoran.
   No sabe nada de análisis de reposición ni de la UI
   (eso vive en reposicionAnalysis.js y reposicion.js).
============================================ */

const ReposicionParser = (() => {

  const COL = {
    codigo: 'Código Producto',
    nombre: 'Nombre Producto',
    unidad: 'Unidad de Medida',
    sanFco: 'SAN FRANCISCO 918',
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
      sanFco: headerRow.indexOf(COL.sanFco),
      viel: headerRow.indexOf(COL.viel),
      aldunate: headerRow.indexOf(COL.aldunate)
    };

    if (idx.codigo === -1 || idx.sanFco === -1 || idx.viel === -1 || idx.aldunate === -1) {
      throw new Error('El archivo no tiene las columnas esperadas (Código Producto, SAN FRANCISCO 918, VIEL, ALDUNATE).');
    }

    const records = [];
    for (const row of dataRows) {
      const codigo = getCell(row, idx.codigo);
      if (!codigo) continue;
      records.push({
        codigo,
        nombre: getCell(row, idx.nombre),
        unidad: getCell(row, idx.unidad),
        sanFco: parseChileanNumber(getCell(row, idx.sanFco)),
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
   * o un binario real) y devuelve los registros consolidados por producto,
   * con el stock de SAN FRANCISCO 918, VIEL y ALDUNATE.
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

  return { readFile, todayLabel };
})();
