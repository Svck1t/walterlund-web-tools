/* ============================================
   reposicionOutputPdf.js
   Responsabilidad única: generar el PDF "Orden de Traslado"
   a partir de las filas ya calculadas por ReposicionAnalysis.
   Agrupa los traslados por par Origen → Destino (una tabla por
   ruta, para que cada bodega imprima solo lo que le corresponde
   despachar) y agrega al final los productos sin reposición
   disponible, para evaluar compra.

   La columna "Solicitado" muestra, por fila:
   - Si se anotó una cantidad de Pallets en la vista de Análisis:
     "<pallets> Pallets" (reemplaza la cantidad calculada — es
     solo una nota práctica para pedir el traslado, no afecta el
     cálculo interno).
   - Si no se anotó ningún Pallet: la cantidad calculada junto al
     nombre completo de la unidad (ej. "120 Resmas", "1 Cajas").
============================================ */

const ReposicionOutputPdf = (() => {

  const NOMBRES_UNIDAD = { RE: 'Resmas', CAJA: 'Cajas', UN: 'Unidades' };

  function nombreUnidad(unidad) {
    return NOMBRES_UNIDAD[unidad] || unidad;
  }

  function textoSolicitado(f) {
    if (f.pallets) return `${f.pallets} Pallets`;
    return `${f.cantidad.toLocaleString('es-CL')} ${nombreUnidad(f.unidad)}`;
  }

  function build(filas, fecha) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageHeight = doc.internal.pageSize.getHeight();

    const resueltos = filas.filter(f => f.resuelto);
    const sinSolucion = filas.filter(f => !f.resuelto);

    doc.setFontSize(14);
    doc.text(`Orden de Traslado — Reposición de Stock`, 24, 30);
    doc.setFontSize(10);
    doc.text(`Generado el ${fecha}`, 24, 46);

    let y = 66;

    const grupos = {};
    resueltos.forEach(f => {
      const key = `${f.origenLabel}  →  ${f.destinoLabel}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(f);
    });

    Object.keys(grupos).sort().forEach(key => {
      if (y > pageHeight - 120) { doc.addPage(); y = 30; }

      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(key, 24, y + 14);
      doc.setFont(undefined, 'normal');

      doc.autoTable({
        startY: y + 20,
        head: [['Cod. Producto', 'Producto', 'Solicitado']],
        body: grupos[key].map(f => [f.codigo, f.nombre, textoSolicitado(f)]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, lineWidth: 0.5 },
        headStyles: { fillColor: [21, 101, 192], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 90 },
          2: { cellWidth: 130, halign: 'right' }
        },
        theme: 'grid',
        margin: { left: 24, right: 24 }
      });

      y = doc.lastAutoTable.finalY + 24;
    });

    if (sinSolucion.length > 0) {
      if (y > pageHeight - 120) { doc.addPage(); y = 30; }

      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text('Sin reposición disponible — evaluar compra', 24, y + 14);
      doc.setFont(undefined, 'normal');

      doc.autoTable({
        startY: y + 20,
        head: [['Cod. Producto', 'Producto', 'Unidad', 'Bodega', 'Stock Actual']],
        body: sinSolucion.map(f => [f.codigo, f.nombre, f.unidad, f.destinoLabel, String(f.stockDestino)]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, lineWidth: 0.5 },
        headStyles: { fillColor: [198, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 90 },
          2: { cellWidth: 55, halign: 'center' },
          3: { cellWidth: 110 },
          4: { cellWidth: 70, halign: 'right' }
        },
        theme: 'grid',
        margin: { left: 24, right: 24 }
      });
    }

    const filename = `Orden de Traslado ${fecha}.pdf`;
    doc.save(filename);
    return filename;
  }

  return { build };
})();
