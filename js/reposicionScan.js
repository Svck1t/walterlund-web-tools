/* ============================================
   reposicionScan.js
   Responsabilidad única: dado un PDF escaneado y la lista
   de referencia de productos de una bodega, detectar qué
   filas tienen una cantidad escrita a mano y leerla con OCR.

   Estrategia (probada contra un PDF real antes de implementarla):
   1) OCR de texto impreso por página (muy confiable) para
      encontrar la posición exacta de cada código de producto.
   2) Para la columna "Solicitado" de esa fila, primero se mide
      si hay "tinta" (evita gastar OCR en 1800 celdas vacías).
   3) Si hay algo escrito, se recorta esa celda, se agranda y
      se le hace OCR dirigido solo a dígitos.
   El OCR de letra manuscrita NO es 100% confiable — por eso cada
   resultado se entrega junto con la imagen recortada, para que
   el usuario lo confirme antes de generar el PDF final.
============================================ */

const ReposicionScan = (() => {

  let textWorker = null;
  let digitWorker = null;

  async function getTextWorker() {
    if (!textWorker) textWorker = await Tesseract.createWorker('spa');
    return textWorker;
  }

  async function getDigitWorker() {
    if (!digitWorker) {
      digitWorker = await Tesseract.createWorker('eng');
      await digitWorker.setParameters({ tessedit_char_whitelist: '0123456789+.' });
    }
    return digitWorker;
  }

  async function terminate() {
    if (textWorker) { await textWorker.terminate(); textWorker = null; }
    if (digitWorker) { await digitWorker.terminate(); digitWorker = null; }
  }

  function normalizeCode(s) {
    return (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** "5+1" -> 6 · "5." -> 5 · "10" -> 10 · texto no numérico -> null */
  function parseHandwrittenQty(raw) {
    if (!raw) return null;
    let clean = raw.toString().trim().replace(/\s+/g, '').replace(/,/g, '.');
    clean = clean.replace(/\.+$/, ''); // punto suelto al final ("5.")
    if (!clean) return null;
    if (!/^\d+(\+\d+)*$/.test(clean)) return null;

    return clean.split('+').reduce((sum, part) => sum + parseInt(part, 10), 0);
  }

  /**
   * @param {File} file            PDF escaneado
   * @param {Array} referenceRecords [{codigo, nombre, unidad}] de la bodega elegida
   * @param {function} onProgress  (texto) => void, para mostrar avance en la UI
   * @returns {Array} [{codigo, nombre, unidad, ocrRaw, cantidad, cropDataUrl}]
   */
  async function scan(file, referenceRecords, onProgress) {
    const refByCode = new Map(referenceRecords.map(r => [normalizeCode(r.codigo), r]));
    const seen = new Set();

    onProgress('Renderizando páginas del PDF...');
    const pages = await PdfScanReader.renderPages(file);

    const results = [];
    const tWorker = await getTextWorker();

    for (let p = 0; p < pages.length; p++) {
      const { canvas, width } = pages[p];
      onProgress(`Leyendo texto impreso — página ${p + 1} de ${pages.length}...`);

      const { data } = await tWorker.recognize(canvas);
      const words = data.words || [];

      // La columna "Solicitado" queda en el 10% más a la derecha de la página
      // (así viene en las planillas que genera este mismo sistema).
      const colX = width * 0.90;

      for (const w of words) {
        const code = normalizeCode(w.text);
        if (!code || seen.has(code)) continue;
        const ref = refByCode.get(code);
        if (!ref) continue;
        seen.add(code);

        const bbox = w.bbox;
        const rowY = bbox.y0 - 8;
        const rowH = (bbox.y1 - bbox.y0) + 16;

        const ratio = PdfScanReader.inkRatio(canvas, colX, rowY, width - colX, rowH);
        if (ratio < 0.004) continue; // celda vacía: no se solicitó nada

        onProgress(`Leyendo cantidades escritas a mano — ${results.length + 1} encontradas...`);

        const cropCanvas = PdfScanReader.cropToCanvas(canvas, colX, rowY, width - colX, rowH, 4);
        const dWorker = await getDigitWorker();
        const { data: cropData } = await dWorker.recognize(cropCanvas);
        const ocrRaw = (cropData.text || '').trim();

        results.push({
          codigo: ref.codigo,
          nombre: ref.nombre,
          unidad: ref.unidad,
          ocrRaw,
          cantidad: parseHandwrittenQty(ocrRaw),
          cropDataUrl: cropCanvas.toDataURL('image/png')
        });
      }
    }

    return results;
  }

  return { scan, parseHandwrittenQty, terminate };
})();
