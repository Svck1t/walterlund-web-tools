// api/descargas.js
//
// Proxy de la sección Descargas. Usa el mismo Apps Script que Traslados
// (TrasladosAPI.gs + Descargas.gs).
//
//   GET  /api/descargas            -> lista de archivos (JSON)
//   GET  /api/descargas?id=...     -> el archivo (para ver o descargar)
//        &descargar=1              -> fuerza la descarga en vez de abrirlo
//   POST /api/descargas            -> { action:'subirArchivo' | 'borrarArchivo', ... }

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxqtRRqWLeaa-jQLUWzeSkG194haaGQWg7OrUgOyEmxui06SoiOYANDunhYoYeJC2Lbrw/exec';

module.exports = async (req, res) => {
  try {
    const q = req.query || {};

    if (req.method === 'GET' && q.id) {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=archivo&id=${encodeURIComponent(q.id)}`);
      const d = await r.json();
      if (!d.ok) { res.status(404).json(d); return; }
      const nombre = encodeURIComponent(d.nombre);
      res.setHeader('Content-Type', d.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${q.descargar ? 'attachment' : 'inline'}; filename*=UTF-8''${nombre}`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).send(Buffer.from(d.base64, 'base64'));
      return;
    }

    if (req.method === 'GET') {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=descargas`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(await r.json());
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!['subirArchivo', 'borrarArchivo'].includes(body.action)) {
        res.status(400).json({ ok: false, error: 'Acción no válida' });
        return;
      }
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      res.status(200).json(await r.json());
      return;
    }

    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (err) {
    console.error('Proxy descargas:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// Los PDF van en base64 dentro del JSON. Vercel acepta hasta 4,5 MB por request.
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
