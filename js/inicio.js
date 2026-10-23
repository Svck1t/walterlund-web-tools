// =====================================================
// SECCIÓN: INICIO — resumen del día (v1)
// Junta en una vista lo más importante de cada sección. No tiene datos
// propios: reutiliza la lógica de Contenedores y Reposición y lee las
// mismas fuentes que Traslados y Control de Facturas. Cada tarjeta carga
// por separado, así un error en una no bloquea las demás.
// =====================================================

const InicioSection = (() => {
  const FACTURAS_API = 'https://script.google.com/macros/s/AKfycbxchbWwNZnnx72MF5d_NZockO1XD56He_Ti-nIb3Hx7HLb_0u-gpqRTh0Vy3c23BrXl/exec';
  const TRASLADOS_API = '/api/traslados';

  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const BOD_CORTA = { 'SAN FRANCISCO 918': 'SF 918', VIEL: 'Viel', ALDUNATE: 'Aldunate' };

  let root = null;

  // ---------- utilidades ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('es-CL', { maximumFractionDigits: d });
  const pad = n => String(n).padStart(2, '0');
  const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fCorta = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—';
  const horaAhora = () => new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function diaHabilAnterior(iso) {
    const d = new Date(iso + 'T12:00:00');
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return isoLocal(d);
  }

  const bodCls = b => { const u = String(b || '').toUpperCase(); return u.includes('ALDUNATE') ? 'ald' : u.includes('VIEL') ? 'viel' : ''; };
  const irA = sec => `<button class="in-link" data-ir="${sec}">Ver sección →</button>`;

  function tarjeta(id, icono, titulo, seccion) {
    return `<section class="in-card" id="${id}">
      <header><h3>${icono} ${titulo}</h3>${irA(seccion)}</header>
      <div class="in-body"><p class="in-cargando">Cargando…</p></div>
    </section>`;
  }

  function pintar(id, html) {
    const el = root && root.querySelector(`#${id} .in-body`);
    if (el) el.innerHTML = html;
  }

  function pintarError(id, err) {
    console.error(id, err);
    pintar(id, `<p class="in-err">No se pudo cargar: ${esc(err.message || err)}</p>`);
  }

  const mini = (label, valor, cls = '') => `<div class="in-mini ${cls}"><strong>${valor}</strong><span>${label}</span></div>`;

  // =====================================================
  // RENDER
  // =====================================================
  function render(container) {
    root = container;
    injectStyles();
    const hoy = new Date();
    const h = hoy.getHours();
    const saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const nombre = (document.querySelector('.user-name')?.textContent || '').trim().split(' ')[0];

    root.innerHTML = `
      <div class="in">
        <div class="in-head">
          <div>
            <h1>${saludo}${nombre ? ', ' + esc(nombre) : ''}</h1>
            <p>Resumen del ${DIAS[hoy.getDay()]} ${hoy.getDate()} de ${MESES[hoy.getMonth()]} · <span id="in-hora">actualizado a las ${horaAhora()}</span></p>
          </div>
          <button class="btn-outline" id="in-actualizar" type="button">🔄 Actualizar</button>
        </div>
        <div class="in-grid">
          ${tarjeta('in-cont', '📦', 'Importaciones', 'cola-contenedores')}
          ${tarjeta('in-repo', '🔄', 'Reposición sugerida', 'reposicion')}
          ${tarjeta('in-tras', '🚚', 'Traslados', 'traslados')}
          ${tarjeta('in-fact', '🧾', 'Despachos', 'control-facturas')}
        </div>
      </div>`;

    root.querySelector('#in-actualizar').addEventListener('click', () => render(container));
    root.querySelector('.in-grid').addEventListener('click', e => {
      const b = e.target.closest('[data-ir]');
      if (b) document.querySelector(`.nav-item[data-section="${b.dataset.ir}"]`)?.click();
    });

    const hoyIso = isoLocal(hoy);
    cargarContenedores().catch(err => pintarError('in-cont', err));
    cargarReposicion().catch(err => pintarError('in-repo', err));
    cargarTraslados(hoyIso).catch(err => pintarError('in-tras', err));
    cargarFacturas(hoyIso).catch(err => pintarError('in-fact', err));
  }

  // ---------- Contenedores ----------
  async function cargarContenedores() {
    const g = await ContendedoresSection.obtenerResumen();
    const atrasados = g.hoy.filter(r => r.tagCls === 'late');
    const hoyAntes = g.hoy.filter(r => r.tagCls !== 'late');
    const manana = g.dias.filter(r => r.tagCls === 'next');
    const porInformar = g.dias.filter(r => r.tagCls === 'pend');

    const item = (r, extra = '') => `<li class="in-cont-item${bodCls(r.bodega) ? ' in-b-' + bodCls(r.bodega) : ''}">
        <b>${esc(r.contenedor)}</b>${extra}
        <span>${r.hora ? esc(r.hora) + ' · ' : ''}${esc(r.material || '')} · ${esc(r.bodega || 'sin bodega')}</span>
      </li>`;

    const lista = (titulo, arr, extra) => arr.length
      ? `<h4>${titulo}</h4><ul class="in-list">${arr.map(r => item(r, extra ? extra(r) : '')).join('')}</ul>` : '';

    pintar('in-cont', `
      <div class="in-minis">
        ${mini('Hoy antes de ' + g.horaLimite, hoyAntes.length)}
        ${mini('Mañana', manana.length)}
        ${mini('Por informar', porInformar.length, porInformar.length ? 'warn' : '')}
        ${atrasados.length ? mini('Atrasados', atrasados.length, 'bad') : ''}
      </div>
      ${lista('Atrasados', atrasados, () => ' <em class="tag-late">atrasado</em>')}
      ${lista('Llegan hoy', hoyAntes)}
      ${!hoyAntes.length && !atrasados.length ? '<p class="in-vacio">No hay contenedores para hoy antes de las ' + g.horaLimite + '.</p>' : ''}
      ${lista('Mañana', manana.slice(0, 6))}
      ${manana.length > 6 ? `<p class="in-mas">y ${manana.length - 6} más…</p>` : ''}`);
  }

  // ---------- Reposición ----------
  async function cargarReposicion() {
    const { filas, origen } = await ReposicionSection.analisisParaInicio();
    const resueltas = filas.filter(f => f.resuelto);
    const porRuta = {};
    resueltas.forEach(f => {
      const k = `${BOD_CORTA[f.origenLabel] || f.origenLabel} → ${BOD_CORTA[f.destinoLabel] || f.destinoLabel}`;
      porRuta[k] = (porRuta[k] || 0) + 1;
    });
    // Más urgentes: el destino con menos stock primero
    const urgentes = [...resueltas].sort((a, b) => a.stockDestino - b.stockDestino || b.cantidad - a.cantidad).slice(0, 6);

    pintar('in-repo', `
      <p class="in-sub">${esc(origen)}</p>
      <div class="in-minis">
        ${mini('Traslados sugeridos', nf(resueltas.length), resueltas.length ? 'ok' : '')}
        ${Object.entries(porRuta).sort((a, b) => b[1] - a[1]).map(([k, v]) => mini(k, nf(v))).join('')}
      </div>
      ${urgentes.length ? `<h4>Más urgentes</h4>
        <ul class="in-list">${urgentes.map(f => `<li>
          <b>${esc(f.codigo)}</b> <span class="in-nombre">${esc(f.nombre)}</span>
          <span>${esc(BOD_CORTA[f.origenLabel] || f.origenLabel)} → ${esc(BOD_CORTA[f.destinoLabel] || f.destinoLabel)}: <strong>${nf(f.cantidad, 2)} ${esc(f.unidad)}</strong> · stock destino ${nf(f.stockDestino, 2)}</span>
        </li>`).join('')}</ul>` : '<p class="in-vacio">Sin traslados sugeridos por ahora.</p>'}`);
  }

  // ---------- Traslados ----------
  async function cargarTraslados(hoyIso) {
    const r = await fetch(TRASLADOS_API, { cache: 'no-store' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
    const guias = d.guias || [];
    if (!guias.length) { pintar('in-tras', '<p class="in-vacio">Todavía no hay guías cargadas. Sube el GS.xls en Control de Traslados.</p>'); return; }

    const ultima = guias.reduce((m, g) => g.fecha > m ? g.fecha : m, '');
    const ayerIso = diaHabilAnterior(hoyIso);
    const delDia = iso => guias.filter(g => g.fecha === iso);
    const gHoy = delDia(hoyIso), gAyer = delDia(ayerIso);
    const rutas = arr => {
      const m = {};
      arr.forEach(g => { const k = `${g.origen} → ${g.destino}`; m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const desactualizado = ultima < ayerIso;
    const bloque = (titulo, arr) => `<h4>${titulo} · ${nf(arr.length)} guías</h4>` +
      (arr.length ? `<div class="in-chips">${rutas(arr).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join('')}</div>` : '<p class="in-vacio">Sin guías registradas.</p>');

    pintar('in-tras', `
      ${desactualizado ? `<p class="in-warn">⚠️ La última guía cargada es del ${fCorta(ultima)}. Sube el GS.xls actualizado para ver lo de hoy.</p>` : `<p class="in-sub">Última guía cargada: ${fCorta(ultima)}</p>`}
      ${bloque('Hoy', gHoy)}
      ${bloque('Día hábil anterior (' + fCorta(ayerIso) + ')', gAyer)}`);
  }

  // ---------- Facturas ----------
  async function cargarFacturas(hoyIso) {
    const r = await fetch(`${FACTURAS_API}?action=listado`);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
    const regs = d.registros || [];
    const hoy = regs.filter(x => x.fechaISO === hoyIso);
    const porTipo = {};
    hoy.forEach(x => String(x.proceso || 'Normal').split(',').map(s => s.trim()).filter(Boolean).forEach(t => { porTipo[t] = (porTipo[t] || 0) + 1; }));

    pintar('in-fact', `
      <div class="in-minis">
        ${mini('Ingresadas hoy', nf(hoy.length), hoy.length ? 'ok' : '')}
        ${Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => mini(k.charAt(0) + k.slice(1).toLowerCase(), v)).join('')}
      </div>
      <h4>Últimas ingresadas</h4>
      ${regs.length ? `<ul class="in-list">${regs.slice(0, 5).map(x => `<li><b>N° ${esc(x.numero)}</b>
        <span>${esc(x.fecha)}${x.hora ? ' · ' + esc(x.hora) : ''}${x.observacion ? ' · ' + esc(x.observacion) : ''}</span></li>`).join('')}</ul>` : '<p class="in-vacio">Sin registros.</p>'}`);
  }

  // =====================================================
  // ESTILOS
  // =====================================================
  function injectStyles() {
    if (document.getElementById('in-styles')) return;
    const s = document.createElement('style');
    s.id = 'in-styles';
    s.textContent = `
      .in-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}
      .in-head h1{margin:0;font-size:22px}
      .in-head p{margin:4px 0 0;color:#6b7280;font-size:13px}
      .in-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
      .in-card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:16px 18px;min-width:0}
      .in-card header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .in-card h3{margin:0;font-size:16px}
      .in-card h4{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
      .in-link{background:none;border:0;color:#2563eb;font-weight:600;font-size:13px;cursor:pointer;padding:4px}
      .in-link:hover{text-decoration:underline}
      .in-cargando,.in-vacio,.in-mas{color:#9ca3af;font-size:13px;margin:6px 0}
      .in-err{color:#b91c1c;font-size:13px}
      .in-warn{background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px;margin:0 0 6px}
      .in-sub{color:#6b7280;font-size:12px;margin:0 0 8px}
      .in-minis{display:flex;flex-wrap:wrap;gap:8px}
      .in-mini{background:#f5f7fa;border-radius:8px;padding:8px 12px;min-width:90px}
      .in-mini strong{display:block;font-size:20px}
      .in-mini span{display:block;font-size:11px;color:#6b7280}
      .in-mini.ok strong{color:#15803d}.in-mini.warn strong{color:#b45309}.in-mini.bad strong{color:#b91c1c}
      .in-list{list-style:none;margin:0;padding:0}
      .in-list li{padding:7px 10px;border-radius:8px;background:#f9fafb;margin-bottom:5px;font-size:13px;border-left:4px solid transparent}
      .in-list li span{display:block;color:#6b7280;font-size:12px;margin-top:1px}
      .in-list li .in-nombre{display:inline;color:#374151;font-size:12px}
      .in-list li strong{color:#1f2937}
      .in-b-ald{background:#fce7f3 !important;border-left-color:#ec4899 !important}
      .in-b-viel{background:#fef9c3 !important;border-left-color:#eab308 !important}
      .tag-late{font-style:normal;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:1px 7px;font-size:11px;margin-left:4px}
      .in-chips{display:flex;flex-wrap:wrap;gap:6px}
      .in-chips span{background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 10px;font-size:12px}
      @media (max-width:900px){.in-grid{grid-template-columns:1fr}}
      @media (max-width:700px){.in-head h1{font-size:19px}.in-card{padding:14px}.in-mini{flex:1 1 40%}}
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
