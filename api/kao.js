// api/kao.js
//
// Proxy de la sección Producción / Kao Chimigraf (mismo patrón que api/parciales.js).
// El navegador llama aquí (mismo dominio, sin CORS) y esta función llama al
// Apps Script gas/ProduccionKaoAPI.gs (pegado en la Google Sheet "Producción Kao").
//   GET  /api/kao   -> { ok, config, materias, colores, producciones }
//   POST /api/kao   -> { action, ... }

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxl4CJtX0rQO-Pttc_WJsZZST1-NFNJFy5QSRZdXnFGaaHOUn51CKylMP1N2cTldjVysQ/exec'; // termina en /exec

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(503).json({ ok: false, sinConfigurar: true, error: 'Falta configurar APPS_SCRIPT_URL en api/kao.js' });
      return;
    }
    if (req.method === 'GET') {
      const r = await fetch(APPS_SCRIPT_URL);
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
    console.error('Error en proxy kao:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
