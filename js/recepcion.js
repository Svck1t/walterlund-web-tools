// =====================================================
// SECCIÓN: RECEPCIÓN DE CONTENEDORES — v1 (bodega, pensada para el celular)
// Conectada a Control Importaciones: muestra los contenedores que llegan hoy / próximos días.
// Por cada contenedor: datos de la descarga, sello, estado general, daños y fotos por categoría (a Drive).
// Fuente: /api/despachos?m=rc (Apps Script "Despachos — anexo", pestaña Recepciones)
// =====================================================
const RecepcionSection = (() => {
  const API = '/api/despachos';
  const KEY_QUIEN = 'wl_rc_quien';
  const CATS = [
    ['frontal', '🚛 Contenedor / camión', 'Vista general del contenedor en el andén'],
    ['numero', '🔢 N° de contenedor', 'Placa con el número y la tara'],
    ['sello', '🔒 Sello', 'Sello puesto, con su número legible'],
    ['puertas', '🚪 Puertas abiertas', 'Apenas se abren, antes de descargar'],
    ['carga', '📦 Carga', 'Estado de la mercadería y los pallets'],
    ['vacio', '⬜ Contenedor vacío', 'Interior al terminar la descarga'],
    ['documento', '📄 Documentos', 'Guía, EIR u otro documento'],
    ['otra', '➕ Otras', '']
  ];
  const TIPOS_DANO = ['Abolladura / golpe en el contenedor', 'Perforación o rotura del contenedor', 'Humedad / agua', 'Pallet roto o caído', 'Mercadería dañada', 'Sello roto o distinto', 'Faltante', 'Otro'];
  const ESTADOS_GEN = ['Sin observaciones', 'Con observaciones', 'Con daños'];

  let recs = [], imp = [], hoy = '', cargado = false, error = '', root = null, selCont = null, subiendo = 0;
  let visor = null;
  const st = { q: '', tab: 'recibir' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const key = c => norm(c).slice(0, 10);
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : iso; };
  const dia = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const hoyLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const horaAhora = () => new Date().toTimeString().slice(0, 5);
  const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
  const quien = () => { try { return localStorage.getItem(KEY_QUIEN) || ''; } catch (e) { return ''; } };
  const setQuien = v => { try { localStorage.setItem(KEY_QUIEN, v); } catch (e) {} };
  const idDrive = url => { const m = String(url || '').match(/[-\w]{25,}/); return m ? m[0] : ''; };
  const thumb = url => `https://drive.google.com/thumbnail?id=${idDrive(url)}&sz=w400`;
  const recDe = c => recs.find(r => key(r.contenedor) === key(c));
  const fmtCont = c => { const n = norm(c); return n.length === 11 ? `${n.slice(0, 4)} ${n.slice(4, 10)}-${n.slice(10)}` : n; };

  // ============ CARGA ============
  async function cargar() {
    error = '';
    try {
      const [r, filas] = await Promise.all([
        fetch(`${API}?m=rc`, { cache: 'no-store' }).then(x => x.json()),
        typeof ContendedoresSection !== 'undefined' ? ContendedoresSection.obtenerFilas().catch(() => []) : Promise.resolve([])
      ]);
      if (!r.ok) throw new Error(r.error || 'Respuesta inválida');
      recs = r.recepciones; hoy = r.hoy || hoyLocal(); imp = filas || []; cargado = true;
    } catch (e) { console.error('Recepción:', e); error = e.message; hoy = hoy || hoyLocal(); }
    dibujar();
  }
  async function post(body) {
    body.quien = body.quien || quien();
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d; try { d = await r.json(); } catch (e) { throw new Error(r.status === 413 ? 'La foto es muy grande' : 'HTTP ' + r.status); }
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
    return d;
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="rc">
      <div class="section-header rc-head">
        <div><h1>Recepción de contenedores</h1><p>Fotos, sello, estado y daños de cada contenedor que llega a bodega.</p></div>
        <div class="rc-acts"><label class="rc-quien">👤 <input id="rc-quien" placeholder="Tu nombre" value="${esc(quien())}"></label><button class="rc-b" id="rc-ref">🔄</button></div>
      </div>
      <div id="rc-body"><p class="rc-empty">Cargando…</p></div>
    </div>`;
    root.querySelector('#rc-quien').addEventListener('change', e => setQuien(e.target.value.trim()));
    root.querySelector('#rc-ref').addEventListener('click', cargar);
    root.querySelector('#rc-body').addEventListener('click', clic);
    root.querySelector('#rc-body').addEventListener('change', cambio);
    root.querySelector('#rc-body').addEventListener('input', e => { if (e.target.id === 'rc-q') { st.q = e.target.value; dibujarLista(); } });
    selCont = null;
    dibujar();
    cargar();
  }

  function dibujar() {
    const body = root && root.querySelector('#rc-body'); if (!body) return;
    if (error) { body.innerHTML = `<p class="rc-err">No se pudieron cargar las recepciones: ${esc(error)}</p>`; return; }
    if (!cargado) return;
    if (selCont) return dibujarFicha(body);
    body.innerHTML = `
      <div class="rc-tabs"><button data-tab="recibir" class="${st.tab === 'recibir' ? 'on' : ''}">Por recibir</button><button data-tab="registradas" class="${st.tab === 'registradas' ? 'on' : ''}">Registradas (${recs.length})</button></div>
      <input class="rc-in rc-q" id="rc-q" type="search" placeholder="Buscar N° de contenedor, proveedor o material" value="${esc(st.q)}">
      <div id="rc-lista"></div>`;
    dibujarLista();
  }

  // Contenedores de Importaciones que llegan (hoy ± unos días) y los ya registrados
  function dibujarLista() {
    const el = root.querySelector('#rc-lista'); if (!el) return;
    const q = norm(st.q), qt = String(st.q || '').toUpperCase();
    const coincide = (c, extra) => !st.q || norm(c).includes(q) || String(extra || '').toUpperCase().includes(qt);
    const fila = (c, sub, r, sufijo) => `<button class="rc-item" data-cont="${esc(norm(c))}">
        <div><b>${esc(fmtCont(c))}</b><small>${sub}</small></div>
        <div class="rc-item-r">${r ? estadoTag(r) : '<span class="rc-tag rc-tag-n">Sin registrar</span>'}${sufijo || ''}</div></button>`;
    if (st.tab === 'registradas') {
      const lista = recs.slice().sort((a, b) => String(b.fecha || b.creado).localeCompare(String(a.fecha || a.creado))).filter(r => coincide(r.contenedor, r.bodega));
      el.innerHTML = lista.map(r => { const i = imp.find(x => key(x.contenedor) === key(r.contenedor)) || {}; const nf = J(r.fotos, []).length, nd = J(r.danos, []).length;
        return fila(r.contenedor, `${fCorta(r.fecha)} · ${esc(r.bodega || i.bodega || '')} · ${esc(i.proveedor || '')}`, r, `<small>${nf} fotos${nd ? ` · <b class="rc-rojo">${nd} daño${nd > 1 ? 's' : ''}</b>` : ''}</small>`); }).join('')
        || '<p class="rc-empty">Aún no hay recepciones registradas.</p>';
      return;
    }
    const hd = dia(hoy);
    let lista = imp.filter(x => !x.recepExcel || recDe(x.contenedor)).map(x => ({ x, f: x.llegada || x.eta || '' }));
    if (!st.q) lista = lista.filter(o => o.f && Math.abs(dia(o.f) - hd) <= 3 || (recDe(o.x.contenedor) && recDe(o.x.contenedor).estado === 'EN_CURSO'));
    lista = lista.filter(o => coincide(o.x.contenedor, [o.x.proveedor, o.x.material, o.x.bodega].join(' ')))
      .sort((a, b) => (a.f || '9').localeCompare(b.f || '9') || String(a.x.hora || '').localeCompare(String(b.x.hora || '')));
    const libre = st.q && norm(st.q).length >= 10 && !imp.some(x => key(x.contenedor) === key(st.q)) ? `<button class="rc-item rc-item-nuevo" data-cont="${esc(norm(st.q))}"><div><b>${esc(fmtCont(st.q))}</b><small>No está en Importaciones · registrar igual</small></div><div class="rc-item-r">➕</div></button>` : '';
    el.innerHTML = libre + (lista.map(({ x, f }) => {
      const cuando = x.llegada ? `${dia(x.llegada) === hd ? 'Hoy' : fCorta(x.llegada)}${x.hora ? ' ' + esc(x.hora) : ''}` : x.eta ? `ETA ${fCorta(x.eta)}` : 'Sin fecha';
      return fila(x.contenedor, `${cuando} · ${esc(x.bodega || 'Por asignar')} · ${esc(x.proveedor || '')} · ${esc(x.material || '')}`, recDe(x.contenedor));
    }).join('') || (libre ? '' : `<p class="rc-empty">${st.q ? 'Ningún contenedor coincide. Escribe el N° completo para registrarlo igual.' : 'No hay contenedores llegando entre hace 3 días y los próximos 3. Búscalo por N°.'}</p>`));
  }
  function estadoTag(r) {
    const d = J(r.danos, []).length;
    return r.estado === 'FINALIZADA' ? `<span class="rc-tag ${d || r.estadoGeneral === 'Con daños' ? 'rc-tag-dano' : 'rc-tag-ok'}">${d || r.estadoGeneral === 'Con daños' ? 'Recibido con daños' : 'Recibido'}</span>` : '<span class="rc-tag rc-tag-curso">En curso</span>';
  }

  // ============ FICHA DEL CONTENEDOR ============
  function dibujarFicha(body) {
    const r = recDe(selCont) || null;
    const i = imp.find(x => key(x.contenedor) === key(selCont)) || {};
    const fotos = r ? J(r.fotos, []) : [], danos = r ? J(r.danos, []) : [];
    const v = (k, d = '') => esc(r && r[k] !== undefined && r[k] !== '' ? r[k] : d);
    const fin = r && r.estado === 'FINALIZADA';
    const fotoHtml = f => `<div class="rc-ft"><button class="rc-ft-img" data-ver="${esc(f.url)}" style="background-image:url('${thumb(f.url)}')" aria-label="Ver foto"></button>${fin ? '' : `<button class="rc-ft-x" data-delfoto="${esc(f.id)}" aria-label="Quitar foto">✕</button>`}</div>`;
    body.innerHTML = `
      <button class="rc-b rc-volver" data-volver>‹ Contenedores</button>
      <div class="rc-card rc-hl">
        <div><h2>${esc(fmtCont(selCont))} ${r ? estadoTag(r) : '<span class="rc-tag rc-tag-n">Sin registrar</span>'}</h2>
          <p>${esc(i.proveedor || 'No está en Importaciones')}${i.material ? ' · ' + esc(i.material) : ''}${i.peso ? ' · ' + Number(i.peso).toLocaleString('es-CL') + ' kg' : ''}</p>
          <p class="rc-dim">${i.llegada ? 'Llegada ' + fCorta(i.llegada) + (i.hora ? ' ' + esc(i.hora) : '') : i.eta ? 'ETA ' + fCorta(i.eta) : ''}${i.ge ? ' · GE ' + esc(i.ge) : ''}${i.orden ? ' · ' + esc(i.orden) : ''}</p></div>
      </div>

      <div class="rc-card">
        <h3>Datos de la descarga</h3>
        <div class="rc-grid">
          <label>Fecha<input class="rc-in" id="d-fecha" type="date" value="${v('fecha', hoy)}"></label>
          <label>Hora inicio<input class="rc-in" id="d-hi" type="time" value="${v('horaInicio')}"></label>
          <label>Hora término<input class="rc-in" id="d-hf" type="time" value="${v('horaFin')}"></label>
          <label>Bodega<input class="rc-in" id="d-bod" value="${v('bodega', String(i.bodega || '').replace(/[\[\]]/g, '').trim())}"></label>
          <label>Patente camión<input class="rc-in" id="d-pat" value="${v('patente')}" autocapitalize="characters"></label>
          <label>N° de sello<input class="rc-in" id="d-sello" value="${v('sello')}" autocapitalize="characters"></label>
          <label>¿Sello intacto y coincide?<select class="rc-in" id="d-selok">${['', 'Sí', 'No'].map(o => `<option${(r && r.selloOk) === o ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
          <label>Estado general<select class="rc-in" id="d-est">${ESTADOS_GEN.map(o => `<option${(r ? r.estadoGeneral : 'Sin observaciones') === o ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
          <label class="rc-span">Recibido por<input class="rc-in" id="d-quien" value="${v('recibidoPor', quien())}"></label>
          <label class="rc-span rc-full">Observaciones<textarea class="rc-in" id="d-obs" rows="2" placeholder="Ej: 2 pallets inclinados, se reacomodaron">${v('obs')}</textarea></label>
        </div>
        <div class="rc-row"><button class="rc-b rc-pri" data-guardar>Guardar datos</button>${r && !r.horaInicio ? '<button class="rc-b" data-inicio>⏱ Iniciar descarga ahora</button>' : ''}</div>
      </div>

      <div class="rc-card">
        <h3>Fotos <span class="rc-dim">(${fotos.filter(f => f.cat !== 'dano').length})</span></h3>
        <div class="rc-cats">${CATS.map(([k, l, ayuda]) => { const fs = fotos.filter(f => f.cat === k || (k === 'otra' && f.cat === 'dano' && !danos.some(d => d.id === f.dano))); return `<div class="rc-cat${fs.length ? ' ok' : ''}">
          <div class="rc-cat-h"><b>${l}</b>${ayuda ? `<small>${ayuda}</small>` : ''}</div>
          <div class="rc-fts">${fs.map(fotoHtml).join('')}${fin ? '' : `<label class="rc-add">＋<input type="file" accept="image/*" capture="environment" multiple data-cat="${k}" hidden></label>`}</div></div>`; }).join('')}</div>
      </div>

      <div class="rc-card">
        <h3>Daños <span class="rc-dim">(${danos.length})</span></h3>
        ${danos.map(d => `<div class="rc-dano"><div class="rc-dano-h"><b>${esc(d.tipo)}</b>${fin ? '' : `<button class="rc-b rc-sm" data-deldano="${esc(d.id)}">Quitar</button>`}</div>
          ${d.detalle || d.cantidad ? `<p>${esc(d.detalle)}${d.cantidad ? ` · <b>${esc(d.cantidad)}</b>` : ''}</p>` : ''}
          <div class="rc-fts">${fotos.filter(f => f.dano === d.id).map(fotoHtml).join('')}${fin ? '' : `<label class="rc-add">＋<input type="file" accept="image/*" capture="environment" multiple data-cat="dano" data-dano="${esc(d.id)}" hidden></label>`}</div></div>`).join('') || '<p class="rc-dim">Sin daños registrados.</p>'}
        ${fin ? '' : `<details class="rc-nuevo-dano"><summary class="rc-b">⚠️ Registrar daño</summary>
          <div class="rc-grid">
            <label>Tipo<select class="rc-in" id="n-tipo">${TIPOS_DANO.map(t => `<option>${t}</option>`).join('')}</select></label>
            <label>Cuánto afecta<input class="rc-in" id="n-cant" placeholder="Ej: 2 pallets, 15 resmas"></label>
            <label class="rc-span rc-full">Detalle / ubicación<input class="rc-in" id="n-det" placeholder="Ej: costado izquierdo, al fondo"></label>
            <label class="rc-full">Fotos del daño<input class="rc-in" id="n-fotos" type="file" accept="image/*" capture="environment" multiple></label>
          </div>
          <button class="rc-b rc-pri" data-adddano>Guardar daño</button></details>`}
      </div>

      <div class="rc-card rc-final">
        ${fin ? `<p>Recepción finalizada${r.horaFin ? ' a las ' + esc(r.horaFin) : ''}.</p><button class="rc-b" data-reabrir>Reabrir</button>`
          : `<p class="rc-dim">${faltantes(fotos).length ? 'Faltan fotos de: ' + faltantes(fotos).join(', ') + '.' : 'Están todas las fotos principales ✓'}</p><button class="rc-b rc-pri" data-finalizar>✅ Finalizar recepción</button>`}
        ${r ? '<button class="rc-b rc-del" data-borrar>🗑 Eliminar recepción</button>' : ''}
      </div>
      ${r ? `<div class="rc-card"><h3>Historial</h3><ol class="rc-hist">${J(r.historial, []).slice().reverse().map(h => `<li><b>${esc(h.q || '—')}</b> ${esc(h.t)}<small>${esc(h.f)}</small></li>`).join('')}</ol></div>` : ''}
      ${subiendo ? `<div class="rc-subiendo">Subiendo ${subiendo} foto${subiendo > 1 ? 's' : ''}…</div>` : ''}`;
  }
  const faltantes = fotos => CATS.filter(([k]) => ['frontal', 'numero', 'sello', 'puertas', 'carga', 'vacio'].includes(k) && !fotos.some(f => f.cat === k)).map(([, l]) => l.replace(/^\S+\s/, ''));

  function datosForm() {
    const $ = s => root.querySelector(s);
    return { contenedor: selCont, fecha: $('#d-fecha').value, horaInicio: $('#d-hi').value, horaFin: $('#d-hf').value, bodega: $('#d-bod').value, patente: $('#d-pat').value.toUpperCase(),
      sello: $('#d-sello').value.toUpperCase(), selloOk: $('#d-selok').value, estadoGeneral: $('#d-est').value, recibidoPor: $('#d-quien').value, obs: $('#d-obs').value };
  }
  // Crea la ficha si no existe (para poder colgarle fotos) y devuelve su id
  async function asegurar() {
    const r = recDe(selCont);
    if (r) return r.id;
    const d = await post({ action: 'rc_guardar', r: { ...datosForm(), estado: 'EN_CURSO', horaInicio: root.querySelector('#d-hi').value || horaAhora() } });
    await cargar();
    return d.id;
  }

  async function clic(e) {
    const t = e.target;
    const tab = t.closest('[data-tab]'); if (tab) { st.tab = tab.dataset.tab; dibujar(); return; }
    const c = t.closest('[data-cont]'); if (c) { selCont = c.dataset.cont; dibujar(); window.scrollTo(0, 0); return; }
    if (t.closest('[data-volver]')) { selCont = null; dibujar(); return; }
    const ver = t.closest('[data-ver]'); if (ver) { verFoto(ver.dataset.ver); return; }
    const r = recDe(selCont);
    try {
      if (t.closest('[data-guardar]')) { const nombre = root.querySelector('#d-quien').value.trim(); if (nombre && !quien()) setQuien(nombre); await post({ action: 'rc_guardar', r: { ...datosForm(), id: r ? r.id : '' } }); toast('Datos guardados'); await cargar(); }
      else if (t.closest('[data-inicio]')) { root.querySelector('#d-hi').value = horaAhora(); await post({ action: 'rc_guardar', r: { ...datosForm(), id: r.id } }); toast('Descarga iniciada'); await cargar(); }
      else if (t.closest('[data-finalizar]')) {
        const fotos = r ? J(r.fotos, []) : [];
        const falt = faltantes(fotos);
        if (falt.length && !confirm(`Faltan fotos de: ${falt.join(', ')}.\n¿Finalizar igual?`)) return;
        const d = datosForm(); if (!d.horaFin) d.horaFin = horaAhora();
        if (r && J(r.danos, []).length && d.estadoGeneral === 'Sin observaciones') d.estadoGeneral = 'Con daños';
        await post({ action: 'rc_guardar', r: { ...d, id: r ? r.id : '', estado: 'FINALIZADA' } }); toast('Recepción finalizada'); await cargar();
      }
      else if (t.closest('[data-reabrir]')) { await post({ action: 'rc_guardar', reabrir: true, r: { id: r.id, contenedor: r.contenedor, estado: 'EN_CURSO' } }); toast('Recepción reabierta'); await cargar(); }
      else if (t.closest('[data-borrar]')) { if (!confirm('¿Eliminar la recepción de este contenedor con todas sus fotos? No se puede deshacer.')) return; await post({ action: 'rc_borrar', id: r.id }); selCont = null; toast('Recepción eliminada'); await cargar(); }
      else if (t.closest('[data-delfoto]')) { if (!confirm('¿Quitar esta foto?')) return; await post({ action: 'rc_borrar_foto', id: r.id, fotoId: t.closest('[data-delfoto]').dataset.delfoto }); await cargar(); }
      else if (t.closest('[data-deldano]')) {
        if (!confirm('¿Quitar este daño? Sus fotos quedan en "Otras".')) return;
        const id = t.closest('[data-deldano]').dataset.deldano;
        await post({ action: 'rc_guardar', r: { id: r.id, contenedor: r.contenedor, danos: J(r.danos, []).filter(d => d.id !== id) } }); await cargar();
      }
      else if (t.closest('[data-adddano]')) {
        const $ = s => root.querySelector(s);
        const id = await asegurar();
        const rr = recDe(selCont);
        const dano = { id: 'D' + Date.now().toString(36), tipo: $('#n-tipo').value, detalle: $('#n-det').value.trim(), cantidad: $('#n-cant').value.trim() };
        const archivos = [...$('#n-fotos').files];
        const datos = datosForm();
        await post({ action: 'rc_guardar', r: { id, contenedor: selCont, danos: J(rr.danos, []).concat(dano), estadoGeneral: 'Con daños', obs: datos.obs } });
        await subirFotos(id, archivos, 'dano', dano.id);
        toast('Daño registrado'); await cargar();
      }
    } catch (err) { toast(err.message, true); }
  }
  async function cambio(e) {
    const inp = e.target.closest('input[type=file][data-cat]'); if (!inp || !inp.files.length) return;
    try {
      const id = await asegurar();
      await subirFotos(id, [...inp.files], inp.dataset.cat, inp.dataset.dano || '');
      toast('Foto guardada');
    } catch (err) { toast(err.message, true); }
    await cargar();
  }
  async function subirFotos(id, archivos, cat, dano) {
    subiendo = archivos.length; dibujar();
    for (const f of archivos) {
      const archivo = await comprimir(f);
      await post({ action: 'rc_foto', id, cat, dano, archivo });
      subiendo--; dibujar();
    }
    subiendo = 0;
  }
  // Foto -> JPEG máx. 1600 px
  async function comprimir(f) {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.78));
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    return { nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', tipo: 'image/jpeg', base64: b64 };
  }

  function verFoto(url) {
    if (!visor) {
      visor = document.createElement('dialog');
      visor.className = 'rc-visor';
      visor.addEventListener('click', e => { if (e.target === visor || e.target.closest('[data-cerrar]')) visor.close(); });
      document.body.appendChild(visor);
    }
    const id = idDrive(url);
    visor.innerHTML = `<div class="rc-visor-in"><div class="rc-visor-head"><b>${esc(fmtCont(selCont))}</b><span>
      <a class="rc-b rc-sm" href="https://drive.google.com/uc?export=download&id=${esc(id)}" target="_blank" rel="noopener">⬇ Descargar</a>
      <a class="rc-b rc-sm" href="${esc(url)}" target="_blank" rel="noopener">↗ Drive</a>
      <button class="rc-b rc-sm" data-cerrar>✕</button></span></div>
      <img src="https://drive.google.com/thumbnail?id=${esc(id)}&sz=w1600" alt="Foto de la recepción"></div>`;
    visor.showModal();
  }

  function toast(msg, err) {
    document.querySelectorAll('.rc-toast').forEach(x => x.remove());
    const t = document.createElement('div'); t.className = 'rc-toast' + (err ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }

  function injectStyles() {
    if (document.getElementById('rc-styles')) return;
    const s = document.createElement('style');
    s.id = 'rc-styles';
    s.textContent = `
      .rc{color:#1c2733;max-width:980px}
      .rc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .rc-acts{display:flex;gap:8px;align-items:center}
      .rc-quien{display:flex;align-items:center;gap:6px;border:1px solid #d4d9e0;border-radius:8px;padding:0 4px 0 10px;background:#fff}
      .rc-quien input{border:0;outline:none;padding:9px 6px;font:inherit;font-size:14px;width:140px;background:transparent}
      .rc-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:9px 14px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
      .rc-b:hover{background:#f5f7fa}.rc-pri{background:#1565c0;border-color:#1565c0;color:#fff}.rc-pri:hover{background:#0f529e}
      .rc-del{color:#b91c1c}.rc-sm{padding:5px 10px;font-size:12px}
      .rc-tabs{display:inline-flex;gap:2px;padding:4px;background:#fff;border:1px solid #e1e5ea;border-radius:10px;margin-bottom:10px}
      .rc-tabs button{border:0;background:none;padding:8px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:600;color:#5b6b7a;cursor:pointer}
      .rc-tabs button.on{background:#1565c0;color:#fff}
      .rc-in{width:100%;box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:10px 11px;font:inherit;font-size:15px;background:#fff;color:#1c2733}
      .rc-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
      .rc-q{margin-bottom:10px}
      .rc-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;font:inherit;color:inherit}
      .rc-item:hover{border-color:#1565c0}
      .rc-item b{font-size:16px;letter-spacing:.02em}.rc-item small{display:block;color:#5b6b7a;font-size:12px;margin-top:2px}
      .rc-item-r{text-align:right;flex-shrink:0}.rc-item-nuevo{border-style:dashed}
      .rc-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;vertical-align:middle}
      .rc-tag-n{background:#f3f4f6;color:#6b7280}.rc-tag-curso{background:#fef3c7;color:#92400e}.rc-tag-ok{background:#dcfce7;color:#166534}.rc-tag-dano{background:#fee2e2;color:#b91c1c}
      .rc-rojo{color:#b91c1c}.rc-dim{color:#8a97a5;font-weight:400}
      .rc-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:16px;margin-bottom:12px}
      .rc-card h3{font-size:15px;margin:0 0 12px}
      .rc-hl h2{margin:0;font-size:22px;letter-spacing:.02em}.rc-hl p{margin:4px 0 0;color:#5b6b7a}
      .rc-volver{margin-bottom:10px}
      .rc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .rc-grid label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}
      .rc-span{grid-column:span 2}.rc-full{grid-column:1/-1}
      .rc-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .rc-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
      .rc-cat{border:1.5px dashed #d4d9e0;border-radius:10px;padding:10px}.rc-cat.ok{border-style:solid;border-color:#bbf7d0;background:#f0fdf4}
      .rc-cat-h b{display:block;font-size:14px}.rc-cat-h small{display:block;color:#8a97a5;font-size:11px;margin-top:2px}
      .rc-fts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .rc-ft{position:relative}
      .rc-ft-img{width:64px;height:64px;border-radius:8px;border:1px solid #e1e5ea;background:#f3f4f6 center/cover no-repeat;cursor:pointer;padding:0}
      .rc-ft-x{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#1c2733;color:#fff;font-size:11px;cursor:pointer;line-height:20px;padding:0}
      .rc-add{width:64px;height:64px;border-radius:8px;border:1.5px dashed #1565c0;color:#1565c0;display:grid;place-items:center;font-size:26px;cursor:pointer;background:#fff}
      .rc-dano{border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:10px;margin-bottom:8px}
      .rc-dano-h{display:flex;justify-content:space-between;align-items:center;gap:8px}.rc-dano p{margin:4px 0 0;font-size:13px}
      .rc-nuevo-dano{margin-top:10px}.rc-nuevo-dano summary{list-style:none;cursor:pointer;color:#b91c1c}.rc-nuevo-dano summary::-webkit-details-marker{display:none}
      .rc-nuevo-dano[open] .rc-grid{margin:12px 0}
      .rc-final{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.rc-final p{margin:0;flex:1;min-width:200px}
      .rc-hist{list-style:none;margin:0;padding:0;font-size:13px}.rc-hist li{padding:6px 0;border-bottom:1px solid #f0f1f4}.rc-hist small{display:block;color:#9ca3af;font-size:11px}
      .rc-empty{color:#8a97a5;padding:20px;text-align:center;margin:0;background:#fff;border-radius:10px}
      .rc-err{color:#b91c1c}
      .rc-subiendo{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;z-index:9998}
      .rc-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2733;color:#fff;padding:11px 18px;border-radius:8px;font-size:14px;z-index:9999}.rc-toast.err{background:#b91c1c}
      .rc-visor{border:0;border-radius:12px;padding:0;width:min(900px,96vw);max-height:92vh;background:#111}
      .rc-visor::backdrop{background:rgba(0,0,0,.75)}
      .rc-visor-in{display:flex;flex-direction:column;max-height:92vh}
      .rc-visor-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;background:#fff}
      .rc-visor-head span{display:flex;gap:6px}
      .rc-visor img{max-width:100%;max-height:calc(92vh - 60px);object-fit:contain;display:block;margin:auto}
      @media (max-width:700px){
        .rc-grid{grid-template-columns:1fr 1fr}.rc-span{grid-column:1/-1}
        .rc-head .rc-acts{width:100%}.rc-quien{flex:1}.rc-quien input{width:100%}
        .rc-cats{grid-template-columns:1fr}
        .rc-ft-img,.rc-add{width:72px;height:72px}
        .rc-visor{width:100vw;max-width:100vw;max-height:100vh;border-radius:0}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
