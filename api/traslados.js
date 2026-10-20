// api/traslados.js
//
// Proxy interno para Control de Traslados (mismo patrón que api/stock-niveles.js):
// el navegador llama a esta función (mismo dominio, sin CORS) y ella llama
// al Apps Script de servidor a servidor.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxqtRRqWLeaa-jQLUWzeSkG194haaGQWg7OrUgOyEmxui06SoiOYANDunhYoYeJC2Lbrw/exec'; // termina en /exec

module.exports = async (req, res) => {
  try {
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(500).json({ ok: false, error: 'Falta configurar APPS_SCRIPT_URL en api/traslados.js' });
      return;
    }

    if (req.method === 'GET') {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=traslados`);
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
    console.error('Error en proxy traslados:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
