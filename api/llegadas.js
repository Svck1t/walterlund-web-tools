// api/llegadas.js
//
// Próximas llegadas (área comercial) — SOLO LECTURA. v1.1: sin caché + fase por fecha
// Junta Importaciones (hoja espejo) + Packing Lists y devuelve solo lo pendiente de recepción.
// Se filtra aquí, en el servidor, para que el link público NUNCA reciba costos, GE ni órdenes.

const IMP_URL = 'https://script.google.com/macros/s/AKfycbx7bJ0YhnRKBF7pEO3OgOUcBPq82C4yO37TC2FmQFwNCZmOG_uDt5uzDkWiNFkWAr-GBQ/exec'; // mismo que js/contenedores.js
const PL_URL = 'https://script.google.com/macros/s/AKfycbwidbVD0AHfZxIa90u-X8P8Bf_yXwsLwUsx3WvOM9xLkQSy7cT0DSVQr2NpTnrTGKr9/exec';  // mismo que api/packing-lists.js

const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = c => norm(c).slice(0, 10); // tolera N° sin dígito verificador
const UNIDAD = { pallet: 'Resmas', bulto: 'Unidades', simple: 'Cantidad' };
const BULTO = { pallet: 'Pallets', bulto: 'Cajas', simple: '' };
const numero = v => (v === null || v === '' || v === undefined || isNaN(v)) ? null : Number(v);

function fase(r, hoy) {
  if (r.llegada) return 'confirmada';
  // Igual que Control Importaciones: manda la fecha. ETA vencida sin Fecha de Llegada = ya está en puerto
  const est = String(r.estado || '').toUpperCase();
  if (est === 'EN PUERTO' || (r.eta && r.eta <= hoy)) return 'puerto';
  return r.eta ? 'transito' : 'sinfecha';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Método no permitido' }); return; }
  try {
    const [ri, rp] = await Promise.all([fetch(IMP_URL), fetch(`${PL_URL}?action=list`)]);
    const imp = await ri.json();
    if (!imp.ok) throw new Error(imp.error || 'Importaciones no respondió');

    // Si Packing Lists falla, igual se muestran las importaciones (sin detalle de productos)
    let pls = [];
    try { const p = await rp.json(); if (p.ok) pls = p.items || []; } catch (e) { console.error('llegadas: packing lists', e); }
    const porCont = new Map();
    pls.forEach(pl => { if (pl.c) porCont.set(key(pl.c), pl); });

    const hoy = imp.hoy;
    const conts = (imp.rows || [])
      .filter(r => !r.recepExcel && norm(r.contenedor))
      .map(r => {
        const pl = porCont.get(key(r.contenedor));
        const f = pl ? (pl.f || 'pallet') : null;
        return {
          c: r.contenedor,
          fase: fase(r, hoy),
          llegada: r.llegada || '',
          hora: r.hora || '',
          eta: r.eta || '',
          proveedor: r.proveedor || '',
          material: r.material || '',
          detalle: r.detalle || '',
          peso: numero(r.peso),
          bodega: /POR ASIGNAR/i.test(r.bodega || '') ? '' : (r.bodega || ''),
          unidad: pl ? (pl.lc || UNIDAD[f] || 'Cantidad') : null,
          bulto: pl ? (pl.lb || BULTO[f] || '') : null,
          // [código, producto, cantidad, bultos, kg] — sin costos
          lineas: pl ? (pl.l || []).filter(l => l[0] || l[1]).map(l => [l[0] || '', l[1] || '', numero(l[6]), numero(l[4]), numero(l[3])]) : null
        };
      });

    res.setHeader('Cache-Control', 'no-store'); // siempre datos frescos (antes el CDN de Vercel guardaba una copia)
    res.status(200).json({ ok: true, hoy, sync: imp.sync || '', conts });
  } catch (err) {
    console.error('Error en api/llegadas:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
