// =====================================================
// SECCIÓN: NOTAS DE CRÉDITO — v5 (+ bot de Telegram + lectura con Gemini + devoluciones Softland + solicitud presencial / origen)
// Reemplaza el grupo de Telegram: solicitud → devolución en bodega → NC emitida (timbrada),
// con respaldos en Drive (solicitud, foto de bodega, PDF timbrado) e historial de quién hizo qué.
// Cruza con Control de Despachos (factura registrada / N/C marcada).
// Fuente: /api/despachos?m=nc (Apps Script "Despachos — anexo", misma planilla de Control de Despachos)
// =====================================================

const NotasCreditoSection = (() => {
  const API = '/api/despachos';
  const CF_URL = 'https://script.google.com/macros/s/AKfycbxchbWwNZnnx72MF5d_NZockO1XD56He_Ti-nIb3Hx7HLb_0u-gpqRTh0Vy3c23BrXl/exec'; // Control de Despachos (solo lectura)
  const BODEGAS = ['Aldunate', 'SF 918', 'Viel', 'San Ignacio', 'Stgo Concha'];
  const MOTIVOS = ['Cliente anula pedido', 'Cambio de producto', 'Error en digitación', 'Error en solicitud del cliente', 'Error de precio o monto',
    'Cambio de bodega', 'Error de sistema', 'Cambio/error ejecutivo', 'Stock erróneo/incompleto', 'Cambio de razón social', 'Cliente rechaza material',
    'Cliente devuelve producto', 'Cambio de material', 'Material cortado', 'Cambio de medida', 'Cambio de pago', 'Producto no despachado',
    'Cambio de factura', 'Duplicidad de factura', 'Otro'];
  const EST = {
    SOLICITADA: ['Solicitada', 'sol'], PEND_DEVOLUCION: ['Esperando devolución', 'dev'], EN_BODEGA: ['Registrada en bodega', 'bod'],
    EMITIDA: ['Emitida', 'emi'], ANULADA: ['Anulada', 'anu']
  };
  const POR_EMITIR = ['SOLICITADA', 'PEND_DEVOLUCION', 'EN_BODEGA'];
  const DIAS_ANALIZAR = 5;   // NC por emitir con más días que esto: se destaca en amarillo para analizar
  // NC que existen en Softland (factura/boleta -> NC). Se usa para detectar NC marcadas "Emitida" en la web
  // que no existen en Softland: se muestran como pendientes ("⚠ Sin NC en Softland"), sin cambiar su estado guardado.
  let sfNc = null;
  const VALIDA_DESDE = '2025-01-01';
  const refDe = n => (n.docTipo === 'Boleta' ? 'B' : 'F') + String(n.docNum || '').trim();
  // Documento en Softland: a veces se registra como factura algo que es boleta (o al revés). Se usa el que calza con la solicitud:
  // 1° el que tenga NC desde 7 días antes de la solicitud; 2° el documento de menos de 1 año antes de la solicitud; si no, el de la web.
  const MS_DIA = 864e5;
  const refSf = n => {
    const w = n._web || n, num = String(w.docNum != null ? w.docNum : n.docNum || '').trim();
    const propio = (w.docTipo === 'Boleta' ? 'B' : 'F') + num, otro = (w.docTipo === 'Boleta' ? 'F' : 'B') + num;
    const sol = String(n.fechaSolicitud || '').slice(0, 10);
    if (!sol || (!sfNc && !sfFac)) return propio;
    const desde = d => new Date(new Date(sol + 'T12:00:00') - d * MS_DIA).toISOString().slice(0, 10);
    const conNc = k => ((sfNc && sfNc.get(k)) || []).some(x => String(x.fecha || '') >= desde(7));
    const docOk = k => { const f = sfFac && sfFac.get(k); return !!f && String(f.fecha || '') >= desde(365) && String(f.fecha || '') <= sol; };
    for (const ok of [conNc, docOk]) { if (ok(propio)) return propio; if (ok(otro)) return otro; }
    return propio;
  };
  const ncsSf = n => (sfNc && sfNc.get(refSf(n))) || [];
  const sinSoftland = n => !!sfNc && n.estado === 'EMITIDA' && String(n.fechaEmision || n.fechaSolicitud || hoy || '') >= VALIDA_DESDE && !ncsSf(n).length;
  const pendiente = n => POR_EMITIR.includes(n.estado) || sinSoftland(n);
  let sfFac = null;   // datos de la factura/boleta en Softland (clave F/B + número)
  async function cargarSoftland() {
    const leer = async lista => { const r = await fetch('/api/guia?lista=' + lista, { cache: 'no-store' }); const d = await r.json(); if (!d.ok) throw new Error(d.error); return d.filas || d.nc || []; };
    try {
      const filas = await leer('nc');
      sfNc = new Map();
      filas.forEach(([folio, fecha, ref, doc, dev, estado, folioEnt, total, glosa]) => {
        if (estado !== 'V') return;
        const k = (ref === 'B' ? 'B' : 'F') + String(doc).trim();
        (sfNc.get(k) || sfNc.set(k, []).get(k)).push({ folio, fecha, dev, folioEnt, total: Number(total) || 0, glosa: glosa || '' });
      });
    } catch (err) { console.error('NC Softland:', err); sfNc = null; }
    try {
      const filas = await leer('facturas');
      sfFac = new Map(filas.map(([clave, fecha, cliente, rut, bodega, total, vendedor, productos, devoluciones]) => {
        let prods = [], devs = []; try { prods = JSON.parse(productos || '[]'); } catch (_) {} try { devs = JSON.parse(devoluciones || '[]'); } catch (_) {}
        return [clave, { fecha, cliente, rut, bodega, total: Number(total) || 0, vendedor, productos: prods, devoluciones: devs }];
      }));
    } catch (err) { console.error('Facturas Softland:', err); sfFac = null; }
    if (cargado) { aplicarSoftland(); dibujar(); autoEmitir(); }
  }

  // Motivo desde la glosa de la NC en Softland, con las mismas categorías de la web (null si no calza ninguna)
  // Reglas probadas con 600 glosas reales de Softland (incluye errores de tipeo frecuentes)
  const REGLAS_MOTIVO = [
    [/DUPLIC/, 'Duplicidad de factura'],
    [/RAZON SOCIAL|INICI?O DE GIRO/, 'Cambio de razón social'],
    [/CONDICION DE PAGO|FORMA DE PAGO|CAMBIO DE PAGO/, 'Cambio de pago'],
    [/CAMBIO DE BO[BD]EGA/, 'Cambio de bodega'],
    [/RECHAZADA EN (EL )?SII|ERROR (DEL?|EN EL) SISTEMA|ERROR DE SOFTLAND/, 'Error de sistema'],
    [/REFACTUR|CAMBIO DE FACTURA|SE CAMBIA A FACTURA/, 'Cambio de factura'],
    [/MEDIDA/, 'Cambio de medida'],
    [/CORTAD/, 'Material cortado'],
    [/CAMBIO DE MATERIAL/, 'Cambio de material'],
    [/CAMBIO DE\s+PRODU/, 'Cambio de producto'],
    [/EJECUTIV|VENDEDOR/, 'Cambio/error ejecutivo'],
    [/NO SE DESPACH|NO DESPACH|ERROR EN (LA )?ENTREGA/, 'Producto no despachado'],
    [/RECHAZ/, 'Cliente rechaza material'],
    [/DEVOLUCION|DEVUELT|DEVUELVE|DAÑO|DANO|VENCID|^DEV\.?\s+PARC/, 'Cliente devuelve producto'],
    [/ANUA?LA\s+(EL\s+)?PEDID|SE ANULA PEDIDO|CLIENTE ANULA/, 'Cliente anula pedido'],
    [/PRECIO|PESO|MONTO|DESCUENTO/, 'Error de precio o monto'],
    [/STOCK/, 'Stock erróneo/incompleto'],
    [/SOLICITUD (DE|DEL) CLIENTE/, 'Error en solicitud del cliente'],
    [/DIGITA|ERROR EN CODIGO/, 'Error en digitación']
  ];
  // Glosas genéricas que no dicen el motivo ("Anula completa la fact. N°…", "ref. factura n° … completa"): se mantiene el de la web
  const GLOSA_GENERICA = /^(ANULA|AULA)\s+C\S*\s*LA\s+(FACT|BOLETA)|^REF\S*\s+FACTURA\s+N\S*\s*\d+\s*(COMPLETA|PARCIAL)?\s*$/;
  const sinTilde = t => String(t || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const motivoDeGlosa = g => {
    const t = sinTilde(g);
    if (!t) return null;
    const r = REGLAS_MOTIVO.find(([re]) => re.test(t));
    if (r) return r[1];
    return GLOSA_GENERICA.test(t) ? null : 'Otro';
  };

  // Manda Softland: reemplaza los datos de cada NC con los de Softland; lo distinto que estaba en la web queda como nota (n._dif)
  function aplicarSoftland() {
    if (!sfNc && !sfFac) return;
    const igual = (a, b) => sinTilde(a).replace(/\s+/g, ' ').trim() === sinTilde(b).replace(/\s+/g, ' ').trim();
    notas.forEach(n => {
      n._web = n._web || { docTipo: n.docTipo, docNum: n.docNum, cliente: n.cliente, bodega: n.bodega, fechaDoc: n.fechaDoc, montoDoc: n.montoDoc, tipo: n.tipo, motivo: n.motivo, folioNc: n.folioNc, montoNc: n.montoNc };
      const w = n._web, ref = refSf(n), sf = {};
      // datos del documento solo si es de menos de 1 año antes de la solicitud (si no, es otro documento con el mismo número)
      const f0 = sfFac && sfFac.get(ref), sol = String(n.fechaSolicitud || '').slice(0, 10);
      const f = f0 && (!sol || String(f0.fecha || '') >= new Date(new Date(sol + 'T12:00:00') - 365 * MS_DIA).toISOString().slice(0, 10)) ? f0 : null;
      const ncs = ncsSf(n);
      sf.docTipo = ref[0] === 'B' ? 'Boleta' : 'Factura';
      if (f) {
        if (f.cliente) sf.cliente = f.cliente;
        if (f.bodega) sf.bodega = f.bodega;
        if (f.fecha) sf.fechaDoc = f.fecha;
        if (f.total) sf.montoDoc = f.total;
        n.sfRut = f.rut; n.sfVendedor = f.vendedor; n.sfProductos = f.productos;
        // productos devueltos: directo de las guías de entrada por devolución de Softland (ya no hace falta el informe)
        if (n._devWeb === undefined) n._devWeb = n.devoluciones;
        n.devoluciones = f.devoluciones && f.devoluciones.length ? JSON.stringify(f.devoluciones) : n._devWeb;
      }
      if (ncs.length) {
        sf.folioNc = ncs.map(x => x.folio).join(', ');
        const tot = ncs.reduce((a, x) => a + x.total, 0);
        if (tot) sf.montoNc = tot;
        const base = sf.montoDoc || Number(w.montoDoc) || 0;
        const glosas = sinTilde(ncs.map(x => x.glosa).join(' '));
        if (base && tot) sf.tipo = tot >= base * 0.99 ? 'Completa' : 'Parcial';
        else if (/PARCIAL/.test(glosas)) sf.tipo = 'Parcial'; else if (/COMPLETA|TOTAL/.test(glosas)) sf.tipo = 'Completa';
        const mots = ncs.map(x => motivoDeGlosa(x.glosa)).filter(Boolean);
        const mot = mots.find(m => m !== 'Otro') || mots[0];
        if (mot) sf.motivo = mot;
        n.sfGlosa = ncs.map(x => x.glosa).filter(Boolean).join(' · ');
      }
      const ETQ = { docTipo: 'Tipo de documento', cliente: 'Cliente', bodega: 'Bodega', fechaDoc: 'Fecha documento', montoDoc: 'Monto', tipo: 'Tipo', motivo: 'Motivo', folioNc: 'Folio NC' };
      n._dif = [];
      Object.keys(w).filter(c => c !== 'docNum').forEach(c => {
        if (sf[c] === undefined) { n[c] = w[c]; return; }
        const wv = w[c];
        if (wv !== undefined && wv !== null && wv !== '' && !igual(wv, sf[c]) && !(c.startsWith('monto') && Math.round(Number(wv)) === Math.round(Number(sf[c])))) {
          if (ETQ[c]) n._dif.push(`${ETQ[c]}: ${c.startsWith('monto') ? plata(wv) : c === 'fechaDoc' ? fCorta(wv) : wv}`);
        }
        n[c] = sf[c];
      });
      n._sf = !!(f || ncs.length);
    });
  }
  // Si Softland ya tiene la NC y en la web sigue "por emitir", se marca Emitida sola (con folio, fecha y monto de Softland).
  // Solo cuenta una NC de Softland con fecha >= solicitud − 7 días, para no tomar una NC antigua de la misma factura.
  const autoHechas = new Set();
  const ncDeSolicitud = n => { const desde = n.fechaSolicitud ? new Date(dia(n.fechaSolicitud) * 864e5 - 7 * 864e5).toISOString().slice(0, 10) : ''; return ncsSf(n).filter(x => String(x.fecha || '') >= desde); };
  async function autoEmitir() {
    if (!sfNc || !cargado) return;
    const lista = notas.filter(n => POR_EMITIR.includes(n.estado) && !autoHechas.has(n.id) && ncDeSolicitud(n).length);
    if (!lista.length) return;
    lista.forEach(n => autoHechas.add(n.id));   // antes del primer await: evita dobles envíos si se llama dos veces seguidas
    let ok = 0;
    for (const n of lista) {
      const ncs = ncDeSolicitud(n), fecha = ncs.map(x => String(x.fecha)).sort().pop();
      const tot = ncs.reduce((a, x) => a + x.total, 0);
      try { await post({ action: 'nc_emitir', id: n.id, folio: ncs.map(x => x.folio).join(', '), fecha, montoNc: tot || '', facturaSustituta: '', archivo: null, quien: 'Softland (automático)' }); ok++; }
      catch (e) { console.error('Auto-emitir', n.docNum, e); }
    }
    if (ok) { toast(`${ok} NC pasaron a Emitidas (ya están en Softland)`); await cargar(); }
  }
  // N° mal digitado: si no hay NC en Softland para el documento, busca NC de Softland de esos días cuyo documento difiera
  // en un solo dígito (cambiado, sobrante, faltante o dos vecinos invertidos) y que no esté tomada por otra ficha.
  const unDigito = (a, b) => {
    if (a === b) return false;
    if (a.length === b.length) {
      const d = [...a].map((c, i) => c !== b[i] ? i : -1).filter(i => i >= 0);
      return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
    }
    const [c, l] = a.length < b.length ? [a, b] : [b, a];
    if (l.length - c.length !== 1) return false;
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === c) return true;
    return false;
  };
  function sugerenciasNum(n) {
    if (!sfNc || ncsSf(n).length || !(sinSoftland(n) || POR_EMITIR.includes(n.estado)) || !n.fechaSolicitud) return [];
    const num = String((n._web || n).docNum || '').replace(/\D/g, ''); if (num.length < 4) return [];
    const sol = String(n.fechaSolicitud).slice(0, 10), t = new Date(sol + 'T12:00:00');
    const desde = new Date(t - 7 * MS_DIA).toISOString().slice(0, 10), hasta = new Date(+t + 30 * MS_DIA).toISOString().slice(0, 10);
    const usados = new Set(notas.filter(x => x.id !== n.id && x.estado !== 'ANULADA').map(refSf));
    const out = [];
    sfNc.forEach((lista, ref) => {
      if (usados.has(ref) || !unDigito(num, ref.slice(1))) return;
      const ok = lista.filter(x => String(x.fecha || '') >= desde && String(x.fecha || '') <= hasta);
      if (ok.length) out.push({ ref, tipo: ref[0] === 'B' ? 'Boleta' : 'Factura', num: ref.slice(1), ncs: ok });
    });
    return out;
  }
  const FILTROS = [['emitir', 'Por emitir'], ['PEND_DEVOLUCION', 'Esperando devolución'], ['EN_BODEGA', 'En bodega'], ['EMITIDA', 'Emitidas'], ['ANULADA', 'Anuladas'], ['todas', 'Todas']];
  const MAX_ARCHIVO = 3 * 1024 * 1024;
  const KEY_QUIEN = 'wl_nc_quien';

  let notas = [], tgs = [], hoy = '', cargado = false, errorCarga = '', root = null;
  const st = { tab: 'bandeja', filtro: 'emitir', bod: '', q: '', sel: null, periodo: 'mes', tgFiltro: 'SIN_ASIGNAR' };
  let cf = null, cfEstado = 'sin cargar'; // Control de Despachos: Map numero -> registro
  let dlg = null;

  // ============ UTILIDADES ============
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 0 });
  const plata = v => v === '' || v === null || v === undefined || isNaN(v) ? '—' : '$' + nf(v);
  const fCorta = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : iso; };
  const dia = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const hoyLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const num = v => { let s = String(v ?? '').replace(/[$\s]/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); const n = Number(s); return isNaN(n) ? null : n; };
  const dmyIso = s => { const m = String(s || '').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
  const docLbl = n => `${n.docTipo === 'Boleta' ? 'Boleta' : 'Factura'} N° ${n.docNum}`;
  const docCorto = n => `${n.docTipo === 'Boleta' ? 'B' : 'F'} ${n.docNum}`;
  const quien = () => { try { return localStorage.getItem(KEY_QUIEN) || ''; } catch (e) { return ''; } };
  const setQuien = v => { try { localStorage.setItem(KEY_QUIEN, v); } catch (e) {} };
  const historial = n => { try { return JSON.parse(n.historial || '[]'); } catch (e) { return []; } };
  const diasDesde = iso => iso ? dia(hoy || hoyLocal()) - dia(iso) : null;
  // Bodega de Control de Despachos ("" = Aldunate, "SAN FRANCISCO", "VIEL, SAN IGNACIO"…) -> nombre de esta sección
  const bodegaDeCF = b => { const u = txt(String(b || '').split(',')[0]); return !u ? 'Aldunate' : u.includes('FRANCISCO') ? 'SF 918' : u.includes('VIEL') ? 'Viel' : u.includes('IGNACIO') ? 'San Ignacio' : u.includes('CONCHA') ? 'Stgo Concha' : ''; };
  // Origen de la solicitud. Las NC anteriores al campo se deducen del historial.
  const ORIGENES = ['Telegram', 'Presencial', 'Web', 'Softland'];
  const origenDe = n => n.origen || (/Importado desde Telegram|Telegram ·/.test(n.historial || '') ? 'Telegram' : /Softland ·/.test(n.historial || '') ? 'Softland' : 'Web');
  const lec = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const urlDoc = n => n.fotoUrl || n.solicitudUrl || '';
  const lecturaPendiente = n => { const d = lec(n.lecturaDoc), c = lec(n.lecturaNc); return (urlDoc(n) && (!d || d.url !== urlDoc(n))) || (n.ncUrl && (!c || c.url !== n.ncUrl)); };
  const nombres = () => [...new Set(notas.flatMap(n => [n.solicitadoPor, n.registradoPor, n.emitidoPor]).filter(Boolean))].sort();

  // ============ CARGA ============
  async function cargar() {
    cargarSoftland();
    try {
      const r = await fetch(`${API}?m=nc`, { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Respuesta inválida');
      notas = d.notas; tgs = d.tg || []; hoy = d.hoy || hoyLocal(); cargado = true; errorCarga = '';
      aplicarSoftland(); autoEmitir();
    } catch (err) { console.error('NC:', err); errorCarga = err.message; hoy = hoy || hoyLocal(); }
    dibujar();
  }
  // Facturas de Control de Despachos (para cruzar). Solo lectura.
  async function cargarCF() {
    if (cfEstado === 'cargando') return;
    cfEstado = 'cargando';
    try {
      const r = await fetch(`${CF_URL}?action=listado`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      cf = new Map(d.registros.map(x => [String(x.numero).trim(), x]));
      cfEstado = 'ok';
    } catch (err) { console.error('NC → Control de Despachos:', err); cfEstado = 'error'; }
    dibujar();
  }
  async function post(body) {
    body.quien = body.quien || quien();
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d; try { d = await r.json(); } catch (e) { throw new Error(r.status === 413 ? 'El archivo es muy grande' : 'HTTP ' + r.status); }
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar');
    return d;
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    root.innerHTML = `<div class="nc">
      <div class="section-header nc-head">
        <div><h1>Notas de Crédito</h1><p>Solicitud → devolución en bodega → NC emitida, con respaldos y quién hizo cada paso.</p></div>
        <div class="nc-acts">
          <label class="nc-quien" title="Queda registrado en el historial de cada NC">👤 <input id="nc-quien" list="nc-nombres" placeholder="Tu nombre" value="${esc(quien())}"></label>
          <button class="nc-b" id="nc-ref">🔄</button>
          <button class="nc-b" id="nc-imp">📥 Importar Telegram</button>
          <button class="nc-b" id="nc-soft" title="Informe de Guías de Recepción · Devolución de Cliente">📥 Informe Softland</button>
          <button class="nc-b" id="nc-pres" title="Solicitud hecha en persona (sin pasar por el grupo)">🏬 Solicitud presencial</button>
          <button class="nc-b nc-pri" id="nc-new">➕ Nueva solicitud</button>
        </div>
      </div>
      <datalist id="nc-nombres"></datalist>
      <div class="nc-kpis" id="nc-kpis"></div>
      <div class="nc-tabs"><button data-tab="bandeja">Bandeja</button><button data-tab="telegram">Telegram <span class="nc-badge" id="nc-tgn"></span></button><button data-tab="resumen">Dashboard</button></div>
      <div id="nc-bandeja">
        <div class="nc-wrap">
          <aside class="nc-list">
            <div class="nc-list-head">
              <div class="nc-row2"><input class="nc-in" id="nc-q" type="search" placeholder="N° doc, cliente, folio, motivo…" value="${esc(st.q)}">
                <select class="nc-in nc-bodsel" id="nc-bod"><option value="">Todas las bodegas</option>${BODEGAS.map(b => `<option>${b}</option>`).join('')}</select></div>
              <div class="nc-chips" id="nc-chips"></div>
            </div>
            <div class="nc-items" id="nc-items"><p class="nc-empty">Cargando…</p></div>
          </aside>
          <section class="nc-detail" id="nc-detail"></section>
        </div>
      </div>
      <div id="nc-resumen" hidden></div>
      <div id="nc-telegram" hidden></div>
    </div>`;
    const $ = s => root.querySelector(s);
    $('#nc-quien').addEventListener('change', e => setQuien(e.target.value.trim()));
    $('#nc-ref').addEventListener('click', () => { cargar(); cargarCF(); });
    $('#nc-new').addEventListener('click', () => abrirForm(null));
    $('#nc-pres').addEventListener('click', abrirPresencial);
    $('#nc-imp').addEventListener('click', abrirImport);
    $('#nc-soft').addEventListener('click', abrirSoftland);
    $('.nc-tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; dibujar(); } });
    $('#nc-q').addEventListener('input', e => { st.q = e.target.value; dibujarLista(); });
    $('#nc-bod').addEventListener('change', e => { st.bod = e.target.value; dibujarLista(); });
    $('#nc-chips').addEventListener('click', e => { const t = e.target.closest('[data-f]'); if (t) { st.filtro = t.dataset.f; st.sel = null; dibujar(); } });
    $('#nc-items').addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) { st.sel = t.dataset.id; $('.nc-wrap').classList.add('nc-show'); dibujarLista(); dibujarDetalle(); } });
    // visor de archivos (respaldos y mensajes de Telegram): se abre en la misma página
    root.querySelector('.nc').addEventListener('click', e => { const f = e.target.closest('[data-file]'); if (f) { e.stopPropagation(); verArchivo(f.dataset.file, f.dataset.titulo); } }, true);
    root.querySelector('.nc').addEventListener('click', e => { const g = e.target.closest('[data-guia]'); if (g) { e.stopPropagation(); verGuia(g.dataset.guia, g.dataset.titulo); } }, true);
    $('#nc-detail').addEventListener('click', accion);
    $('#nc-detail').addEventListener('change', adjuntarSuelto);
    $('#nc-telegram').addEventListener('click', accionTg);
    $('#nc-resumen').addEventListener('click', e => {
      const p = e.target.closest('[data-per]'); if (p) { st.periodo = p.dataset.per; dibujarResumen(); }
      const c = e.target.closest('[data-crear]'); if (c) abrirForm(null, c.dataset.crear);
    });
    dibujar();
    cargar();
    if (!cf) cargarCF();
  }

  function pasaFiltro(n) {
    if (st.filtro === 'emitir') return pendiente(n);
    if (st.filtro === 'todas') return true;
    if (st.filtro === 'EMITIDA') return n.estado === 'EMITIDA' && !sinSoftland(n);
    return n.estado === st.filtro;
  }
  function filtradas() {
    const q = txt(st.q.trim());
    return notas.filter(pasaFiltro)
      .filter(n => !st.bod || n.bodega === st.bod)
      .filter(n => { if (!q) return true; const d = lec(n.lecturaDoc) || {};
        return txt([n.docNum, n.cliente, n.folioNc, n.motivo, n.solicitadoPor, n.facturaSustituta, n.obs, d.rut, d.vendedor, ...(d.productos || []).map(p => p.codigo + ' ' + p.descripcion)].join(' ')).includes(q); })
      .sort((a, b) => POR_EMITIR.includes(a.estado) && POR_EMITIR.includes(b.estado)
        ? String(a.fechaSolicitud).localeCompare(String(b.fechaSolicitud))           // por emitir: lo más antiguo primero
        : String(b.fechaEmision || b.fechaSolicitud).localeCompare(String(a.fechaEmision || a.fechaSolicitud)));
  }

  // ============ RENDER ============
  function dibujar() {
    if (!root || !root.querySelector('.nc')) return;
    root.querySelectorAll('.nc-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    root.querySelector('#nc-bandeja').hidden = st.tab !== 'bandeja';
    root.querySelector('#nc-resumen').hidden = st.tab !== 'resumen';
    root.querySelector('#nc-telegram').hidden = st.tab !== 'telegram';
    const sinAsig = tgs.filter(t => t.estado === 'SIN_ASIGNAR').length;
    root.querySelector('#nc-tgn').textContent = sinAsig || '';
    root.querySelector('#nc-nombres').innerHTML = nombres().map(n => `<option value="${esc(n)}">`).join('');
    const mes = (hoy || hoyLocal()).slice(0, 7);
    const pend = notas.filter(pendiente);
    const emMes = notas.filter(n => n.estado === 'EMITIDA' && String(n.fechaEmision).startsWith(mes));
    const tiempos = notas.filter(n => n.estado === 'EMITIDA' && n.fechaSolicitud && n.fechaEmision).map(n => dia(n.fechaEmision) - dia(n.fechaSolicitud)).filter(x => x >= 0);
    const prom = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;
    root.querySelector('#nc-kpis').innerHTML = [
      ['Por emitir', pend.length, [pend.filter(n => POR_EMITIR.includes(n.estado) && diasDesde(n.fechaSolicitud) > DIAS_ANALIZAR).length ? `${pend.filter(n => POR_EMITIR.includes(n.estado) && diasDesde(n.fechaSolicitud) > DIAS_ANALIZAR).length} con más de ${DIAS_ANALIZAR} días` : '',
        pend.filter(sinSoftland).length ? `${pend.filter(sinSoftland).length} emitidas sin NC en Softland` : ''].filter(Boolean).join(' · '), 'nar'],
      ['Esperando devolución', notas.filter(n => n.estado === 'PEND_DEVOLUCION').length, '', ''],
      ['Emitidas este mes', emMes.length, plata(emMes.reduce((s, n) => s + (Number(n.montoNc || (n.tipo === 'Completa' ? n.montoDoc : 0)) || 0), 0)), 'verde'],
      ['Días promedio a emisión', prom === null ? '—' : prom.toFixed(1).replace('.', ','), tiempos.length ? `${tiempos.length} NC medidas` : '', '']
    ].map(([l, v, s, c]) => `<div class="nc-kpi ${c}"><span>${l}</span><strong>${v}</strong>${s ? `<small>${s}</small>` : ''}</div>`).join('');
    const cnt = k => notas.filter(n => k === 'emitir' ? pendiente(n) : k === 'todas' ? true : k === 'EMITIDA' ? n.estado === 'EMITIDA' && !sinSoftland(n) : n.estado === k).length;
    root.querySelector('#nc-chips').innerHTML = FILTROS.map(([k, l]) => `<button class="nc-chip${st.filtro === k ? ' on' : ''}" data-f="${k}">${l} <b>${cnt(k)}</b></button>`).join('');
    if (st.tab === 'bandeja') { dibujarLista(); dibujarDetalle(); } else if (st.tab === 'telegram') dibujarTelegram(); else dibujarResumen();
  }

  function dibujarLista() {
    const el = root && root.querySelector('#nc-items'); if (!el) return;
    if (errorCarga) { el.innerHTML = `<p class="nc-err">No se pudieron cargar las notas de crédito: ${esc(errorCarga)}</p>`; return; }
    if (!cargado) return;
    const f = filtradas();
    if (!st.sel && f.length && !window.matchMedia('(max-width: 900px)').matches) st.sel = f[0].id;
    el.innerHTML = f.map(n => {
      const [lbl, cls] = EST[n.estado] || ['—', ''];
      const sinSf = sinSoftland(n);
      const d = pendiente(n) ? diasDesde(n.fechaSolicitud) : null;
      const analizar = sinSf || (d !== null && d > DIAS_ANALIZAR);
      return `<button class="nc-item${st.sel === n.id ? ' cur' : ''}${analizar ? ' nc-analizar' : ''}" data-id="${esc(n.id)}"${analizar ? ` title="Lleva ${d} días sin NC en sistema: revisar"` : ''}>
        <div class="nc-it-top"><i class="nc-dot ${sinSf ? 'nar' : cls}"></i><b>${esc(docCorto(n))}</b>${sinSf ? '<span class="nc-tag-an">⚠ Sin NC en Softland</span>' : analizar ? '<span class="nc-tag-an">⚠ Analizar</span>' : ''}${n.tipo ? `<span class="nc-tipo">${esc(n.tipo)}</span>` : ''}${origenDe(n) === 'Presencial' ? '<span class="nc-tipo nc-pres">🏬 Presencial</span>' : ''}<span class="nc-it-r">${n.montoDoc ? plata(n.montoDoc) : ''}</span></div>
        <small>${esc(n.cliente || 'Sin cliente')}</small>
        <small>${esc(lbl)}${n.motivo ? ' · ' + esc(n.motivo) : ''}${d !== null ? ` · <span class="${d > DIAS_ANALIZAR ? 'nc-late' : ''}">${d <= 0 ? 'hoy' : d + (d === 1 ? ' día' : ' días')}</span>` : n.estado === 'EMITIDA' ? ' · ' + fCorta(n.fechaEmision) : ''}</small>
      </button>`;
    }).join('') || `<p class="nc-empty">${notas.length ? 'Ninguna NC coincide' : 'Aún no hay notas de crédito. Crea una o importa el historial de Telegram.'}</p>`;
  }

  function pasos(n) {
    const dev = String(n.requiereDev).toUpperCase() === 'SI' || n.fechaBodega || n.fotoUrl;
    const p = [{ t: 'Solicitada', ok: true, f: n.fechaSolicitud, q: n.solicitadoPor }];
    if (dev) p.push({ t: n.estado === 'PEND_DEVOLUCION' ? 'Esperando devolución' : 'Registrada en bodega', ok: !!(n.fechaBodega || n.fotoUrl), f: n.fechaBodega, q: n.registradoPor });
    p.push({ t: n.estado === 'ANULADA' ? 'Anulada' : 'Emitida', ok: n.estado === 'EMITIDA' || n.estado === 'ANULADA', f: n.fechaEmision, q: n.emitidoPor, anu: n.estado === 'ANULADA' });
    return p;
  }

  function dibujarDetalle() {
    const el = root && root.querySelector('#nc-detail'); if (!el) return;
    const n = notas.find(x => x.id === st.sel);
    if (!n) { el.innerHTML = `<div class="nc-card nc-empty">${cargado ? 'Elige una NC de la lista' : 'Cargando…'}</div>`; return; }
    const [lbl, cls] = EST[n.estado] || ['—', ''];
    const abierta = POR_EMITIR.includes(n.estado);
    const reg = cf && cf.get(String(n.docNum).trim());
    const cfHtml = n.docTipo === 'Boleta' ? '' : cfEstado === 'cargando' ? '<span class="nc-dim">Buscando en Control de Despachos…</span>'
      : !cf ? '<span class="nc-dim">No se pudo consultar Control de Despachos</span>'
      : reg ? `✓ Registrada en Control de Despachos el ${esc(reg.fecha)}${reg.bodega ? ' · ' + esc(reg.bodega) : ''}${reg.proceso ? ' · ' + esc(reg.proceso) : ''}${reg.nc ? ` · <b>N/C ${esc(reg.nc)}</b> marcada${reg.motivoNc ? ' (' + esc(reg.motivoNc) + ')' : ''}` : ' · sin N/C marcada allá'}`
      : '<span class="nc-dim">No aparece en Control de Despachos</span>';
    // 3er respaldo: la guía de entrada por devolución que Softland genera al emitir la NC
    // (visor guia.html, clave EF + factura / EB + boleta).
    const ncSoftland = n => {
      const clave = 'E' + refSf(n);
      const titulo = 'Guía de entrada por devolución · ' + docLbl(n) + (n.folioNc ? ' · NC ' + n.folioNc : '');
      const btn = `<button class="nc-b nc-sm" data-guia="${esc(clave)}" data-titulo="${esc(titulo)}">Ver</button>`;
      if (!sfNc) {   // sin conexión a Softland: comportamiento anterior
        const ver = n.estado === 'EMITIDA' && /^E[FB]\d+$/.test(clave);
        return `<div class="nc-file${ver ? ' has' : ''}"><span>🧾 Nota de Crédito</span>${ver ? btn : '<em>Se verá al emitir la NC en Softland</em>'}</div>`;
      }
      const ncs = ncsSf(n);
      if (!ncs.length) return `<div class="nc-file${n.estado === 'EMITIDA' ? ' warn' : ''}"><span>🧾 Nota de Crédito</span><em>${n.estado === 'EMITIDA' ? '⚠ Softland no registra NC para este documento' : 'Se verá al emitir la NC en Softland'}</em></div>`;
      const folios = ncs.map(x => x.folio).join(', ');
      const conGuia = ncs.some(x => x.folioEnt && String(x.folioEnt) !== '0');
      return `<div class="nc-file has"><span>🧾 Nota de Crédito</span><em>NC ${esc(folios)} en Softland</em>${conGuia ? btn : '<em>Sin guía de entrada (no hubo devolución de mercadería)</em>'}</div>`;
    };
    // 2º respaldo: autorización de bodega = documento timbrado (campo ncUrl); la foto de bodega (fotoUrl), si existe, como secundaria
    const autorizacion = n => {
      const doc = n.ncUrl, foto = n.fotoUrl;
      return `<div class="nc-file${doc || foto ? ' has' : ''}"><span>📷 Autorización Bodega</span>
        ${doc ? `<button class="nc-b nc-sm" data-file="${esc(doc)}" data-titulo="${esc('Autorización Bodega · ' + docLbl(n))}">Ver</button>` : '<em>Sin archivo</em>'}
        ${foto ? `<button class="nc-b nc-sm" data-file="${esc(foto)}" data-titulo="${esc('Foto bodega · ' + docLbl(n))}">Ver foto</button>` : ''}
        <label class="nc-b nc-sm">${doc ? 'Reemplazar' : 'Adjuntar'}<input type="file" accept="image/*,application/pdf" data-campo="ncUrl" hidden></label></div>`;
    };
    const arch = (campo, titulo, icono) => {
      const url = n[campo];
      return `<div class="nc-file${url ? ' has' : ''}"><span>${icono} ${titulo}</span>
        ${url ? `<button class="nc-b nc-sm" data-file="${esc(url)}" data-titulo="${esc(titulo + ' · ' + docLbl(n))}">Ver</button>` : '<em>Sin archivo</em>'}
        <label class="nc-b nc-sm">${url ? 'Reemplazar' : 'Adjuntar'}<input type="file" accept="image/*,application/pdf" data-campo="${campo}" hidden></label></div>`;
    };
    el.innerHTML = `
      <div class="nc-top"><button class="nc-b nc-back" data-back>‹ Notas de crédito</button>
        <div class="nc-acts">
          ${abierta && n.estado !== 'EN_BODEGA' ? '<button class="nc-b" data-bodega>📦 Registrar en bodega</button>' : ''}
          ${abierta ? '<button class="nc-b nc-pri" data-emitir>✅ Emitir NC</button>' : ''}
          <button class="nc-b" data-edit>✏️ Editar</button>
          ${abierta ? '<button class="nc-b" data-anular>Anular</button>' : '<button class="nc-b" data-reabrir>Reabrir</button>'}
          <button class="nc-b nc-del" data-borrar title="Eliminar">🗑</button>
        </div></div>
      <div class="nc-card">
        <div class="nc-hl">
          <div><h2>${esc(docLbl(n))} <span class="nc-est ${cls}">${lbl}</span></h2><p>${esc(n.cliente || 'Sin cliente')}</p></div>
          ${n.montoDoc || n.montoNc ? `<div class="nc-big"><strong>${n.tipo === 'Parcial' && n.montoNc ? plata(n.montoNc) : plata(n.montoDoc)}</strong><span>${n.tipo === 'Parcial' ? 'NC parcial' + (n.montoDoc ? ' de ' + plata(n.montoDoc) : '') : n.tipo === 'Completa' ? 'NC completa' : 'monto documento'}</span></div>` : ''}
        </div>
        <ol class="nc-steps">${pasos(n).map(p => `<li class="${p.ok ? (p.anu ? 'anu' : 'ok') : ''}"><b>${p.t}</b><small>${p.ok ? fCorta(p.f) + (p.q ? ' · ' + esc(p.q) : '') : 'pendiente'}</small></li>`).join('')}</ol>
        <div class="nc-facts">
          <div><span>Tipo</span><b>${esc(n.tipo || '—')}</b></div>
          <div><span>Motivo</span><b>${esc(n.motivo || '—')}</b></div>
          <div><span>Bodega</span><b>${esc(n.bodega || '—')}</b></div>
          <div><span>Fecha documento</span><b>${fCorta(n.fechaDoc)}</b></div>
          <div><span>Folio NC</span><b>${esc(n.folioNc || ncsSf(n).map(x => x.folio).join(', ') || '—')}</b>${!n.folioNc && ncsSf(n).length ? '<small class="nc-dim"> (Softland)</small>' : ''}</div>
          <div><span>Origen</span><b>${esc(origenDe(n))}</b></div>
          ${n.facturaSustituta ? `<div><span>Factura sustituta</span><b>${esc(n.facturaSustituta)}</b></div>` : ''}
        </div>
        ${cfHtml ? `<p class="nc-cf">${cfHtml}</p>` : ''}
        ${n._sf ? `<div class="nc-note nc-sf">🔗 Datos desde Softland${n.sfRut ? ` · RUT ${esc(n.sfRut)}` : ''}${n.sfVendedor ? ` · Vendedor ${esc(n.sfVendedor)}` : ''}${n.sfGlosa ? `<br><small>Glosa NC: ${esc(n.sfGlosa)}</small>` : ''}${n._dif && n._dif.length ? `<br><small>En la web estaba: ${n._dif.map(esc).join(' · ')}</small>` : ''}</div>` : ''}
        ${sugerenciasNum(n).map(g => `<div class="nc-note nc-sug">🔎 ¿El N° está mal digitado? Softland tiene la <b>NC ${esc(g.ncs.map(x => x.folio).join(', '))}</b> del ${esc(fCorta(g.ncs[0].fecha))} para <b>${esc(g.tipo)} N° ${esc(g.num)}</b>${g.ncs[0].glosa ? ` <span class="nc-dim">(${esc(g.ncs[0].glosa)})</span>` : ''}. Revisa la solicitud: si es esa, corrige el número.
          <button class="nc-b nc-sm nc-pri" data-corregir="${esc(g.num)}" data-corregir-tipo="${esc(g.tipo)}">Corregir a ${esc(g.tipo)} N° ${esc(g.num)}</button></div>`).join('')}
        ${sinSoftland(n) ? `<div class="nc-note nc-an">⚠️ Está marcada como <b>emitida</b>${n.fechaEmision ? ' el ' + esc(fCorta(n.fechaEmision)) : ' (sin fecha de emisión)'}, pero <b>Softland no registra ninguna NC</b> para ${esc(docLbl(n))}. Se cuenta como pendiente hasta que aparezca en Softland (se revisa cada 10 min). Si se marcó por error, usa <b>Reabrir</b>.</div>` : ''}
        ${POR_EMITIR.includes(n.estado) && diasDesde(n.fechaSolicitud) > DIAS_ANALIZAR ? `<div class="nc-note nc-an">⚠️ Lleva <b>${diasDesde(n.fechaSolicitud)} días</b> sin NC en sistema (más de ${DIAS_ANALIZAR}). Hay que analizar por qué aún no se hace la devolución en Softland.</div>` : ''}
        ${n.anulacion ? `<div class="nc-note anu">Anulada: ${esc(n.anulacion)}</div>` : ''}
        ${n.obs ? `<div class="nc-note">${esc(n.obs)}</div>` : ''}
      </div>
      ${devolucionesHtml(n)}
      <div class="nc-card"><h3 class="nc-h3">Respaldos</h3>
        <div class="nc-files">${arch('solicitudUrl', 'Solicitud', '📝')}${autorizacion(n)}${ncSoftland(n)}</div>
      </div>
      <div class="nc-card"><h3 class="nc-h3">Historial</h3>
        <ol class="nc-hist">${historial(n).slice().reverse().map(h => `<li><b>${esc(h.q || '—')}</b> ${esc(h.t)}<small>${esc(h.f)}</small></li>`).join('') || '<li class="nc-dim">Sin movimientos</li>'}</ol>
      </div>`;
  }

  // ============ ACCIONES ============
  function pedirQuien() {
    let q = quien();
    if (!q) { q = (prompt('¿Quién eres? Queda registrado en el historial.') || '').trim(); if (q) { setQuien(q); const i = root.querySelector('#nc-quien'); if (i) i.value = q; } }
    return q;
  }
  async function accion(e) {
    if (e.target.closest('[data-back]')) { root.querySelector('.nc-wrap').classList.remove('nc-show'); return; }
    const n = notas.find(x => x.id === st.sel); if (!n) return;
    if (e.target.closest('[data-edit]')) return abrirForm(n);
    const cb = e.target.closest('[data-corregir]');
    if (cb) {
      const w = n._web || n, nuevo = cb.dataset.corregir, tipoDoc = cb.dataset.corregirTipo;
      if (!confirm(`¿Cambiar ${w.docTipo === 'Boleta' ? 'Boleta' : 'Factura'} N° ${w.docNum} por ${tipoDoc} N° ${nuevo}?\nCliente, fecha y monto del documento se borran y se toman de Softland en el próximo sync (máx. 10 min).`)) return;
      if (!pedirQuien()) return toast('Escribe tu nombre arriba para registrar el cambio', true);
      const x = { id: n.id, docTipo: tipoDoc, docNum: nuevo, fechaDoc: '', bodega: w.bodega || '', cliente: '', tipo: w.tipo || '', motivo: w.motivo || '',
        montoDoc: '', montoNc: w.montoNc ?? '', solicitadoPor: n.solicitadoPor || '', fechaSolicitud: n.fechaSolicitud || '', requiereDev: n.requiereDev || '', obs: n.obs || '', origen: origenDe(n) };
      cb.disabled = true; cb.textContent = 'Guardando…';
      try {
        try { await post({ action: 'nc_guardar', n: x, archivo: null }); }
        catch (e2) { if (!/Ya existe una NC activa/.test(e2.message) || !confirm(e2.message)) throw e2; await post({ action: 'nc_guardar', n: x, archivo: null, forzar: true }); }
        toast(`N° corregido a ${tipoDoc} ${nuevo}`); await cargar();
      } catch (err) { toast(err.message, true); cb.disabled = false; cb.textContent = `Corregir a ${tipoDoc} N° ${nuevo}`; }
      return;
    }
    const lb = e.target.closest('[data-leer]');
    if (lb) { lb.disabled = true; lb.textContent = 'Leyendo… (10–30 s)'; return ejecutar({ action: 'nc_leer', id: n.id, forzar: lb.dataset.leer === 'forzar' }, 'Factura leída'); }
    if (e.target.closest('[data-bodega]')) return abrirPaso(n, 'bodega');
    if (e.target.closest('[data-emitir]')) return abrirPaso(n, 'emitir');
    if (e.target.closest('[data-anular]')) {
      if (!pedirQuien()) return;
      const m = prompt(`¿Por qué se anula la solicitud de ${docLbl(n)}?`, 'Queda sin efecto');
      if (m === null) return;
      return ejecutar({ action: 'nc_anular', id: n.id, motivo: m.trim() }, 'Solicitud anulada');
    }
    if (e.target.closest('[data-reabrir]')) {
      if (!pedirQuien()) return;
      if (n.estado === 'EMITIDA' && !confirm('¿Reabrir? Se borran el folio y la fecha de emisión (el PDF timbrado se mantiene).')) return;
      return ejecutar({ action: 'nc_reabrir', id: n.id }, 'Reabierta');
    }
    if (e.target.closest('[data-borrar]')) {
      if (!confirm(`¿Eliminar la NC de ${docLbl(n)} y sus archivos? No se puede deshacer. Si solo quedó sin efecto, usa Anular.`)) return;
      st.sel = null;
      return ejecutar({ action: 'nc_borrar', id: n.id }, 'Eliminada');
    }
  }
  async function adjuntarSuelto(e) {
    const inp = e.target.closest('input[type=file][data-campo]'); if (!inp || !inp.files[0]) return;
    if (!pedirQuien()) { inp.value = ''; return; }
    const lab = inp.closest('label'); lab.firstChild.textContent = 'Subiendo…';
    try {
      const archivo = await prepararArchivo(inp.files[0]);
      await post({ action: 'nc_archivo', id: st.sel, campo: inp.dataset.campo, archivo });
      toast('Archivo adjuntado'); await cargar();
    } catch (err) { toast(err.message, true); lab.firstChild.textContent = 'Adjuntar'; }
  }
  async function ejecutar(body, ok) {
    try { await post(body); toast(ok); await cargar(); }
    catch (err) { toast(err.message, true); }
  }

  // Hora del mensaje: "10:05". Si viene como fecha (registros antiguos que Sheets convirtió) no se muestra.
  const horaTg = h => /^\d{1,2}:\d{2}/.test(String(h || '')) ? String(h).slice(0, 5) : '';

  // ============ VISOR DE ARCHIVOS ============
  // Vista previa de Drive (fotos y PDF) dentro de la página, con descargar y abrir en Drive
  let visor = null;
  const idDrive = url => { const m = String(url || '').match(/[-\w]{25,}/); return m ? m[0] : ''; };
  function asegurarVisor() {
    if (visor) return;
    visor = document.createElement('dialog');
    visor.className = 'nc-visor';
    visor.addEventListener('click', e => { if (e.target === visor || e.target.closest('[data-cerrar]')) visor.close(); });
    visor.addEventListener('close', () => { const f = visor.querySelector('iframe'); if (f) f.src = 'about:blank'; });
    document.body.appendChild(visor);
  }

  // Girar el archivo del visor (foto o PDF de Drive): se gira el iframe completo en pasos de 90°
  function girarVisor(body, delta) {
    const f = body && body.querySelector('iframe'); if (!f) return;
    f.dataset.g = (((+f.dataset.g || 0) + delta) % 360 + 360) % 360;
    ajustarGiro(body);
  }
  function ajustarGiro(body) {
    const f = body && body.querySelector('iframe'); if (!f) return;
    const g = +f.dataset.g || 0;
    if (!g) { f.style.cssText = ''; return; }
    const cs = getComputedStyle(body), w = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const lado = g % 180 !== 0;
    body.style.position = 'relative'; body.style.overflow = 'hidden';
    f.style.cssText = `position:absolute;left:50%;top:50%;width:${lado ? h : w}px;height:${lado ? w : h}px;transform:translate(-50%,-50%) rotate(${g}deg)`;
  }
  function verArchivo(url, titulo) {
    const id = idDrive(url);
    asegurarVisor();
    visor.innerHTML = `<div class="nc-visor-in">
      <div class="nc-visor-head"><h2>${esc(titulo || 'Archivo')}</h2>
        <div class="nc-visor-acts">
          ${id ? `<a class="nc-b nc-sm" href="https://drive.google.com/uc?export=download&id=${esc(id)}" target="_blank" rel="noopener">⬇ Descargar</a>` : ''}
          ${id ? `<button class="nc-b nc-sm" data-girar="-90" title="Girar a la izquierda">⟲</button><button class="nc-b nc-sm" data-girar="90" title="Girar a la derecha">⟳</button>` : ''}
          <a class="nc-b nc-sm" href="${esc(url)}" target="_blank" rel="noopener">↗ Abrir en Drive</a>
          <button class="nc-x" data-cerrar aria-label="Cerrar">✕</button>
        </div></div>
      <div class="nc-visor-body">${id ? `<iframe src="https://drive.google.com/file/d/${esc(id)}/preview" title="${esc(titulo || 'Archivo')}" allow="autoplay"></iframe>` : '<p class="nc-empty">No se puede mostrar este archivo aquí. Ábrelo en Drive.</p>'}</div>
    </div>`;
    visor.querySelectorAll('[data-girar]').forEach(b => b.addEventListener('click', () => girarVisor(visor.querySelector('.nc-visor-body'), +b.dataset.girar)));
    if (!window['_giro_nc']) { window['_giro_nc'] = 1; window.addEventListener('resize', () => { if (visor && visor.open) ajustarGiro(visor.querySelector('.nc-visor-body')); }); }
    visor.showModal();
  }

  // Guía de Softland (formato de impresión) en el mismo visor, con imprimir / guardar PDF
  function verGuia(clave, titulo) {
    asegurarVisor();
    visor.innerHTML = `<div class="nc-visor-in">
      <div class="nc-visor-head"><h2>${esc(titulo || 'Guía')}</h2>
        <div class="nc-visor-acts">
          <button class="nc-b nc-sm" data-imprimir-guia>🖨️ Imprimir</button>
          <button class="nc-b nc-sm" data-descargar-guia>⬇️ Descargar PDF</button>
          <button class="nc-x" data-cerrar aria-label="Cerrar">✕</button>
        </div></div>
      <div class="nc-visor-body"><iframe src="guia.html?embed=1&guia=${encodeURIComponent(clave)}" title="${esc(titulo || 'Guía')}"></iframe></div>
    </div>`;
    visor.querySelector('[data-imprimir-guia]').addEventListener('click', () => { const f = visor.querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.print(); });
    visor.querySelector('[data-descargar-guia]').addEventListener('click', async e => {
      const f = visor.querySelector('iframe'), b = e.currentTarget; if (!f || !f.contentWindow || !f.contentWindow.descargarPdf) return;
      b.disabled = true; const t = b.textContent; b.textContent = 'Generando…';
      try { await f.contentWindow.descargarPdf(); } catch (err) { alert('No se pudo generar el PDF: ' + err.message); } finally { b.disabled = false; b.textContent = t; }
    });
    visor.showModal();
  }

  // ============ ARCHIVOS ============
  async function prepararArchivo(f) {
    if (!f) return null;
    let out;
    if (f.type.startsWith('image/')) {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.78));
      out = { nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', tipo: 'image/jpeg', blob };
    } else out = { nombre: f.name, tipo: f.type || 'application/pdf', blob: f };
    if (out.blob.size > MAX_ARCHIVO) throw new Error(`${f.name} pesa más de 3 MB. Si es un PDF escaneado, súbelo como foto.`);
    return { nombre: out.nombre, tipo: out.tipo, base64: await aBase64(out.blob) };
  }
  const aBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // ============ DIÁLOGO GENÉRICO ============
  function abrirDlg(titulo, cuerpo, textoBoton, onGuardar) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'nc-dlg';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<div class="nc-dlg-in">
      <div class="nc-dlg-head"><h2>${esc(titulo)}</h2><button type="button" class="nc-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="nc-dlg-body">${cuerpo}</div>
      <div class="nc-dlg-foot"><span class="nc-err" data-err></span><button type="button" class="nc-b nc-pri" data-ok>${esc(textoBoton)}</button></div></div>`;
    const err = dlg.querySelector('[data-err]'), btn = dlg.querySelector('[data-ok]');
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    btn.onclick = async () => {
      err.textContent = ''; btn.disabled = true; const t = btn.textContent; btn.textContent = 'Guardando…';
      try { if (await onGuardar(dlg) !== false) dlg.close(); }
      catch (e2) { err.textContent = e2.message; }
      finally { btn.disabled = false; btn.textContent = t; }
    };
    dlg.showModal();
    return dlg;
  }
  const v = (d, sel) => (d.querySelector(sel).value || '').trim();
  const fileUI = (id, txtBtn) => `<label class="nc-drop">${txtBtn}<input type="file" id="${id}" accept="image/*,application/pdf"><small>En el celular puedes sacar la foto directo. Las fotos se comprimen antes de subir.</small></label>`;

  // ============ NUEVA / EDITAR ============
  function abrirForm(n, docSugerido) {
    const q = quien();
    const motivoOtro = n && n.motivo && !MOTIVOS.includes(n.motivo);
    const d = abrirDlg(n ? `Editar · ${docLbl(n)}` : 'Nueva solicitud de NC', `
      <div class="nc-grid">
        <label>Documento<select class="nc-in" id="f-tipo-doc"><option>Factura</option><option>Boleta</option></select></label>
        <label>N° documento<input class="nc-in" id="f-num" inputmode="numeric" autocomplete="off" value="${esc(n ? n.docNum : docSugerido || '')}"></label>
        <label>Fecha documento<input class="nc-in" id="f-fdoc" type="date" value="${esc(n ? n.fechaDoc : '')}"></label>
        <label>Bodega<select class="nc-in" id="f-bod"><option value="">—</option>${BODEGAS.map(b => `<option>${b}</option>`).join('')}</select></label>
        <label class="nc-span2">Cliente<input class="nc-in" id="f-cli" autocomplete="off" value="${esc(n ? n.cliente : '')}"></label>
        <label>Tipo de NC<select class="nc-in" id="f-tipo"><option value="">—</option><option>Completa</option><option>Parcial</option></select></label>
        <label>Motivo<select class="nc-in" id="f-mot"><option value="">—</option>${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="nc-span2" id="f-otro-w" hidden>Especifica el motivo<input class="nc-in" id="f-otro" value="${esc(motivoOtro ? n.motivo : '')}"></label>
        <label>Monto documento ($)<input class="nc-in" id="f-mdoc" inputmode="numeric" value="${esc(n ? n.montoDoc : '')}"></label>
        <label id="f-mnc-w">Monto NC ($)<input class="nc-in" id="f-mnc" inputmode="numeric" value="${esc(n ? n.montoNc : '')}"></label>
        <label>Solicitado por<input class="nc-in" id="f-sol" list="nc-nombres" value="${esc(n ? n.solicitadoPor : q)}"></label>
        <label>Fecha solicitud<input class="nc-in" id="f-fsol" type="date" value="${esc(n ? n.fechaSolicitud : hoyLocal())}"></label>
        <label>Origen<select class="nc-in" id="f-orig">${ORIGENES.map(o => `<option>${o}</option>`).join('')}</select></label>
        <label class="nc-check nc-span2"><input type="checkbox" id="f-dev" ${n && String(n.requiereDev).toUpperCase() === 'SI' ? 'checked' : ''}> Requiere devolución o retiro de material en bodega</label>
        <label class="nc-span2">Observación<input class="nc-in" id="f-obs" value="${esc(n ? n.obs : '')}"></label>
      </div>
      <p class="nc-cfhint" id="f-cf"></p>
      ${n ? '' : fileUI('f-arch', '📝 Adjuntar solicitud (PDF o foto)')}
      <datalist id="nc-nombres2">${nombres().map(x => `<option value="${esc(x)}">`).join('')}</datalist>`, n ? 'Guardar cambios' : 'Crear solicitud', async dd => {
      if (!pedirQuien()) throw new Error('Escribe tu nombre arriba para registrar quién hace la solicitud');
      const mot = v(dd, '#f-mot') === 'Otro' ? (v(dd, '#f-otro') || 'Otro') : v(dd, '#f-mot');
      const x = {
        id: n ? n.id : '', docTipo: v(dd, '#f-tipo-doc'), docNum: v(dd, '#f-num').replace(/\D/g, ''), fechaDoc: v(dd, '#f-fdoc'), bodega: v(dd, '#f-bod'),
        cliente: v(dd, '#f-cli'), tipo: v(dd, '#f-tipo'), motivo: mot, montoDoc: num(v(dd, '#f-mdoc')) ?? '', montoNc: v(dd, '#f-tipo') === 'Parcial' ? (num(v(dd, '#f-mnc')) ?? '') : '',
        solicitadoPor: v(dd, '#f-sol'), fechaSolicitud: v(dd, '#f-fsol'), requiereDev: dd.querySelector('#f-dev').checked ? 'SI' : '', obs: v(dd, '#f-obs'), origen: v(dd, '#f-orig')
      };
      if (!x.docNum) throw new Error('Falta el N° de documento');
      const fi = dd.querySelector('#f-arch');
      const archivo = fi && fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
      let r;
      try { r = await post({ action: 'nc_guardar', n: x, archivo }); }
      catch (e2) {
        if (!/Ya existe una NC activa/.test(e2.message) || !confirm(e2.message)) throw e2;
        r = await post({ action: 'nc_guardar', n: x, archivo, forzar: true });
      }
      st.sel = r.id; if (!n) { st.filtro = 'emitir'; st.tab = 'bandeja'; }
      toast(n ? 'NC actualizada' : 'Solicitud creada');
      await cargar();
    });
    d.querySelector('#f-tipo-doc').value = n && n.docTipo === 'Boleta' ? 'Boleta' : 'Factura';
    d.querySelector('#f-bod').value = n && BODEGAS.includes(n.bodega) ? n.bodega : '';
    d.querySelector('#f-tipo').value = n ? n.tipo || '' : '';
    d.querySelector('#f-orig').value = n ? origenDe(n) : 'Web';
    d.querySelector('#f-mot').value = motivoOtro ? 'Otro' : n ? n.motivo || '' : '';
    d.querySelector('#f-sol').setAttribute('list', 'nc-nombres2');
    const sync = () => {
      d.querySelector('#f-otro-w').hidden = d.querySelector('#f-mot').value !== 'Otro';
      d.querySelector('#f-mnc-w').style.visibility = d.querySelector('#f-tipo').value === 'Parcial' ? 'visible' : 'hidden';
    };
    d.querySelector('#f-mot').addEventListener('change', sync);
    d.querySelector('#f-tipo').addEventListener('change', sync);
    sync();
    // Al escribir el N°: busca la factura en Control de Despachos y completa fecha y bodega
    const buscar = () => {
      const el = d.querySelector('#f-cf'), num_ = v(d, '#f-num');
      if (d.querySelector('#f-tipo-doc').value !== 'Factura' || !num_ || !cf) { el.textContent = ''; return; }
      const reg = cf.get(num_);
      const ya = notas.filter(x => x.docNum === num_ && x.id !== (n && n.id) && x.estado !== 'ANULADA');
      el.innerHTML = (reg ? `✓ En Control de Despachos: ${esc(reg.fecha)}${reg.bodega ? ' · ' + esc(reg.bodega) : ''}${reg.nc ? ' · N/C ' + esc(reg.nc) + ' marcada' : ''}` : 'No aparece en Control de Despachos')
        + (ya.length ? ` · <b class="nc-late">Ya tiene ${ya.length} NC (${ya.map(x => EST[x.estado][0]).join(', ')})</b>` : '');
      if (reg && !n) {
        if (!d.querySelector('#f-fdoc').value) d.querySelector('#f-fdoc').value = dmyIso(reg.fecha);
        if (!d.querySelector('#f-bod').value) d.querySelector('#f-bod').value = bodegaDeCF(reg.bodega);
        if (!d.querySelector('#f-tipo').value && reg.nc) { d.querySelector('#f-tipo').value = /parcial/i.test(reg.nc) ? 'Parcial' : 'Completa'; sync(); }
      }
    };
    d.querySelector('#f-num').addEventListener('input', buscar);
    d.querySelector('#f-tipo-doc').addEventListener('change', buscar);
    buscar();
    if (!n) d.querySelector('#f-num').focus();
  }

  // ============ SOLICITUD PRESENCIAL (comercial pide en persona, sin pasar por el grupo) ============
  function abrirPresencial() {
    const d = abrirDlg('Solicitud presencial de NC', `
      <p class="nc-p" style="margin-top:0">Para las NC que comercial pide en persona (por ejemplo en SF 918) y no pasan por el grupo de Telegram.</p>
      <div class="nc-grid nc-grid2">
        <label>Documento<select class="nc-in" id="p-doc"><option>Factura</option><option>Boleta</option></select></label>
        <label>N° documento<input class="nc-in" id="p-num" inputmode="numeric" autocomplete="off"></label>
        <label>Tipo de NC<select class="nc-in" id="p-tipo"><option>Completa</option><option>Parcial</option></select></label>
        <label id="p-mnc-w" style="visibility:hidden">Monto NC ($)<input class="nc-in" id="p-mnc" inputmode="numeric"></label>
        <label>Motivo<select class="nc-in" id="p-mot"><option value="">—</option>${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label>Bodega<select class="nc-in" id="p-bod">${BODEGAS.map(b => `<option${b === 'SF 918' ? ' selected' : ''}>${b}</option>`).join('')}</select></label>
        <label>Solicitado por (comercial)<input class="nc-in" id="p-sol" list="nc-nombres"></label>
        <label>Recibió la solicitud<input class="nc-in" id="p-quien" list="nc-nombres" value="${esc(quien())}"></label>
        <label class="nc-check nc-span2"><input type="checkbox" id="p-dev"> Requiere devolución o retiro de material</label>
        <label class="nc-span2">Observación<input class="nc-in" id="p-obs"></label>
      </div>
      <p class="nc-cfhint" id="p-cf"></p>
      ${fileUI('p-arch', '📷 Foto de la factura o de la solicitud (opcional)')}`, 'Registrar solicitud', async dd => {
      const q = v(dd, '#p-quien'); if (!q) throw new Error('Indica quién recibe la solicitud');
      setQuien(q);
      const num_ = v(dd, '#p-num').replace(/\D/g, ''); if (!num_) throw new Error('Falta el N° de documento');
      const x = { docTipo: v(dd, '#p-doc'), docNum: num_, tipo: v(dd, '#p-tipo'), motivo: v(dd, '#p-mot'), bodega: v(dd, '#p-bod'),
        montoNc: v(dd, '#p-tipo') === 'Parcial' ? (num(v(dd, '#p-mnc')) ?? '') : '', solicitadoPor: v(dd, '#p-sol') || q,
        fechaSolicitud: hoyLocal(), requiereDev: dd.querySelector('#p-dev').checked ? 'SI' : '', obs: v(dd, '#p-obs'), origen: 'Presencial' };
      const reg = cf && x.docTipo === 'Factura' ? cf.get(num_) : null;
      if (reg) { x.fechaDoc = dmyIso(reg.fecha); }
      const fi = dd.querySelector('#p-arch');
      const archivo = fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
      let r;
      try { r = await post({ action: 'nc_guardar', n: x, archivo, quien: q }); }
      catch (e2) { if (!/Ya existe una NC activa/.test(e2.message) || !confirm(e2.message)) throw e2; r = await post({ action: 'nc_guardar', n: x, archivo, quien: q, forzar: true }); }
      st.sel = r.id; st.filtro = 'emitir'; st.tab = 'bandeja';
      toast('Solicitud presencial registrada');
      await cargar();
    });
    const sync = () => { d.querySelector('#p-mnc-w').style.visibility = d.querySelector('#p-tipo').value === 'Parcial' ? 'visible' : 'hidden'; };
    d.querySelector('#p-tipo').addEventListener('change', sync);
    d.querySelector('#p-num').addEventListener('input', () => {
      const n_ = v(d, '#p-num'), el = d.querySelector('#p-cf');
      const ya = notas.filter(x => x.docNum === n_ && x.estado !== 'ANULADA');
      const reg = cf && n_ ? cf.get(n_) : null;
      el.innerHTML = (reg ? `✓ En Control de Despachos: ${esc(reg.fecha)}${reg.bodega ? ' · ' + esc(reg.bodega) : ''}` : '') + (ya.length ? ` <b class="nc-late">Ya tiene NC (${ya.map(x => EST[x.estado][0]).join(', ')})</b>` : '');
    });
    d.querySelector('#p-num').focus();
  }

  // ============ PASOS: BODEGA / EMITIR ============
  function abrirPaso(n, paso) {
    if (paso === 'bodega') {
      abrirDlg(`Registrar en bodega · ${docLbl(n)}`, `
        <div class="nc-grid nc-grid2">
          <label>Fecha<input class="nc-in" id="b-fecha" type="date" value="${hoyLocal()}"></label>
          <label>Registrado por<input class="nc-in" id="b-quien" list="nc-nombres" value="${esc(quien())}"></label>
          <label class="nc-span2">Nota (opcional)<input class="nc-in" id="b-nota" placeholder="Ej: material devuelto completo a SF 918"></label>
        </div>
        ${fileUI('b-arch', '📷 Foto de la factura / devolución')}`, 'Registrar', async d => {
        const q = v(d, '#b-quien'); if (!q) throw new Error('Indica quién registra');
        const fi = d.querySelector('#b-arch');
        const archivo = fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
        await post({ action: 'nc_bodega', id: n.id, fecha: v(d, '#b-fecha'), nota: v(d, '#b-nota'), archivo, quien: q });
        toast('Registrada en bodega'); await cargar();
      });
    } else {
      abrirDlg(`Emitir NC · ${docLbl(n)}`, `
        <div class="nc-grid nc-grid2">
          <label>Folio de la NC<input class="nc-in" id="e-folio" inputmode="numeric" autocomplete="off"></label>
          <label>Fecha de emisión<input class="nc-in" id="e-fecha" type="date" value="${hoyLocal()}"></label>
          <label>Emitida por<input class="nc-in" id="e-quien" list="nc-nombres" value="${esc(quien())}"></label>
          ${n.tipo === 'Parcial' ? `<label>Monto NC ($)<input class="nc-in" id="e-monto" inputmode="numeric" value="${esc(n.montoNc)}"></label>` : '<span></span>'}
          <label class="nc-span2">Factura sustituta (si se reemplazó)<input class="nc-in" id="e-sust" inputmode="numeric" value="${esc(n.facturaSustituta)}"></label>
        </div>
        ${fileUI('e-arch', '🧾 PDF timbrado de la NC')}`, 'Marcar emitida', async d => {
        const q = v(d, '#e-quien'); if (!q) throw new Error('Indica quién emite');
        const fi = d.querySelector('#e-arch');
        const archivo = fi.files[0] ? await prepararArchivo(fi.files[0]) : null;
        const m = d.querySelector('#e-monto');
        await post({ action: 'nc_emitir', id: n.id, folio: v(d, '#e-folio'), fecha: v(d, '#e-fecha'), montoNc: m ? (num(m.value) ?? '') : '', facturaSustituta: v(d, '#e-sust'), archivo, quien: q });
        toast('NC emitida'); await cargar();
      });
    }
  }

  // ============ DATOS LEÍDOS DE LA FACTURA (Gemini) ============
  function datosLeidos(n) {
    const d = lec(n.lecturaDoc), c = lec(n.lecturaNc);
    if (!urlDoc(n) && !n.ncUrl) return '';
    const pend = lecturaPendiente(n);
    const btn = `<button class="nc-b nc-sm" data-leer="${pend ? '' : 'forzar'}">${pend ? '🔎 Leer ahora' : '↻ Volver a leer'}</button>`;
    if (!d && !c) return `<div class="nc-card"><div class="nc-h3row"><h3 class="nc-h3">Datos de la factura</h3>${btn}</div>
      <p class="nc-dim" style="margin:0">En cola: el lector revisa cada 10 minutos las fotos y PDF nuevos.</p></div>`;
    const m = v => v === null || v === undefined || v === '' || Number(v) === 0 ? '' : plata(v);
    const dato = (l, v) => v ? `<div><span>${l}</span><b>${esc(v)}</b></div>` : '';
    let html = '';
    if (d && d.error) html += `<p class="nc-err" style="margin:0 0 8px">No se pudo leer la factura: ${esc(d.error)}</p>`;
    else if (d) {
      const nc = d.nc || {};
      const otroN = d.numero && String(d.numero).replace(/\D/g, '') !== String(n.docNum);
      html += `${otroN ? `<div class="nc-note anu" style="margin:0 0 10px">⚠ El documento dice N° <b>${esc(d.numero)}</b> y la NC está como ${esc(n.docNum)}. Revisa cuál es el correcto.</div>` : ''}
        <div class="nc-facts">${dato('Cliente', d.cliente)}${dato('RUT', d.rut)}${dato('Vendedor', d.vendedor)}${dato('Bodega', d.bodega)}${dato('Fecha', d.fecha && fCorta(d.fecha))}${dato('Entrega', d.tipoEntrega)}${dato('Orden de compra', d.ordenCompra)}${dato('Digitado por', d.digitador)}</div>
        ${(d.productos || []).length ? `<div class="nc-tw nc-mt"><table class="nc-t"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cant.</th><th>Un.</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
          <tbody>${d.productos.map(p => `<tr><td><b>${esc(p.codigo || '—')}</b></td><td>${esc(p.descripcion)}</td><td class="num">${nf(p.cantidad)}</td><td>${esc(p.unidad || '')}</td><td class="num">${m(p.precioUnitario)}</td><td class="num">${m(p.total)}</td></tr>`).join('')}</tbody>
          <tfoot>${[['Neto', d.neto], ['IVA', d.iva], ['Total', d.total]].filter(x => Number(x[1]) > 0).map(([l, v]) => `<tr><td colspan="5" class="num">${l}</td><td class="num"><b>${plata(v)}</b></td></tr>`).join('')}</tfoot></table></div>` : ''}
        ${nc.marcada || nc.motivoManuscrito ? `<div class="nc-note nc-mt">🖊 Timbre NC: <b>${esc(nc.marcada ? (/parcial/i.test(nc.marcada) ? 'Parcial' : 'Completa') : '—')}</b>${nc.motivoManuscrito ? ` · motivo escrito: <i>"${esc(nc.motivoManuscrito)}"</i>` : ''}${nc.revisadoPor ? ` · revisó ${esc(nc.revisadoPor)}` : ''}</div>` : ''}`;
    }
    if (c && !c.error) {
      const ncd = c.nc || {};
      html += `<div class="nc-note nc-mt">🧾 NC timbrada: folio <b>${esc(ncd.folioNc || (c.tipo === 'nota_credito' ? c.numero : '') || '—')}</b>${(ncd.montoNc || c.total) ? ` · ${plata(ncd.montoNc || c.total)}` : ''}${ncd.documentoReferencia ? ` · referencia F ${esc(ncd.documentoReferencia)}` : ''}</div>`;
    } else if (c && c.error) html += `<p class="nc-err">No se pudo leer la NC timbrada: ${esc(c.error)}</p>`;
    const ref = d && !d.error ? d : c;
    return `<div class="nc-card"><div class="nc-h3row"><h3 class="nc-h3">Datos de la factura <span class="nc-dim">· leído automáticamente${ref && ref.confianza ? ', confianza ' + esc(ref.confianza) : ''}</span></h3>${btn}</div>${html}
      <p class="nc-hint">Los datos leídos completan los campos vacíos de la NC; lo que ya estaba escrito no se pisa.</p></div>`;
  }

  // ============ DASHBOARD ============
  let ncCharts = [], chartProm = null, dashTok = 0;
  const cargarChart = () => window.Chart ? Promise.resolve() : (chartProm = chartProm || new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = res; s.onerror = () => { chartProm = null; rej(new Error('No se pudo cargar la librería de gráficos')); }; document.head.appendChild(s);
  }));
  const PAL = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#0891b2', '#dc2626', '#ca8a04', '#db2777', '#4f46e5', '#0d9488', '#65a30d', '#94a3b8'];
  const COL_BOD = { Aldunate: '#2563eb', 'SF 918': '#ea580c', Viel: '#16a34a', 'San Ignacio': '#9333ea', 'Stgo Concha': '#0891b2' };
  const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const corto = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const millones = v => '$' + (v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M';

  function dibujarResumen() {
    const el = root && root.querySelector('#nc-resumen'); if (!el) return;
    ncCharts.forEach(c => c.destroy()); ncCharts = [];
    const hoyS = hoy || hoyLocal();
    const mes = hoyS.slice(0, 7);
    const [y, m] = mes.split('-').map(Number);
    const mesAnt = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const hace3 = (() => { const d = new Date(y, m - 3, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const PER = [['mes', 'Este mes'], ['ant', 'Mes anterior'], ['3m', 'Últimos 3 meses'], ['anio', 'Este año'], ['todo', 'Todo']];
    const enFecha = f => { f = String(f || ''); const p = st.periodo;
      return p === 'todo' || (p === 'mes' ? f.startsWith(mes) : p === 'ant' ? f.startsWith(mesAnt) : p === '3m' ? f.slice(0, 7) >= hace3 : f.startsWith(String(y))); };
    const vivas = notas.filter(n => n.estado !== 'ANULADA');
    const base = vivas.filter(n => enFecha(n.fechaSolicitud));
    const monto = n => Number(n.montoNc || (n.tipo === 'Completa' ? n.montoDoc : 0)) || 0;
    const total$ = base.reduce((s, n) => s + monto(n), 0);
    const emitidas = base.filter(n => n.estado === 'EMITIDA' && !sinSoftland(n));
    const dEmi = emitidas.map(n => n.fechaEmision && n.fechaSolicitud ? dia(n.fechaEmision) - dia(n.fechaSolicitud) : null).filter(d => d !== null && d >= 0);
    const prom = dEmi.length ? dEmi.reduce((a, b) => a + b, 0) / dEmi.length : null;
    const pend = vivas.filter(pendiente);
    const pendViejas = pend.filter(n => (diasDesde(n.fechaSolicitud) || 0) > DIAS_ANALIZAR);
    const completas = base.filter(n => n.tipo === 'Completa').length;
    const devs = []; vivas.forEach(n => devsDe(n).forEach(v => { if (enFecha(v.fecha)) devs.push(v); }));
    const dev$ = devs.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const agrupa = (lista, fn, val = monto) => { const g = new Map(); lista.forEach(n => { const k = fn(n) || 'Sin dato'; const x = g.get(k) || { n: 0, $: 0 }; x.n++; x.$ += val(n); g.set(k, x); }); return [...g.entries()].map(([k, x]) => ({ k, ...x })); };
    const D = { base, monto, agrupa, devs, pend, dEmi, mes, y, m };
    const kpi = (t, v, s, c = '') => `<div class="nc-kpi ${c}"><span>${t}</span><strong>${v}</strong><small>${s}</small></div>`;
    const card = (id, t, sub = '', alto = '') => `<div class="nc-card"><h3 class="nc-h3">${t}${sub ? ` <span class="nc-dim">${sub}</span>` : ''}</h3><div class="nc-chart${alto}"><canvas id="${id}"></canvas></div></div>`;
    const fichas = new Set(notas.map(n => String(n.docNum)));
    const sinFicha = cf ? [...cf.values()].filter(r => r.nc && !fichas.has(String(r.numero).trim())) : [];
    el.innerHTML = `
      <div class="nc-per">${PER.map(([k, l]) => `<button class="nc-chip${st.periodo === k ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}
        <span class="nc-dim">Período según fecha de solicitud · sin anuladas</span></div>
      <div class="nc-kpis">
        ${kpi('NC en el período', nf(base.length), `${plata(total$)}`)}
        ${kpi('Completas / Parciales', base.length ? Math.round(completas / base.length * 100) + '%' : '—', `${completas} completas · ${base.filter(n => n.tipo === 'Parcial').length} parciales`)}
        ${kpi('Días a emisión', prom === null ? '—' : prom.toLocaleString('es-CL', { maximumFractionDigits: 1 }), `promedio · ${dEmi.length ? dEmi.filter(d => d <= 1).length + ' en ≤1 día' : 'sin datos'}`, 'verde')}
        ${kpi('Pendientes hoy', nf(pend.length), `${pendViejas.length} con más de ${DIAS_ANALIZAR} días · ${pend.filter(sinSoftland).length} sin NC en Softland`, pend.length ? 'nar' : '')}
        ${kpi('Mercadería devuelta', plata(dev$), `${devs.length} guías de entrada en Softland`)}
      </div>
      <div class="nc-res">
        <div class="nc-card nc-wide"><h3 class="nc-h3">Evolución mensual <span class="nc-dim">últimos 12 meses · cantidad y monto</span></h3><div class="nc-chart"><canvas id="ncc-mes"></canvas></div></div>
        ${card('ncc-motivo', 'Por motivo', 'cantidad', ' alto')}
        ${card('ncc-motivo-m', 'Por motivo', 'monto NC', ' alto')}
        ${card('ncc-bodmot', 'Bodega × motivo', 'top 6 motivos')}
        ${card('ncc-tipo', 'Completa / Parcial')}
        ${card('ncc-tiempo', 'Tiempo de emisión', 'días desde la solicitud')}
        ${card('ncc-aging', 'Pendientes por antigüedad', 'por bodega, hoy')}
        ${card('ncc-vend', 'Por vendedor', 'de la factura en Softland', ' alto')}
        ${card('ncc-cli', 'Clientes con más monto en NC', 'top 10', ' alto')}
        ${card('ncc-prod', 'Productos más devueltos', 'monto en guías de entrada', ' alto')}
        ${card('ncc-devbod', 'Devoluciones por bodega', 'monto en guías de entrada')}
        ${card('ncc-sol', 'Quién solicita', 'top 10', ' alto')}
        ${card('ncc-origen', 'Origen de la solicitud')}
        ${card('ncc-dia', 'Solicitudes por día de la semana')}
      </div>
      <div class="nc-card nc-mt"><h3 class="nc-h3">En Control de Despachos con N/C marcada, sin ficha aquí <span class="nc-dim">(${cf ? sinFicha.length : '…'})</span></h3>
        ${!cf ? `<p class="nc-dim">${cfEstado === 'error' ? 'No se pudo consultar Control de Despachos' : 'Cargando…'}</p>` : sinFicha.length
          ? `<div class="nc-tw"><table class="nc-t"><thead><tr><th>Factura</th><th>Fecha</th><th>Bodega</th><th>N/C</th><th>Motivo</th><th></th></tr></thead><tbody>${sinFicha.slice(0, 60).map(r => `<tr><td><b>${esc(r.numero)}</b></td><td>${esc(r.fecha)}</td><td>${esc(r.bodega || 'Aldunate')}</td><td>${esc(r.nc)}</td><td>${esc(r.motivoNc || '—')}</td><td><button class="nc-b nc-sm" data-crear="${esc(r.numero)}">Crear ficha</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="nc-dim">Todo cuadra ✓</p>'}
      </div>`;
    const tok = ++dashTok;
    cargarChart().then(() => { if (tok === dashTok && document.body.contains(el) && !el.hidden) graficosNc(D); })
      .catch(err => el.insertAdjacentHTML('afterbegin', `<p class="nc-err">${esc(err.message)}</p>`));
  }

  function graficosNc(D) {
    const { base, monto, agrupa, devs, pend, dEmi, y, m } = D;
    const mk = (id, cfg) => { const c = root.querySelector('#' + id); if (c) ncCharts.push(new Chart(c, cfg)); };
    const opt = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...extra });
    const leyenda = { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } };
    const tip$ = { tooltip: { callbacks: { label: c => ' ' + plata(c.raw) } } };
    const eje$ = { ticks: { callback: v => millones(v) } };
    const vacio = id => { const c = root.querySelector('#' + id); if (c) c.parentElement.innerHTML = '<p class="nc-empty">Sin datos en el período</p>'; };
    const hbar = (id, arr, campo, color, fmt$) => {
      if (!arr.length) return vacio(id);
      mk(id, { type: 'bar', data: { labels: arr.map(a => corto(a.k, 28)), datasets: [{ data: arr.map(a => a[campo]), backgroundColor: Array.isArray(color) ? color : color, borderRadius: 4 }] },
        options: opt({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => arr[it[0].dataIndex].k, label: c => ' ' + (fmt$ ? plata(c.raw) : c.raw + ' NC · ' + plata(arr[c.dataIndex].$)) } } }, scales: { x: fmt$ ? eje$ : { beginAtZero: true, ticks: { precision: 0 } } } }) });
    };
    const dona = (id, arr, colores) => {
      if (!arr.length) return vacio(id);
      const tot = arr.reduce((s, a) => s + a.n, 0);
      mk(id, { type: 'doughnut', data: { labels: arr.map(a => `${a.k} (${Math.round(a.n / tot * 100)}%)`), datasets: [{ data: arr.map(a => a.n), backgroundColor: colores || PAL, borderWidth: 1 }] }, options: opt({ cutout: '58%', plugins: { ...leyenda } }) });
    };

    // 1. Evolución 12 meses (independiente del período)
    const meses = []; for (let i = 11; i >= 0; i--) { const d = new Date(y, m - 1 - i, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const vivas = notas.filter(n => n.estado !== 'ANULADA');
    const porMes = meses.map(k => vivas.filter(n => String(n.fechaSolicitud).startsWith(k)));
    mk('ncc-mes', { data: { labels: meses.map(k => MES_C[+k.slice(5) - 1] + ' ' + k.slice(2, 4)), datasets: [
      { type: 'bar', label: 'Cantidad', data: porMes.map(l => l.length), backgroundColor: '#93c5fd', borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Monto NC', data: porMes.map(l => l.reduce((s, n) => s + monto(n), 0)), borderColor: '#ea580c', backgroundColor: '#ea580c', tension: .3, yAxisID: 'y1', order: 1 }] },
      options: opt({ plugins: { ...leyenda, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + (c.dataset.yAxisID === 'y1' ? plata(c.raw) : c.raw) } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'NC' } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ...eje$ } } }) });

    // 2-3. Motivo
    const mot = agrupa(base, n => n.motivo);
    const motN = [...mot].sort((a, b) => b.n - a.n).slice(0, 12);
    const motCol = new Map(motN.map((a, i) => [a.k, a.k === 'Sin dato' ? '#cbd5e1' : PAL[i % PAL.length]]));
    hbar('ncc-motivo', motN, 'n', motN.map(a => motCol.get(a.k)));
    const mot$ = [...mot].filter(a => a.$).sort((a, b) => b.$ - a.$).slice(0, 12);
    hbar('ncc-motivo-m', mot$, '$', mot$.map(a => motCol.get(a.k) || '#94a3b8'), true);

    // 4. Bodega × motivo (apilado)
    const bods = agrupa(base, n => n.bodega).sort((a, b) => b.n - a.n).map(a => a.k);
    const top6 = motN.filter(a => a.k !== 'Sin dato').slice(0, 6).map(a => a.k);
    const grupoM = n => top6.includes(n.motivo) ? n.motivo : 'Otros / sin dato';
    if (!bods.length) vacio('ncc-bodmot'); else
      mk('ncc-bodmot', { type: 'bar', data: { labels: bods, datasets: [...top6, 'Otros / sin dato'].map((k, i) => ({ label: k, data: bods.map(b => base.filter(n => (n.bodega || 'Sin dato') === b && grupoM(n) === k).length), backgroundColor: motCol.get(k) || '#cbd5e1' })) },
        options: opt({ plugins: { ...leyenda }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } }) });

    // 5. Completa / Parcial
    const tipo = agrupa(base, n => n.tipo).sort((a, b) => b.n - a.n);
    dona('ncc-tipo', tipo, tipo.map(a => a.k === 'Completa' ? '#2563eb' : a.k === 'Parcial' ? '#f59e0b' : '#cbd5e1'));

    // 6. Tiempo de emisión
    const tramos = [['Mismo día', d => d === 0], ['1 día', d => d === 1], ['2–3', d => d >= 2 && d <= 3], ['4–5', d => d >= 4 && d <= 5], ['6–10', d => d >= 6 && d <= 10], ['Más de 10', d => d > 10]];
    if (!dEmi.length) vacio('ncc-tiempo'); else
      mk('ncc-tiempo', { type: 'bar', data: { labels: tramos.map(t => t[0]), datasets: [{ data: tramos.map(t => dEmi.filter(t[1]).length), backgroundColor: ['#16a34a', '#22c55e', '#84cc16', '#eab308', '#f97316', '#dc2626'], borderRadius: 4 }] }, options: opt({ scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });

    // 7. Pendientes por antigüedad (hoy, sin período)
    const ag = [['0–2 días', d => d <= 2, '#16a34a'], ['3–5 días', d => d >= 3 && d <= 5, '#eab308'], ['6–10 días', d => d >= 6 && d <= 10, '#f97316'], ['Más de 10', d => d > 10, '#dc2626']];
    const bodP = [...new Set(pend.map(n => n.bodega || 'Sin dato'))];
    if (!pend.length) { const c = root.querySelector('#ncc-aging'); if (c) c.parentElement.innerHTML = '<p class="nc-dim" style="padding:30px 0;text-align:center">Sin pendientes ✓</p>'; } else
      mk('ncc-aging', { type: 'bar', data: { labels: bodP, datasets: ag.map(([l, f, c]) => ({ label: l, data: bodP.map(b => pend.filter(n => (n.bodega || 'Sin dato') === b && f(Math.max(0, diasDesde(n.fechaSolicitud) || 0))).length), backgroundColor: c })) },
        options: opt({ indexAxis: 'y', plugins: { ...leyenda }, scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } } }) });

    // 8. Vendedor (Softland)
    hbar('ncc-vend', agrupa(base, n => n.sfVendedor).filter(a => a.k !== 'Sin dato').sort((a, b) => b.n - a.n).slice(0, 12), 'n', '#4f46e5');
    // 9. Clientes por monto
    hbar('ncc-cli', agrupa(base, n => n.cliente).filter(a => a.k !== 'Sin dato' && a.$).sort((a, b) => b.$ - a.$).slice(0, 10), '$', '#0891b2', true);
    // 10. Productos devueltos (líneas de guías de entrada)
    const pr = new Map(); devs.forEach(v => (v.lineas || []).forEach(l => { const k = l.codigo; const x = pr.get(k) || { k: l.descripcion || k, cod: k, n: 0, $: 0 }; x.n += Number(l.cantidad) || 0; x.$ += Number(l.total) || 0; pr.set(k, x); }));
    hbar('ncc-prod', [...pr.values()].sort((a, b) => b.$ - a.$).slice(0, 10), '$', '#ea580c', true);
    // 11. Devoluciones por bodega
    const db = new Map(); devs.forEach(v => { const k = v.bodega || 'Sin dato'; const x = db.get(k) || { k, n: 0, $: 0 }; x.n++; x.$ += Number(v.total) || 0; db.set(k, x); });
    const dbA = [...db.values()].sort((a, b) => b.$ - a.$);
    hbar('ncc-devbod', dbA, '$', dbA.map((a, i) => PAL[i % PAL.length]), true);
    // 12. Quién solicita
    hbar('ncc-sol', agrupa(base, n => n.solicitadoPor).sort((a, b) => b.n - a.n).slice(0, 10), 'n', '#0d9488');
    // 13. Origen
    dona('ncc-origen', agrupa(base, n => origenDe(n)).sort((a, b) => b.n - a.n));
    // 14. Día de la semana
    const DS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const cnt = [0, 0, 0, 0, 0, 0, 0]; base.forEach(n => { if (!n.fechaSolicitud) return; const d = new Date(String(n.fechaSolicitud).slice(0, 10) + 'T12:00:00').getDay(); cnt[(d + 6) % 7]++; });
    if (!base.length) vacio('ncc-dia'); else
      mk('ncc-dia', { type: 'bar', data: { labels: DS, datasets: [{ data: cnt, backgroundColor: '#6366f1', borderRadius: 4 }] }, options: opt({ scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });
  }

  // ============ TELEGRAM (mensajes que llegaron del bot) ============
  const COMO = { bodega: 'Registrada en bodega', solicitud: 'Solicitud', emitida: 'Emitida (PDF timbrado)', comentario: 'Comentario' };
  function dibujarTelegram() {
    const el = root && root.querySelector('#nc-telegram'); if (!el) return;
    const sinAsig = tgs.filter(t => t.estado === 'SIN_ASIGNAR');
    const lista = st.tgFiltro === 'SIN_ASIGNAR' ? sinAsig : tgs;
    const porId = new Map(notas.map(n => [n.id, n]));
    el.innerHTML = `
      <div class="nc-per">${[['SIN_ASIGNAR', `Sin asignar`, sinAsig.length], ['todos', 'Todos los mensajes', null]].map(([k, l, c]) => `<button class="nc-chip${st.tgFiltro === k ? ' on' : ''}" data-tgf="${k}">${l}${c !== null ? ` <b>${c}</b>` : ''}</button>`).join('')}
        <span class="nc-dim">El bot lee el grupo de NC sin escribir nada. Lo que no logra vincular a un documento queda aquí.</span></div>
      ${!tgs.length ? '<div class="nc-card nc-empty">Aún no llegan mensajes del bot. Revisa que esté en el grupo y que el webhook esté activo.</div>'
        : !lista.length ? '<div class="nc-card nc-empty">Nada pendiente ✓</div>'
        : `<div class="nc-tglist">${lista.map(t => {
          const n = porId.get(t.ncId);
          const ico = t.archivoTipo === 'foto' ? '📷' : t.archivoTipo === 'pdf' ? '📄' : t.archivoTipo ? '📎' : '💬';
          const defComo = t.archivoTipo === 'foto' ? 'bodega' : t.archivoTipo === 'pdf' ? 'solicitud' : 'comentario';
          return `<div class="nc-card nc-tg ${t.estado === 'SIN_ASIGNAR' ? 'pend' : ''}">
            <div class="nc-tg-head"><b>${ico} ${esc(t.autor || '—')}</b><span>${fCorta(t.fecha)} ${esc(horaTg(t.hora))}</span></div>
            ${t.texto ? `<p class="nc-tg-txt">${esc(t.texto)}</p>` : ''}
            <div class="nc-tg-foot">
              ${t.archivo ? `<button class="nc-b nc-sm" data-file="${esc(t.archivo)}" data-titulo="${esc((t.autor || 'Telegram') + ' · ' + fCorta(t.fecha) + ' ' + horaTg(t.hora))}">Ver archivo</button>` : ''}
              ${t.estado === 'ASIGNADO' ? `<button class="nc-b nc-sm" data-ver="${esc(t.ncId)}">${n ? esc(docCorto(n)) : esc((t.docTipo === 'Boleta' ? 'B ' : 'F ') + t.docNum)} →</button><span class="nc-dim">${esc(String(t.accion).replace(/^(\w+)/, x => COMO[x] || x))}</span>` : ''}
              ${t.estado === 'IGNORADO' ? '<span class="nc-dim">Conversación / ignorado</span>' : ''}
              ${t.estado === 'SIN_ASIGNAR' ? `<span class="nc-asig" data-msg="${esc(t.msgId)}">
                <select class="nc-in" data-k="tipo"><option>Factura</option><option>Boleta</option></select>
                <input class="nc-in" data-k="num" inputmode="numeric" placeholder="N°">
                <select class="nc-in" data-k="como">${Object.entries(COMO).map(([k, l]) => `<option value="${k}"${k === defComo ? ' selected' : ''}>${l}</option>`).join('')}</select>
                <button class="nc-b nc-sm nc-pri" data-asignar>Asignar</button><button class="nc-b nc-sm" data-ignorar>Ignorar</button></span>` : ''}
            </div></div>`;
        }).join('')}</div>`}`;
  }
  async function accionTg(e) {
    const f = e.target.closest('[data-tgf]'); if (f) { st.tgFiltro = f.dataset.tgf; dibujarTelegram(); return; }
    const ver = e.target.closest('[data-ver]');
    if (ver) { st.tab = 'bandeja'; st.filtro = 'todas'; st.q = ''; st.sel = ver.dataset.ver; const q = root.querySelector('#nc-q'); if (q) q.value = ''; dibujar(); return; }
    const box = e.target.closest('[data-msg]'); if (!box) return;
    if (e.target.closest('[data-ignorar]')) return ejecutar({ action: 'tg_ignorar', msgId: box.dataset.msg }, 'Mensaje ignorado');
    if (e.target.closest('[data-asignar]')) {
      const g = k => box.querySelector(`[data-k="${k}"]`).value.trim();
      if (!g('num')) { toast('Escribe el N° de documento', true); return; }
      return ejecutar({ action: 'tg_asignar', msgId: box.dataset.msg, docTipo: g('tipo'), docNum: g('num'), como: g('como') }, 'Mensaje asignado');
    }
  }

  // ============ DEVOLUCIONES DE SOFTLAND ============
  const devsDe = n => { try { return JSON.parse(n.devoluciones || '[]'); } catch (e) { return []; } };
  function devolucionesHtml(n) {
    const ds = devsDe(n);
    if (!ds.length) return '';
    return `<div class="nc-card"><h3 class="nc-h3">Devolución registrada en Softland <span class="nc-dim">(${ds.length === 1 ? '1 guía de entrada' : ds.length + ' guías de entrada'})</span></h3>
      ${ds.map(g => `<p class="nc-p" style="margin:6px 0"><b>Guía de entrada N° ${esc(g.folio)}</b> · ${fCorta(g.fecha)} · ${esc(g.bodega)} · ${plata(g.total)}</p>
        <div class="nc-tw"><table class="nc-t"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cant.</th><th>Un.</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
        <tbody>${(g.lineas || []).map(l => `<tr><td><b>${esc(l.codigo)}</b></td><td>${esc(l.descripcion)}</td><td class="num">${nf(l.cantidad) || l.cantidad}</td><td>${esc(l.um)}</td><td class="num">${plata(l.precio)}</td><td class="num">${plata(l.total)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
    </div>`;
  }
  // Carga el "Informe de Guías de Recepción" (Devolución de Cliente) exportado de Softland
  function abrirSoftland() {
    if (typeof XLSX === 'undefined' || typeof SoftlandRecepciones === 'undefined') { toast('No se cargó el lector de Excel', true); return; }
    let docs = [];
    const d = abrirDlg('Informe de devoluciones de Softland', `
      <p class="nc-p">Elige el <b>Informe de Guías de Recepción</b> exportado de Softland con concepto <b>Devolución de Cliente</b> (.xls).
        Cada guía se suma a la NC de su factura o boleta. Si la NC no existe, se crea como <i>Registrada en bodega</i>. Cargar el mismo informe dos veces no duplica nada.</p>
      <input type="file" id="s-xls" accept=".xls,.xlsx" class="nc-in">
      <div id="s-prev" class="nc-p"></div>`, 'Cargar', async dd => {
      if (!docs.length) throw new Error('Elige primero el informe');
      const r = await post({ action: 'nc_softland', docs });
      toast(`Softland: ${r.actualizadas} NC actualizadas · ${r.nuevas} nuevas${r.iguales ? ` · ${r.iguales} ya estaban` : ''}`);
      st.filtro = 'todas'; st.sel = null;
      await cargar();
    });
    d.querySelector('#s-xls').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const prev = d.querySelector('#s-prev');
      try {
        const res = SoftlandRecepciones.parse(XLSX.read(await f.arrayBuffer(), { type: 'array' }), XLSX);
        const otros = res.docs.filter(x => !/devoluci/i.test(x.concepto));
        docs = res.docs.filter(x => /devoluci/i.test(x.concepto));
        if (!docs.length) throw new Error('El informe no trae guías con concepto "Devolución de Cliente"');
        const tipoDe = x => String(x.dcto).replace(/\D/g, '').length >= 6 ? 'Factura' : 'Boleta';
        const tiene = x => notas.some(n => n.docNum === String(x.dcto).replace(/\D/g, '') && n.docTipo === tipoDe(x) && n.estado !== 'ANULADA');
        const ya = docs.filter(x => notas.some(n => devsDe(n).some(g => String(g.folio) === String(x.folio))));
        const conNC = docs.filter(x => tiene(x) && !ya.includes(x));
        const sinNC = docs.filter(x => !tiene(x));
        const porBod = {}; docs.forEach(x => { porBod[x.bodega] = (porBod[x.bodega] || 0) + 1; });
        prev.innerHTML = `Período ${fCorta(res.periodo.desde)} – ${fCorta(res.periodo.hasta)}: <b>${docs.length}</b> devoluciones por <b>${plata(docs.reduce((s, x) => s + x.total, 0))}</b>
          (${Object.entries(porBod).map(([b, c]) => `${esc(b)} ${c}`).join(' · ')}).<br>
          ✓ ${conNC.length} se suman a una NC existente · ➕ ${sinNC.length} crean NC nueva${ya.length ? ` · ${ya.length} ya estaban cargadas` : ''}${otros.length ? `<br><span class="nc-dim">Se ignoran ${otros.length} guías de otro concepto.</span>` : ''}
          ${sinNC.length ? `<details class="nc-mt"><summary>Ver las que crean NC nueva</summary><div class="nc-tw"><table class="nc-t"><thead><tr><th>Doc.</th><th>Cliente</th><th>Bodega</th><th>Fecha</th><th class="num">Total</th></tr></thead><tbody>${sinNC.map(x => `<tr><td>${tipoDe(x) === 'Boleta' ? 'B' : 'F'} ${esc(x.dcto)}</td><td>${esc(x.origen)}</td><td>${esc(x.bodega)}</td><td>${fCorta(x.fecha)}</td><td class="num">${plata(x.total)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
      } catch (err) { docs = []; prev.innerHTML = `<span class="nc-err">${esc(err.message)}</span>`; }
    });
  }

  // ============ IMPORTAR HISTORIAL DE TELEGRAM ============
  // Lee la hoja "Resumen por factura" del Excel exportado del grupo y, si se eligen, sube las fotos (F_<n°>_msg<id>.jpg)
  function abrirImport() {
    if (typeof XLSX === 'undefined') { toast('No se cargó la librería de Excel', true); return; }
    let filas = [];
    const d = abrirDlg('Importar historial de Telegram', `
      <p class="nc-p">1. Elige el Excel <b>Notas_de_Credito_Telegram.xlsx</b> (hoja "Resumen por factura").</p>
      <input type="file" id="i-xls" accept=".xlsx,.xls" class="nc-in">
      <p class="nc-p">2. (Opcional) Elige todas las fotos de la carpeta <b>fotos</b>: se adjuntan solas a su NC según el nombre del archivo.</p>
      <input type="file" id="i-fotos" accept="image/*" multiple class="nc-in">
      <label class="nc-check nc-mt"><input type="checkbox" id="i-emit"> Las "Registradas en bodega" ya fueron emitidas (marcarlas como Emitidas)</label>
      <div id="i-prev" class="nc-p"></div>`, 'Importar', async dd => {
      if (!filas.length) throw new Error('Elige primero el Excel');
      const btn = dd.querySelector('[data-ok]');
      const emit = dd.querySelector('#i-emit').checked;
      const yo = pedirQuien();
      const lote = filas.map(f => {
        const x = { ...f.n };
        if (f.estado === 'bodega' && emit) { x.fechaEmision = x.fechaBodega; x.emitidoPor = 'Histórico (Telegram)'; }
        return x;
      });
      btn.textContent = 'Guardando fichas…';
      const r = await post({ action: 'nc_importar', notas: lote, quien: yo });
      const fotos = [...dd.querySelector('#i-fotos').files];
      const porNombre = new Map(fotos.map(f => [f.name, f]));
      const subir = filas.map((f, i) => ({ id: r.ids[i], foto: f.fotos.map(x => porNombre.get(x)).find(Boolean) })).filter(x => x.foto);
      let ok = 0; const fallos = [];
      for (let k = 0; k < subir.length; k++) {
        btn.textContent = `Subiendo foto ${k + 1} de ${subir.length}…`;
        try { await post({ action: 'nc_archivo', id: subir[k].id, campo: 'fotoUrl', archivo: await prepararArchivo(subir[k].foto), mantener: true }); ok++; }
        catch (e2) { fallos.push(subir[k].foto.name); }
      }
      toast(`${r.nuevos} NC importadas${subir.length ? ` · ${ok} fotos` : ''}${fallos.length ? ` · ${fallos.length} fotos fallaron` : ''}`, fallos.length > 0);
      st.filtro = 'todas'; st.sel = null;
      await cargar();
    });
    d.querySelector('#i-xls').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const prev = d.querySelector('#i-prev');
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets['Resumen por factura'];
        if (!ws) throw new Error('El Excel no tiene la hoja "Resumen por factura"');
        filas = XLSX.utils.sheet_to_json(ws, { defval: '' }).filter(r => r['N°']).map(convertirFila);
        const c = k => filas.filter(x => x.estado === k).length;
        prev.innerHTML = `Leí <b>${filas.length}</b> documentos: ${c('emitida')} timbradas, ${c('bodega')} registradas en bodega, ${c('pendiente')} esperando retiro, ${c('anulada')} anuladas, ${c('solicitada')} solo solicitadas. ${filas.reduce((s, x) => s + x.fotos.length, 0)} fotos referenciadas. Si ya importaste antes, los repetidos no se duplican.`;
      } catch (err) { prev.innerHTML = `<span class="nc-err">${esc(err.message)}</span>`; filas = []; }
    });
  }
  function convertirFila(r) {
    const estadoTxt = String(r['Estado'] || '');
    const fsol = dmyIso(r['Fecha 1er msg']);
    const doc = String(r['Documento'] || '');
    const n = {
      docTipo: /^boleta/i.test(doc) ? 'Boleta' : 'Factura', docNum: String(r['N°']).trim(), cliente: r['Cliente'] || '', bodega: r['Bodega'] || '',
      tipo: r['Tipo NC'] || '', motivo: r['Motivo'] || '', montoDoc: r['Total doc ($)'] === '' ? '' : String(r['Total doc ($)']),
      fechaDoc: dmyIso(r['Fecha doc']), fechaSolicitud: fsol, solicitadoPor: String(r['Solicitado por'] || '').replace(/\s*\(reenvío\)/i, ''),
      obs: [r['Observaciones'], r['PDF solicitud'] && 'PDF solicitud: ' + r['PDF solicitud'], r['PDF timbrado (respuesta)'] && 'PDF timbrado: ' + r['PDF timbrado (respuesta)'], 'Mensajes Telegram: ' + r['IDs mensajes']].filter(Boolean).join(' · ')
    };
    const fotos = String(r['Foto(s)'] || '').split(/[,;\s]+/).filter(x => /\.(jpe?g|png)$/i.test(x));
    let estado = 'solicitada';
    if (/timbrada/i.test(estadoTxt)) {
      estado = 'emitida';
      const t = String(r['PDF timbrado (respuesta)'] || '').match(/\((\d{1,2})\/(\d{1,2})/);
      n.fechaEmision = t ? `${fsol.slice(0, 4)}-${t[2].padStart(2, '0')}-${t[1].padStart(2, '0')}` : fsol;
      n.emitidoPor = String(r['Respondido por'] || '').replace(/\s*\(tú\)/, '');
    } else if (/registrada en bodega/i.test(estadoTxt)) {
      estado = 'bodega'; n.fechaBodega = fsol; n.registradoPor = n.solicitadoPor;
    } else if (/anulada/i.test(estadoTxt)) {
      estado = 'anulada'; n.anulacion = r['Observaciones'] || 'Queda sin efecto';
    } else if (/retiro/i.test(estadoTxt)) {
      estado = 'pendiente'; n.requiereDev = 'SI';
    }
    if (fotos.length && !n.fechaBodega && estado !== 'emitida') { n.fechaBodega = fsol; n.registradoPor = n.registradoPor || n.solicitadoPor; }
    const sust = String(r['Observaciones'] || '').match(/sustituta[^\d]*(\d{5,})/i);
    if (sust) n.facturaSustituta = sust[1];
    return { n, estado, fotos };
  }

  function toast(msg, error) {
    document.querySelectorAll('.nc-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = 'nc-toast' + (error ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function injectStyles() {
    if (document.getElementById('nc-styles')) return;
    const s = document.createElement('style');
    s.id = 'nc-styles';
    s.textContent = `
      .nc{color:#1c2733}
      .nc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .nc-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .nc-quien{display:flex;align-items:center;gap:6px;border:1px solid #d4d9e0;border-radius:8px;padding:0 4px 0 10px;background:#fff;font-size:14px}
      .nc-quien input{border:0;outline:none;padding:8px 6px;font:inherit;font-size:13px;width:130px;background:transparent}
      .nc-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
      .nc-b:hover{background:#f5f7fa}.nc-b:disabled{opacity:.6;cursor:wait}
      .nc-pri{background:#1565c0;border-color:#1565c0;color:#fff}.nc-pri:hover{background:#0f529e}
      .nc-del{color:#b91c1c}.nc-sm{padding:5px 10px;font-size:12px}
      .nc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}
      .nc-kpi{background:#fff;border:1px solid #e1e5ea;border-left:4px solid #1565c0;border-radius:10px;padding:12px 14px}
      .nc-kpi.nar{border-left-color:#ea580c}.nc-kpi.verde{border-left-color:#16a34a}
      .nc-kpi span{display:block;font-size:12px;color:#5b6b7a}.nc-kpi strong{display:block;font-size:24px;margin-top:2px}
      .nc-kpi small{display:block;font-size:12px;color:#5b6b7a;margin-top:2px}
      .nc-tabs{display:inline-flex;gap:2px;padding:4px;background:#fff;border:1px solid #e1e5ea;border-radius:10px;margin-bottom:14px}
      .nc-tabs button{border:0;background:none;padding:8px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:600;color:#5b6b7a;cursor:pointer}
      .nc-tabs button.on{background:#1565c0;color:#fff}
      .nc-badge{display:inline-block;min-width:18px;border-radius:999px;background:#ea580c;color:#fff;font-size:11px;padding:0 5px;margin-left:2px}
      .nc-badge:empty{display:none}
      .nc-tglist{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
      .nc-tg{margin:0;padding:14px}.nc-tg.pend{border-left:4px solid #ea580c}
      .nc-tg-head{display:flex;justify-content:space-between;gap:8px;font-size:14px}.nc-tg-head span{color:#5b6b7a;font-size:12px}
      .nc-tg-txt{margin:8px 0 0;font-size:13px;color:#374151;white-space:pre-wrap}
      .nc-tg-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;font-size:12px}
      .nc-asig{display:flex;flex-wrap:wrap;gap:6px;width:100%}
      .nc-asig .nc-in{width:auto;padding:6px 8px;font-size:13px}.nc-asig [data-k=num]{width:100px}
      .nc-wrap{display:grid;grid-template-columns:350px minmax(0,1fr);gap:18px;align-items:start}
      .nc-list{background:#fff;border:1px solid #e1e5ea;border-radius:10px;display:flex;flex-direction:column;max-height:calc(100vh - 300px);min-height:420px;position:sticky;top:12px;overflow:hidden}
      .nc-list-head{padding:12px;border-bottom:1px solid #eef0f3}
      .nc-row2{display:flex;gap:6px}.nc-bodsel{width:auto;flex-shrink:0;max-width:130px}
      .nc-in{width:100%;box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#1c2733}
      .nc-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
      .nc-chips,.nc-per{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
      .nc-per{margin:0 0 12px}
      .nc-chip{border:1px solid #d4d9e0;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;color:#4b5563}
      .nc-chip b{margin-left:2px}.nc-chip.on{background:#1c2733;border-color:#1c2733;color:#fff}
      .nc-items{overflow:auto;flex:1;min-height:0}
      .nc-item{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #f0f1f4;border-left:3px solid transparent;padding:10px 14px;cursor:pointer;font:inherit;color:inherit}
      .nc-item:hover{background:#f8fafc}.nc-item.cur{background:#eef4fd;border-left-color:#1565c0}
      .nc-it-top{display:flex;align-items:center;gap:6px}.nc-it-top b{font-size:15px}
      .nc-it-r{margin-left:auto;font-size:13px;font-weight:600;color:#5b6b7a}
      .nc-item small{display:block;color:#5b6b7a;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nc-tipo{font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6b7a;background:#f3f4f6;border-radius:4px;padding:1px 5px}
      .nc-late{color:#c2410c;font-weight:700}
      .nc-item.nc-analizar{background:#fef9c3;border-left-color:#eab308}
      .nc-item.nc-analizar:hover{background:#fef08a}
      .nc-item.nc-analizar.cur{background:#fde68a;border-left-color:#ca8a04}
      .nc-tag-an{margin-left:6px;padding:1px 7px;border-radius:9px;background:#facc15;color:#713f12;font-size:11px;font-weight:700}
      .nc-note.nc-an{background:#fef9c3;border:1px solid #fde047;color:#713f12}
      .nc-note.nc-sf{background:#f0f9ff;border:1px solid #bae6fd;color:#0c4a6e}
      .nc-note.nc-sf small{color:#475569}
      .nc-tipo.nc-pres{background:#e0f2fe;color:#075985}
      .nc-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0;background:#cbd5e1}
      .nc-dot.sol{background:#2563eb}.nc-dot.dev{background:#ea580c}.nc-dot.bod{background:#9333ea}.nc-dot.emi{background:#16a34a}.nc-dot.anu{background:#9ca3af}
      .nc-est{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;vertical-align:middle}
      .nc-est.sol{background:#dbeafe;color:#1e40af}.nc-est.dev{background:#ffedd5;color:#9a3412}.nc-est.bod{background:#f3e8ff;color:#6b21a8}.nc-est.emi{background:#dcfce7;color:#166534}.nc-est.anu{background:#f3f4f6;color:#6b7280}
      .nc-detail{min-width:0}
      .nc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
      .nc-back{display:none}
      .nc-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:18px;margin-bottom:14px}
      .nc-hl{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .nc-hl h2{margin:0;font-size:20px}.nc-hl p{margin:4px 0 0;color:#5b6b7a}
      .nc-big{text-align:right}.nc-big strong{display:block;font-size:22px}.nc-big span{font-size:12px;color:#5b6b7a}
      .nc-steps{display:flex;list-style:none;margin:16px 0;padding:0;counter-reset:p}
      .nc-steps li{flex:1;position:relative;padding:22px 6px 0;text-align:center;font-size:13px;color:#9ca3af}
      .nc-steps li::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #cbd5e1;z-index:1}
      .nc-steps li::after{content:"";position:absolute;top:7px;left:-50%;width:100%;height:2px;background:#e1e5ea}
      .nc-steps li:first-child::after{display:none}
      .nc-steps li.ok{color:#1c2733}.nc-steps li.ok::before{background:#16a34a;border-color:#16a34a}.nc-steps li.ok::after{background:#16a34a}
      .nc-steps li.anu::before{background:#9ca3af;border-color:#9ca3af}
      .nc-steps b{display:block}.nc-steps small{display:block;font-size:11px;color:#5b6b7a;margin-top:2px}
      .nc-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
      .nc-facts>div{background:#f8fafc;border-radius:8px;padding:9px 11px}
      .nc-facts span{display:block;font-size:12px;color:#5b6b7a}.nc-facts b{display:block;font-size:14px;margin-top:2px}
      .nc-cf{margin:12px 0 0;font-size:13px;color:#15803d}
      .nc-note{margin-top:10px;background:#f8fafc;border-radius:8px;padding:9px 12px;font-size:13px;color:#4b5563}
      .nc-note.anu{background:#f3f4f6;color:#374151}
      .nc-h3{font-size:14px;margin:0 0 10px}.nc-mt{margin-top:16px!important}
      .nc-files{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
      .nc-file{border:1.5px dashed #d4d9e0;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;font-size:14px;font-weight:600}
      .nc-file.has{border-style:solid;border-color:#bbf7d0;background:#f0fdf4}
      .nc-file em{font-style:normal;font-weight:400;font-size:12px;color:#9ca3af}
      .nc-file label{cursor:pointer}
      .nc-hist{list-style:none;margin:0;padding:0;font-size:13px}
      .nc-hist li{padding:7px 0;border-bottom:1px solid #f0f1f4}.nc-hist li:last-child{border:0}
      .nc-hist small{display:block;color:#9ca3af;font-size:11px}
      .nc-dim{color:#9ca3af;font-weight:400}
      .nc-empty{color:#8a97a5;padding:20px;text-align:center;margin:0}
      .nc-err{color:#b91c1c;font-size:13px}.nc-list .nc-err{padding:14px;margin:0}
      .nc-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
      .nc-res .nc-card{margin:0}.nc-res .nc-wide{grid-column:1/-1}
      .nc-chart{position:relative;height:260px}.nc-chart.alto{height:320px}
      .nc-file.warn{border-style:solid;border-color:#fde68a;background:#fffbeb}.nc-file.warn em{color:#92400e}
      .nc-dot.nar{background:#f59e0b}
      .nc-note.nc-sug{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}.nc-note.nc-sug button{margin-left:8px;margin-top:4px}
      .nc-barrow{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(60px,1fr) 30px 90px;gap:8px;align-items:center;font-size:13px;padding:4px 0}
      .nc-barrow span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nc-barrow b{text-align:right}.nc-barrow em{font-style:normal;color:#5b6b7a;font-size:12px;text-align:right}
      .nc-bar{height:8px;background:#eef0f3;border-radius:99px;overflow:hidden}.nc-bar i{display:block;height:100%;background:#1565c0;border-radius:99px}
      .nc-tw{overflow-x:auto}
      .nc-t{width:100%;border-collapse:collapse;font-size:13px}
      .nc-t th{text-align:left;background:#f5f7fa;color:#5b6b7a;font-size:11px;text-transform:uppercase;padding:8px 10px}
      .nc-t td{padding:8px 10px;border-top:1px solid #eef0f3}
      .nc-dlg{border:0;border-radius:12px;padding:0;width:min(760px,96vw);max-height:92vh;box-shadow:0 20px 60px rgba(0,0,0,.3);color:#1c2733}
      .nc-dlg::backdrop{background:rgba(17,24,39,.45)}
      .nc-dlg-in{display:flex;flex-direction:column;max-height:92vh}
      .nc-dlg-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eef0f3}
      .nc-dlg-head h2{margin:0;font-size:17px}
      .nc-dlg-body{padding:16px 20px;overflow:auto}
      .nc-dlg-body label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}
      .nc-dlg-foot{display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:12px 20px;border-top:1px solid #eef0f3}
      .nc-dlg-foot .nc-err{margin-right:auto}
      .nc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.nc-grid2{grid-template-columns:1fr 1fr}
      .nc-span2{grid-column:span 2}
      .nc-dlg-body .nc-check{flex-direction:row;align-items:center;gap:8px;font-weight:500}
      .nc-check input{width:16px;height:16px;accent-color:#1565c0}
      .nc-drop{border:1.5px dashed #c7d0db;border-radius:10px;padding:14px;margin-top:14px;background:#fafbfc}
      .nc-drop input{font-weight:400;font-size:13px}.nc-drop small{font-weight:400;color:#8a97a5;font-size:12px}
      .nc-hint{font-size:12px;color:#8a97a5;margin:10px 0 0}
      .nc-cfhint{font-size:12px;color:#15803d;margin:10px 0 0;min-height:1em}
      .nc-p{font-size:13px;color:#4b5563;margin:10px 0 6px}
      .nc-x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:6px 8px}
      .nc-visor{border:0;border-radius:14px;padding:0;width:min(900px,94vw);height:min(88vh,1000px);box-shadow:0 20px 60px rgba(0,0,0,.35);color:#1c2733;overflow:hidden}
      .nc-visor::backdrop{background:rgba(17,24,39,.6)}
      .nc-visor-in{display:flex;flex-direction:column;height:100%}
      .nc-visor-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eef0f3;flex-wrap:wrap}
      .nc-visor-head h2{margin:0;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
      .nc-visor-acts{display:flex;gap:8px;align-items:center}
      .nc-visor-body{flex:1;background:#f3f4f6;padding:10px}
      .nc-visor-body iframe{width:100%;height:100%;border:0;border-radius:8px;background:#fff}
      @media (max-width:560px){.nc-visor{width:100vw;max-width:100vw;height:100%;max-height:100vh;border-radius:0}.nc-visor-head h2{flex-basis:100%}}
      .nc-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2733;color:#fff;padding:11px 18px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.2)}
      .nc-toast.err{background:#b91c1c}
      @media (max-width:900px){
        .nc-wrap{grid-template-columns:1fr}
        .nc-list{position:static;max-height:none}
        .nc-wrap.nc-show .nc-list{display:none}
        .nc-wrap:not(.nc-show) .nc-detail{display:none}
        .nc-back{display:inline-flex}
        .nc-grid{grid-template-columns:1fr 1fr}
      }
      @media (max-width:560px){
        .nc-grid,.nc-grid2{grid-template-columns:1fr}.nc-span2{grid-column:auto}
        .nc-kpis{grid-template-columns:1fr 1fr}.nc-kpi strong{font-size:20px}
        .nc-head .nc-acts{width:100%}.nc-quien{flex:1}.nc-quien input{width:100%}
        .nc-top .nc-acts{width:100%}
        .nc-dlg{width:100vw;max-width:100vw;max-height:100vh;height:100%;border-radius:0}
        .nc-dlg-in{max-height:100vh;height:100%}.nc-dlg-body{flex:1}
        .nc-barrow{grid-template-columns:minmax(0,1fr) 60px 26px 80px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
