// =====================================================
// SECCIÓN: DESCARGAS (v1)
// Archivos guardados en Drive (carpeta "WalterLund - Descargas") para
// verlos o bajarlos desde cualquier dispositivo. Las Órdenes de Traslado
// de Reposición se guardan aquí solas al generarlas; también se puede
// subir cualquier PDF o imagen a mano.
// =====================================================

const DescargasSection = (() => {
  const API = '/api/descargas';
  const MAX_BYTES = 3 * 1024 * 1024;   // en base64 crece ~33% y Vercel acepta hasta 4,5 MB
  const TIPOS = ['Orden de traslado', 'Guía', 'Factura', 'Packing list', 'Otros'];

  let root = null;
  let archivos = [];
  let filtroTipo = '';
  let busqueda = '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tam = b => b >= 1048576 ? (b / 1048576).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fecha = iso => { const [d, h] = iso.split('T'); const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y} ${h || ''}`.trim(); };
  const icono = mime => /pdf/.test(mime) ? '📄' : /image/.test(mime) ? '🖼️' : /sheet|excel/.test(mime) ? '📊' : '📎';

  // ---------- Guardar (lo usa también Reposición) ----------
  async function guardar(nombre, tipo, base64, mime = 'application/pdf') {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'subirArchivo', nombre, tipo, mime, base64 })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
    return d;
  }

  const aBase64 = file => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(new Error('No se pudo leer el archivo'));
    fr.readAsDataURL(file);
  });

  // ---------- Render ----------
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `
      <div class="dl">
        <div class="dl-head">
          <div>
            <h1>Descargas</h1>
            <p>Documentos guardados para verlos o descargarlos desde cualquier dispositivo. Las Órdenes de Traslado se guardan aquí automáticamente.</p>
          </div>
          <label class="dl-btn">📤 Subir archivo<input type="file" id="dl-file" accept=".pdf,image/*" hidden></label>
        </div>
        <div id="dl-subida"></div>
        <div class="dl-filtros">
          <input type="search" id="dl-buscar" placeholder="Buscar por nombre" value="${esc(busqueda)}">
          <select id="dl-tipo"><option value="">Todos los tipos</option>${TIPOS.map(t => `<option ${t === filtroTipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div id="dl-lista"><p class="dl-vacio">Cargando…</p></div>
      </div>`;

    root.querySelector('#dl-buscar').addEventListener('input', e => { busqueda = e.target.value; pintarLista(); });
    root.querySelector('#dl-tipo').addEventListener('change', e => { filtroTipo = e.target.value; pintarLista(); });
    root.querySelector('#dl-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) prepararSubida(f); });
    root.addEventListener('click', onClick);
    cargar();
  }

  async function cargar() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      archivos = d.archivos || [];
      pintarLista();
    } catch (err) {
      console.error('Descargas:', err);
      const el = root && root.querySelector('#dl-lista');
      if (el) el.innerHTML = `<p class="dl-err">No se pudieron cargar los archivos: ${esc(err.message)}</p>`;
    }
  }

  function pintarLista() {
    const el = root && root.querySelector('#dl-lista');
    if (!el) return;
    const q = busqueda.trim().toLowerCase();
    const lista = archivos.filter(a => (!filtroTipo || a.tipo === filtroTipo) && (!q || a.nombre.toLowerCase().includes(q)));
    if (!lista.length) {
      el.innerHTML = `<p class="dl-vacio">${archivos.length ? 'Ningún archivo coincide con el filtro.' : 'Todavía no hay archivos. Genera una Orden de Traslado en Reposición o sube uno aquí.'}</p>`;
      return;
    }
    el.innerHTML = `<p class="dl-cuenta">${lista.length} archivo(s)</p><ul class="dl-items">${lista.map(a => `
      <li>
        <span class="dl-ico">${icono(a.mime)}</span>
        <div class="dl-info">
          <a href="${API}?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener">${esc(a.nombre)}</a>
          <span>${esc(a.tipo)} · ${fecha(a.fecha)} · ${tam(a.bytes)}</span>
        </div>
        <div class="dl-acc">
          <a class="dl-mini" href="${API}?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Ver</a>
          <a class="dl-mini" href="${API}?id=${encodeURIComponent(a.id)}&descargar=1">Descargar</a>
          <button class="dl-mini dl-borrar" data-borrar="${esc(a.id)}" data-nombre="${esc(a.nombre)}" title="Mover a la papelera">🗑</button>
        </div>
      </li>`).join('')}</ul>`;
  }

  // ---------- Subida manual ----------
  function prepararSubida(file) {
    const box = root.querySelector('#dl-subida');
    if (file.size > MAX_BYTES) {
      box.innerHTML = `<p class="dl-err">"${esc(file.name)}" pesa ${tam(file.size)}; el máximo es 3 MB.</p>`;
      return;
    }
    box.innerHTML = `<div class="dl-card">
      <b>${esc(file.name)}</b> · ${tam(file.size)}
      <div class="dl-row">
        <select id="dl-subir-tipo">${TIPOS.map(t => `<option>${t}</option>`).join('')}</select>
        <button class="dl-btn" data-subir>Guardar</button>
        <button class="dl-btn dl-sec" data-cancelar>Cancelar</button>
      </div>
      <p class="dl-estado" id="dl-estado"></p>
    </div>`;
    box._file = file;
  }

  async function onClick(e) {
    const box = root.querySelector('#dl-subida');
    if (e.target.closest('[data-cancelar]')) { box.innerHTML = ''; return; }

    if (e.target.closest('[data-subir]')) {
      const file = box._file; if (!file) return;
      const estado = root.querySelector('#dl-estado');
      e.target.disabled = true;
      estado.textContent = 'Guardando…';
      try {
        await guardar(file.name, root.querySelector('#dl-subir-tipo').value, await aBase64(file), file.type || 'application/octet-stream');
        box.innerHTML = '<p class="dl-ok">✅ Archivo guardado.</p>';
        cargar();
      } catch (err) {
        estado.innerHTML = `<span class="dl-err">⚠️ ${esc(err.message)}</span>`;
        e.target.disabled = false;
      }
      return;
    }

    const b = e.target.closest('[data-borrar]');
    if (b) {
      if (!confirm(`¿Mover "${b.dataset.nombre}" a la papelera?`)) return;
      b.disabled = true;
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'borrarArchivo', id: b.dataset.borrar }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'No se pudo borrar');
        archivos = archivos.filter(a => a.id !== b.dataset.borrar);
        pintarLista();
      } catch (err) {
        alert(err.message);
        b.disabled = false;
      }
    }
  }

  function injectStyles() {
    if (document.getElementById('dl-styles')) return;
    const s = document.createElement('style');
    s.id = 'dl-styles';
    s.textContent = `
      .dl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}
      .dl-head h1{margin:0;font-size:22px}
      .dl-head p{margin:4px 0 0;color:#6b7280;font-size:13px;max-width:640px}
      .dl-btn{display:inline-flex;align-items:center;gap:6px;background:#1e7b34;color:#fff;border:0;border-radius:6px;padding:9px 14px;font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap}
      .dl-btn:disabled{opacity:.5}
      .dl-sec{background:#fff;color:#374151;border:1px solid #d1d5db}
      .dl-card{background:#fff;border-left:4px solid #667eea;border-radius:10px;padding:14px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
      .dl-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      .dl-row select,.dl-filtros select,.dl-filtros input{padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;background:#fff}
      .dl-filtros{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
      .dl-filtros input{flex:1;min-width:200px;max-width:420px}
      .dl-estado{margin:8px 0 0;font-size:13px;color:#6b7280}
      .dl-ok{color:#15803d;font-size:14px}.dl-err{color:#b91c1c;font-size:14px}
      .dl-vacio,.dl-cuenta{color:#6b7280;font-size:13px}
      .dl-items{list-style:none;margin:0;padding:0;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .dl-items li{display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid #f0f1f4}
      .dl-items li:first-child{border-top:0}
      .dl-ico{font-size:22px}
      .dl-info{flex:1;min-width:0}
      .dl-info a{display:block;font-weight:600;color:#1f2937;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dl-info a:hover{color:#2563eb}
      .dl-info span{font-size:12px;color:#6b7280}
      .dl-acc{display:flex;gap:6px}
      .dl-mini{border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:6px 10px;font-size:13px;color:#374151;text-decoration:none;cursor:pointer;white-space:nowrap}
      .dl-mini:hover{background:#f3f4f6}
      @media (max-width:700px){
        .dl-head{flex-direction:column}.dl-head .dl-btn{width:100%;justify-content:center;padding:12px}
        .dl-filtros input,.dl-filtros select{font-size:16px;max-width:none}
        .dl-items li{flex-wrap:wrap}.dl-acc{width:100%;padding-left:34px}.dl-acc .dl-mini{flex:1;text-align:center;padding:9px}
      }`;
    document.head.appendChild(s);
  }

  return { render, guardar };
})();
