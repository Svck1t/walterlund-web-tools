// api/telegram.js
//
// Webhook del bot del grupo de Notas de Crédito (silencioso: no escribe nada en el grupo).
// Cada mensaje del grupo llega aquí; se descarga la foto o el PDF (si trae) y se manda al
// Apps Script "Despachos — anexo" (acción tg_mensaje), que lo vincula a su NC.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   TG_TOKEN    token del bot que entrega @BotFather
//   TG_SECRET   una clave inventada (letras y números) para que solo Telegram pueda llamar este webhook
//   TG_CHAT_ID  (opcional) id del grupo; si está, se ignoran mensajes de cualquier otro chat
//
// Activar (una vez, después de deployar):
//   https://<tu-dominio>/api/telegram?setup=<TG_SECRET>   → registra el webhook en Telegram
//   https://<tu-dominio>/api/telegram?info=<TG_SECRET>    → muestra el estado del webhook y el último chat visto

const { APPS_SCRIPT_URL } = require('./despachos');

const TOKEN = process.env.TG_TOKEN || '';
const SECRET = process.env.TG_SECRET || '';
const CHAT_ID = process.env.TG_CHAT_ID || '';
const TG = metodo => `https://api.telegram.org/bot${TOKEN}/${metodo}`;
const MAX_BYTES = 8 * 1024 * 1024;

let ultimoChat = null; // para ?info: ayuda a encontrar el id del grupo

async function tg(metodo, body) {
  const r = await fetch(TG(metodo), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

// Descarga un archivo de Telegram y lo devuelve en base64 (los bots pueden bajar hasta 20 MB)
async function bajar(fileId, nombre, tipo) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f.ok) throw new Error('getFile: ' + f.description);
  if (f.result.file_size && f.result.file_size > MAX_BYTES) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.result.file_path}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { nombre: nombre || f.result.file_path.split('/').pop(), tipo, base64: buf.toString('base64') };
}

function nombreAutor(u) {
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
}

module.exports = async (req, res) => {
  try {
    if (!TOKEN || !SECRET) { res.status(500).json({ ok: false, error: 'Faltan TG_TOKEN / TG_SECRET en Vercel' }); return; }

    // ---- configuración (GET) ----
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.setup && q.setup === SECRET) {
        const url = `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/telegram`;
        const r = await tg('setWebhook', { url, secret_token: SECRET, allowed_updates: ['message'], drop_pending_updates: false });
        res.status(200).json({ webhook: url, telegram: r });
        return;
      }
      if (q.info && q.info === SECRET) {
        res.status(200).json({ webhook: await tg('getWebhookInfo'), bot: await tg('getMe'), ultimoChatVisto: ultimoChat, filtroChat: CHAT_ID || '(sin filtro)' });
        return;
      }
      res.status(404).end();
      return;
    }

    // ---- mensajes (POST desde Telegram) ----
    if (req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.status(401).end(); return; }
    const up = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const m = up && up.message;
    if (!m) { res.status(200).json({ ok: true, skip: 'sin mensaje' }); return; }
    ultimoChat = { id: m.chat.id, titulo: m.chat.title || '', tipo: m.chat.type };
    if (CHAT_ID && String(m.chat.id) !== String(CHAT_ID)) { res.status(200).json({ ok: true, skip: 'otro chat' }); return; }
    if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') { res.status(200).json({ ok: true, skip: 'no es grupo' }); return; }

    let archivo = null, tipoArchivo = '';
    if (m.photo && m.photo.length) {
      // la foto más grande que no pase de ~3 MB (sobra para leer la factura)
      const ok = m.photo.filter(p => !p.file_size || p.file_size <= 3 * 1024 * 1024);
      const p = (ok.length ? ok : m.photo)[(ok.length ? ok : m.photo).length - 1];
      archivo = await bajar(p.file_id, `foto_${m.message_id}.jpg`, 'image/jpeg');
      tipoArchivo = 'foto';
    } else if (m.document) {
      const d = m.document, mime = d.mime_type || '';
      archivo = await bajar(d.file_id, d.file_name, mime || 'application/octet-stream');
      tipoArchivo = /pdf/i.test(mime) || /\.pdf$/i.test(d.file_name || '') ? 'pdf' : /^image\//.test(mime) ? 'foto' : 'otro';
    }

    const payload = {
      action: 'tg_mensaje',
      m: {
        msgId: String(m.message_id), date: m.date, autor: nombreAutor(m.from), autorId: m.from ? String(m.from.id) : '',
        texto: m.text || m.caption || '', replyTo: m.reply_to_message ? String(m.reply_to_message.message_id) : '',
        mediaGroup: m.media_group_id || '', tipoArchivo, archivo
      }
    };
    const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({ ok: false, error: 'Respuesta no JSON del Apps Script' }));
    // Siempre 200: si respondemos error, Telegram reintenta el mismo mensaje una y otra vez.
    // El Apps Script ignora repetidos por msgId, así que un reintento manual no duplica.
    if (!data.ok) console.error('tg_mensaje:', data.error);
    res.status(200).json({ ok: true, resultado: data });
  } catch (err) {
    // Falla de red o de descarga: 500 para que Telegram reintente más tarde (los repetidos se ignoran por msgId)
    console.error('Error en webhook Telegram:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// Bajar el archivo, subirlo a Drive y (si hace falta) leerlo con OCR puede tomar varios segundos
module.exports.config = { maxDuration: 60 };
