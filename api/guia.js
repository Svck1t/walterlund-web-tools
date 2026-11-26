// api/guia.js
//
// Datos de impresión de una guía de Softland (salida de traslado o su entrada),
// para el visor guia.html. Lee del Apps Script "Softland Sync WL", que el
// script de PowerShell alimenta desde el SQL de Softland.
//
// La clave de lectura NO va en el código (el repo es público): se guarda en
// Vercel → Settings → Environment Variables:
//   GUIAS_APPS_URL    URL /exec del Apps Script de Softland Sync
//   GUIAS_READ_TOKEN  clave de lectura (READ_TOKEN del Apps Script)
//
// Uso:  GET /api/guia?guia=S15837   -> guía de salida 15837
//       GET /api/guia?guia=ET15837  -> guía de entrada generada por la salida 15837
//       GET /api/guia?guia=EF573908 -> guía de entrada por devolución de la NC de la factura 573908 (EB = boleta)
//       GET /api/guia?lista=nc       -> NC que existen en Softland [folio, fecha, ref F/B, documento, devolución, estado, folio entrada, total, glosa]
//       GET /api/guia?lista=facturas -> facturas/boletas con solicitud de NC [clave, fecha, cliente, rut, bodega, total, vendedor, productos]

// Se sirven traslados, sus entradas y las guías de entrada por devolución (NC). No guías a clientes.
const PERMITIDAS = new Set(['traslado', 'entrada', 'devolucion']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { GUIAS_APPS_URL, GUIAS_READ_TOKEN } = process.env;
    if (!GUIAS_APPS_URL || !GUIAS_READ_TOKEN) {
      res.status(500).json({ ok: false, error: 'Faltan GUIAS_APPS_URL / GUIAS_READ_TOKEN en Vercel' });
      return;
    }
    // Lista de NC que existen en Softland (para validar las NC "Emitidas" en Notas de Crédito)
    if (req.query && ['nc', 'facturas'].includes(req.query.lista)) {
      const r = await fetch(`${GUIAS_APPS_URL}?t=${encodeURIComponent(GUIAS_READ_TOKEN)}&lista=${req.query.lista}`, { redirect: 'follow' });
      const d = await r.json();
      res.status(d.ok ? 200 : 500).json(d.ok ? { ok: true, filas: d.filas || d.nc, nc: d.filas || d.nc } : { ok: false, error: d.error || 'Error' });
      return;
    }
    const clave = String((req.query && req.query.guia) || '').toUpperCase().trim();
    if (!/^(S|ET|EF|EB)\d{1,9}$/.test(clave)) {
      res.status(400).json({ ok: false, error: 'Guía inválida' });
      return;
    }
    const url = `${GUIAS_APPS_URL}?t=${encodeURIComponent(GUIAS_READ_TOKEN)}&guia=${clave}`;
    const r = await fetch(url, { redirect: 'follow' });
    const d = await r.json();
    if (!d.ok) { res.status(404).json({ ok: false, error: d.error || 'No encontrada' }); return; }
    if (!PERMITIDAS.has(d.guia && d.guia.plantilla)) {
      res.status(404).json({ ok: false, error: 'No encontrada' });
      return;
    }
    res.status(200).json({ ok: true, guia: d.guia });
  } catch (err) {
    console.error('Error en api/guia:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
