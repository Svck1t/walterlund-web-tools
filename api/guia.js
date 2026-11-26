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

// Por ahora solo se sirven traslados y sus entradas (no guías a clientes).
const PERMITIDAS = new Set(['traslado', 'entrada']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { GUIAS_APPS_URL, GUIAS_READ_TOKEN } = process.env;
    if (!GUIAS_APPS_URL || !GUIAS_READ_TOKEN) {
      res.status(500).json({ ok: false, error: 'Faltan GUIAS_APPS_URL / GUIAS_READ_TOKEN en Vercel' });
      return;
    }
    const clave = String((req.query && req.query.guia) || '').toUpperCase().trim();
    if (!/^(S|ET)\d{1,9}$/.test(clave)) {
      res.status(400).json({ ok: false, error: 'Guía inválida (usa S12345 o ET12345)' });
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
