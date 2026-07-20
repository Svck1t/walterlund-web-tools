/* ============================================
   reposicionOutputPdf.js
   Responsabilidad única: generar el PDF final —solo con
   los productos que tienen cantidad solicitada— con el
   mismo formato de tabla que el ejemplo (encabezado en
   negrita, columnas Cod. Producto / Nombre Producto /
   Cod. U. Medida / Solicitado).
============================================ */

const ReposicionOutputPdf = (() => {

  /**
   * @param {Array} rows        [{codigo, nombre, unidad, cantidad}] — ya filtrados y confirmados
   * @param {string} bodegaLabel  'Viel' | 'Aldunate'
   * @param {string} fecha        dd-mm-aaaa
   */
  function build(rows, bodegaLabel, fecha) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });

    const title = `Productos ${bodegaLabel} ${fecha}`;

    doc.autoTable({
      head: [['Cod. Producto', title, 'Cod. U. Medida', 'Solicitado']],
      body: rows.map(r => [r.codigo, r.nombre, r.unidad, String(r.cantidad)]),
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, lineWidth: 0.75 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.75 },
      columnStyles: {
        0: { cellWidth: 90 },
        2: { cellWidth: 80, halign: 'center' },
        3: { cellWidth: 70, halign: 'right' }
      },
      theme: 'grid',
      margin: { left: 24, right: 24, top: 24 }
    });

    const filename = `Solicitud ${bodegaLabel} ${fecha}.pdf`;
    doc.save(filename);
    return filename;
  }

  return { build };
})();
