// api/stock-niveles.js
//
// Proxy interno para Niveles Mínimos/Máximos de Stock.
//
// Por qué existe: Google Apps Script (ContentService) no permite agregar
// el header "Access-Control-Allow-Origin" a su respuesta, así que el
// navegador bloquea por CORS cualquier fetch() hecho directo desde
// walterlund-web-tools.vercel.app hacia script.google.com.
//
// La solución: el navegador llama a ESTA función (mismo dominio, sin
// problema de CORS), y ella, desde el servidor de Vercel, llama al Apps
// Script (servidor a servidor — ahí no aplica CORS, que es una
// restricción exclusiva del navegador).

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxchbWwNZnnx72MF5d_NZockO1XD56He_Ti-nIb3Hx7HLb_0u-gpqRTh0Vy3c23BrXl/exec'; // la misma URL /exec que usabas antes en nivelesMinimosStore.js

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=stockNiveles`);
      const data = await r.json();
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST') {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en proxy stock-niveles:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
