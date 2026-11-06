// api/despachos.js
//
// Proxy único para el anexo de Despachos (Despachos Parciales + Notas de Crédito).
// El navegador llama a esta función (mismo dominio, sin CORS) y ella llama al
// Apps Script "Despachos — anexo" de servidor a servidor.
//   GET  /api/despachos         -> parciales
//   GET  /api/despachos?m=nc    -> notas de crédito
//   POST /api/despachos         -> { action, ... } (la acción decide el módulo)

const APPS_SCRIPT_URL = 'PEGAR_AQUI_URL_DEL_WEB_APP'; // termina en /exec

module.exports = async (req, res) => {
  try {
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(500).json({ ok: false, error: 'Falta configurar APPS_SCRIPT_URL en api/despachos.js' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
      const m = req.query && req.query.m ? `&m=${encodeURIComponent(req.query.m)}` : '';
      const r = await fetch(`${APPS_SCRIPT_URL}?action=list${m}`);
      res.status(200).json(await r.json());
      return;
    }

    if (req.method === 'POST') {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      });
      res.status(200).json(await r.json());
      return;
    }

    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en proxy despachos:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// Fotos y PDF se suben como base64 dentro del JSON (las fotos se comprimen en el navegador)
module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
