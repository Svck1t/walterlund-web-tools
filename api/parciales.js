// api/parciales.js
//
// Proxy interno para Despachos Parciales (mismo patrón que api/traslados.js):
// el navegador llama a esta función (mismo dominio, sin CORS) y ella llama
// al Apps Script de servidor a servidor.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyQNbwJAgl_wY5O5lh1jp7ouTvjyFlq4MLNPwbV0F-UXCRbuNSR3cHDj4mqfrRdMREPdQ/exec'; // termina en /exec

module.exports = async (req, res) => {
  try {
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(500).json({ ok: false, error: 'Falta configurar APPS_SCRIPT_URL en api/parciales.js' });
      return;
    }

    if (req.method === 'GET') {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=list`);
      const data = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST') {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      });
      const data = await r.json();
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en proxy parciales:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// Las guías se suben como base64 dentro del JSON (fotos comprimidas en el navegador)
module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
