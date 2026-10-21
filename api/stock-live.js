// api/stock-live.js
//
// Stock en tiempo real desde la web interna (walterlund.duckdns.org).
// Inicia sesión automáticamente con un usuario guardado en variables de
// entorno de Vercel, descarga /stock/exportHtml y lo entrega tal cual
// (tabla HTML), que es el mismo formato que ya lee la sección Stock.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   WL_USER  usuario/correo para iniciar sesión
//   WL_PASS  contraseña
//
// Uso:
//   GET /api/stock-live          -> HTML del export (para la web)
//   GET /api/stock-live?test=1   -> JSON con resumen (para probar)
//   GET /api/stock-live?fresh=1  -> ignora el caché de 60 s

const BASE = process.env.WL_BASE || 'https://walterlund.duckdns.org';
const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 25 * 1000;

// Estado que sobrevive entre llamadas mientras la función siga "caliente"
let jar = {};            // cookies de sesión
let cache = null;        // { html, at }

// ---------- cookies ----------
function guardarCookies(res) {
  const lista = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') || '').split(/,(?=\s*[^;=\s]+=)/);
  lista.filter(Boolean).forEach(c => {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function pedir(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'walterlund-web-tools/stock-live', Cookie: cookieHeader(), ...(opts.headers || {}) }
    });
    guardarCookies(res);
    return res;
  } finally {
    clearTimeout(t);
  }
}

const absoluta = loc => new URL(loc, BASE).toString();
const vaAlLogin = res => res.status >= 300 && res.status < 400 && /\/login/i.test(res.headers.get('location') || '');

// ---------- login ----------
// Lee el formulario de /login en vez de asumir nombres de campos:
// toma los campos ocultos (_token), el campo de usuario y el de contraseña.
function leerFormulario(html) {
  const form = (html.match(/<form[^>]*>[\s\S]*?<\/form>/i) || [''])[0];
  if (!form) throw new Error('No se encontró el formulario de login');
  const action = absoluta(((form.match(/action\s*=\s*["']([^"']+)["']/i) || [])[1]) || '/login');
  const inputs = [...form.matchAll(/<input\b[^>]*>/gi)].map(m => {
    const tag = m[0];
    const attr = n => ((tag.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1]);
    return { type: (attr('type') || 'text').toLowerCase(), name: attr('name'), value: attr('value') || '' };
  }).filter(i => i.name);

  const ocultos = inputs.filter(i => i.type === 'hidden');
  const pass = inputs.find(i => i.type === 'password');
  const user = inputs.find(i => ['email', 'text'].includes(i.type));
  const recordar = inputs.find(i => i.type === 'checkbox');
  if (!pass || !user) throw new Error('El formulario de login no tiene los campos esperados');
  return { action, ocultos, userName: user.name, passName: pass.name, recordar: recordar && recordar.name };
}

async function login() {
  const { WL_USER, WL_PASS } = process.env;
  if (!WL_USER || !WL_PASS) throw new Error('Faltan las variables de entorno WL_USER / WL_PASS en Vercel');

  jar = {};
  const r1 = await pedir(`${BASE}/login`);
  const f = leerFormulario(await r1.text());

  const body = new URLSearchParams();
  f.ocultos.forEach(i => body.append(i.name, i.value));
  body.append(f.userName, WL_USER);
  body.append(f.passName, WL_PASS);
  if (f.recordar) body.append(f.recordar, 'on');

  const r2 = await pedir(f.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/login` },
    body: body.toString()
  });
  // Login correcto = redirige fuera de /login. Si vuelve a /login, las credenciales no sirvieron.
  if (r2.status === 419) throw new Error('Login rechazado por token vencido (419)');
  if (vaAlLogin(r2) || r2.status === 200 || r2.status === 422) throw new Error('Login fallido: revisa WL_USER / WL_PASS');
}

// ---------- export ----------
async function descargarExport() {
  for (let intento = 0; intento < 2; intento++) {
    if (!Object.keys(jar).length) await login();
    const res = await pedir(`${BASE}/stock/exportHtml`);
    if (vaAlLogin(res) || res.status === 401 || res.status === 419) { jar = {}; continue; } // sesión vencida -> reintenta
    if (!res.ok) throw new Error(`El export respondió HTTP ${res.status}`);
    const html = await res.text();
    if (!/<table/i.test(html) || !/C[oó]digo Producto/i.test(html)) throw new Error('El export no trae la tabla de stock esperada');
    return html;
  }
  throw new Error('No se pudo mantener la sesión iniciada');
}

function resumen(html, ms, desdeCache) {
  const th = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const filas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()))
    .filter(f => f.length);
  return { ok: true, desdeCache, ms, generado: new Date(cache.at).toISOString(), columnas: th, productos: filas.length, primeras: filas.slice(0, 3) };
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const q = req.query || {};
  try {
    let desdeCache = true;
    if (!cache || q.fresh || Date.now() - cache.at > CACHE_MS) {
      cache = { html: await descargarExport(), at: Date.now() };
      desdeCache = false;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Stock-Generado', new Date(cache.at).toISOString());
    if (q.test) return res.status(200).json(resumen(cache.html, Date.now() - t0, desdeCache));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(cache.html);
  } catch (err) {
    console.error('stock-live:', err);
    res.status(502).json({ ok: false, error: err.message });
  }
};
