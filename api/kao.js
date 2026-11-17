// api/kao.js
//
// Proxy de la sección Producción / Kao Chimigraf (mismo patrón que api/parciales.js).
// El navegador llama aquí (mismo dominio, sin CORS) y esta función llama al
// Apps Script gas/ProduccionKaoAPI.gs (pegado en la Google Sheet "Producción Kao").
//   GET  /api/kao   -> { ok, config, materias, colores, producciones }
//   POST /api/kao   -> { action, ... }

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxHUez4Sjh875pX9tuwB0tsa1GACDJDGXTBuQdMMp6Zp8zEsl7VZKIYjRPMVXqZ1Z_7/exec'; // termina en /exec

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (APPS_SCRIPT_URL.startsWith('PEGAR')) {
      res.status(503).json({ ok: false, sinConfigurar: true, error: 'Falta configurar APPS_SCRIPT_URL en api/kao.js' });
      return;
    }
    // Apps Script responde HTML (no JSON) cuando falla: permisos, script sin hoja, error interno.
    const leer = async r => {
      const t = await r.text();
      try { return JSON.parse(t); } catch (_) {
        const titulo = (t.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
        const cuerpo = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        return { ok: false, error: `Apps Script respondió HTML (HTTP ${r.status}). ${titulo} — ${cuerpo}` };
      }
    };
    if (req.method === 'GET') {
      const r = await fetch(APPS_SCRIPT_URL);
      res.status(200).json(await leer(r));
      return;
    }
    if (req.method === 'POST') {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      });
      res.status(200).json(await leer(r));
      return;
    }
    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en proxy kao:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
