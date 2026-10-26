// api/packing-lists.js
//
// Proxy interno para Packing Lists (mismo patrón que api/traslados.js):
// el navegador llama a esta función (mismo dominio, sin CORS) y ella llama
// al Apps Script de servidor a servidor.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwidbVD0AHfZxIa90u-X8P8Bf_yXwsLwUsx3WvOM9xLkQSy7cT0DSVQr2NpTnrTGKr9/exec'; // termina en /exec

module.exports = async (req, res) => {
  try {
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(500).json({ ok: false, error: 'Falta configurar APPS_SCRIPT_URL en api/packing-lists.js' });
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
    console.error('Error en proxy packing-lists:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
