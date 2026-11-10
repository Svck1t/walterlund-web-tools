// =====================================================
// Lector del "INFORME DE GUÍAS DE RECEPCIÓN" de Softland (.xls)
// Sirve para cualquier concepto: "Devolución de Cliente" (Notas de Crédito), "Compra con Factura" (Compras Nacionales)…
// Devuelve { periodo: {desde, hasta}, docs: [{ concepto, bodega, bodegaCodigo, fecha, folio, dcto, estado, origen,
//            lineas: [{ codigo, descripcion, um, cantidad, precio, total }], total }] }
// =====================================================
const SoftlandRecepciones = (() => {
  const T = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const K = v => T(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const num = v => { if (v === null || v === undefined || v === '') return null; if (typeof v === 'number') return v; const s = T(v).replace(/\./g, '').replace(',', '.'); const n = Number(s); return isNaN(n) ? null : n; };
  const iso = v => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
    const m = T(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  };
  // "Bodega : 08  [ BODEGA SF 918  08]" -> { codigo: '08', nombre: 'SF 918' }
  function bodega(txt) {
    const m = T(txt).match(/Bodega\s*:\s*(\d+)\s*\[\s*(.*?)\s*\]/i);
    const nombre = m ? m[2] : T(txt);
    const u = K(nombre);
    const corto = /918|FRANCISCO/.test(u) ? 'SF 918' : /VIEL/.test(u) ? 'Viel' : /ALDUNATE/.test(u) ? 'Aldunate' : /IGNACIO/.test(u) ? 'San Ignacio' : /CONCHA/.test(u) ? 'Stgo Concha' : nombre;
    return { codigo: m ? m[1] : '', nombre: corto };
  }

  function parse(wb, XLSX) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const titulo = rows.slice(0, 12).flat().map(K).join(' ');
    if (!titulo.includes('GUIAS DE RECEPCION')) throw new Error('El archivo no parece un "Informe de Guías de Recepción" de Softland');

    // Las celdas vienen combinadas y desalineadas respecto del encabezado, así que cada fila se lee
    // por el ORDEN de sus celdas con datos:
    //   documento: fecha · folio · N° dcto · estado · origen
    //   producto:  código · descripción · U/M · cantidad · precio unitario · total
    const periodo = { desde: '', hasta: '' };
    const docs = [];
    let concepto = '', bod = { codigo: '', nombre: '' }, doc = null;
    for (const r of rows) {
      const v = (r || []).filter(x => x !== null && T(x) !== '');
      if (!v.length) continue;
      const k0 = K(v[0]);
      v.forEach(x => { const k = K(x); if (k.startsWith('DESDE')) periodo.desde = iso(T(x).split(':').pop()); if (k.startsWith('HASTA')) periodo.hasta = iso(T(x).split(':').pop()); });
      if (k0.startsWith('CONCEPTO DE RECEPCION')) { concepto = T(v[0]).split(':').pop().trim(); continue; }
      if (/^BODEGA\s*:/.test(k0)) { bod = bodega(v[0]); continue; }
      if (k0.startsWith('TOTAL')) continue;
      const fecha = iso(v[0]);
      if (fecha && v.length >= 4) {
        const folio = T(v[1]).replace(/\.0$/, ''), dcto = T(v[2]).replace(/\.0$/, '');
        // un documento largo se corta entre páginas y Softland repite su cabecera: se sigue sumando al mismo
        doc = docs.find(x => x.folio === folio && x.dcto === dcto && x.bodega === bod.nombre);
        if (!doc) {
          doc = { concepto, bodega: bod.nombre, bodegaCodigo: bod.codigo, fecha, folio, dcto, estado: T(v[3]), origen: T(v[4] || ''), lineas: [], total: 0 };
          docs.push(doc);
        }
        continue;
      }
      if (doc && v.length >= 6 && num(v[3]) !== null && num(v[5]) !== null) {
        const l = { codigo: T(v[0]).replace(/\.0$/, ''), descripcion: T(v[1]), um: T(v[2]), cantidad: num(v[3]), precio: Math.round((num(v[4]) || 0) * 100) / 100, total: Math.round(num(v[5]) || 0) };
        doc.lineas.push(l);
        doc.total += l.total;
      }
    }
    if (!docs.length) throw new Error('No encontré documentos en el informe');
    return { periodo, docs };
  }

  return { parse };
})();
