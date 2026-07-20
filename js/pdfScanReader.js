/* ============================================
   pdfScanReader.js
   Responsabilidad única: convertir un PDF escaneado en
   canvases de imagen, y ofrecer utilidades de recorte /
   detección de "tinta" (para saber si una celda tiene algo
   escrito antes de gastar tiempo en OCR).
   No sabe nada de Tesseract, productos, ni bodegas.
============================================ */

const PdfScanReader = (() => {

  function ensureWorker() {
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  /**
   * Renderiza cada página del PDF a un <canvas> en memoria.
   * scale ~2.5 da buena resolución para OCR sin ser demasiado lento.
   */
  async function renderPages(file, scale = 2.5) {
    ensureWorker();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({ canvas, width: canvas.width, height: canvas.height });
    }
    return pages;
  }

  /** Proporción de píxeles "oscuros" en una región — sirve para saber si hay algo escrito ahí. */
  function inkRatio(canvas, x, y, w, h) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(canvas.width - x, Math.round(w));
    h = Math.min(canvas.height - y, Math.round(h));
    if (w <= 0 || h <= 0) return 0;

    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(x, y, w, h);
    let dark = 0;
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < 150) dark++;
    }
    return dark / total;
  }

  /** Recorta una región y la agranda (mejora bastante la lectura de OCR sobre letra pequeña). */
  function cropToCanvas(sourceCanvas, x, y, w, h, upscale = 4) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(sourceCanvas.width - x, Math.round(w));
    h = Math.min(sourceCanvas.height - y, Math.round(h));

    const out = document.createElement('canvas');
    out.width = Math.max(1, w * upscale);
    out.height = Math.max(1, h * upscale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, out.width, out.height);
    return out;
  }

  return { renderPages, inkRatio, cropToCanvas };
})();
