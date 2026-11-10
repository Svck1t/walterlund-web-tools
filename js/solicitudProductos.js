// =====================================================
// SECCIÓN: SOLICITUD DE PRODUCTOS — v1
// Para las sucursales: elige qué bodega recibe y a cuál se le pide, ve el stock de ambas (en vivo)
// y genera un PDF: el listado para anotar a mano en SOLICITADO, o la solicitud con las cantidades ingresadas.
// Fuente: /api/stock-live (mismo stock en vivo que la sección Stock)
// =====================================================
const SolicitudProductosSection = (() => {
  const STOCK_URL = '/api/stock-live';
  const KEY = 'wl_solicitud';
  let recs = null, bodegas = [], cargando = false, error = '', root = null, actualizado = null;
  const st = { destino: '', origen: '', q: '', soloStock: true, soloPedido: false, nombre: '', obs: '' };
  let pedido = {}; // codigo -> cantidad (borrador guardado en el navegador)

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const ent = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Math.round(Number(v)).toLocaleString('es-CL'); // stock en enteros, como los petitorios
  const txt = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const corto = b => { const u = txt(b); return /FRANCISCO|918/.test(u) ? 'SF 918' : /CONCHA/.test(u) ? 'Stgo Concha' : u.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()); };
  const num = v => { let s = String(v ?? '').trim(); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isNaN(n) || n <= 0 ? null : n; };
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const claveBorrador = () => `${KEY}_${st.origen}_${st.destino}`;
  const stockEn = (r, b) => (r.bodegas && Number(r.bodegas[b])) || 0;

  // ============ CARGA ============
  async function cargar() {
    if (cargando) return;
    cargando = true; error = ''; dibujar();
    try {
      const r = await fetch(STOCK_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('No se pudo obtener el stock (HTTP ' + r.status + ')');
      const lista = await ExcelReader.readFile(new File([await r.blob()], 'stock.xls', { type: 'application/vnd.ms-excel' }));
      recs = lista.filter(x => x.codProducto && x.bodegas).sort((a, b) => String(a.producto).localeCompare(String(b.producto), 'es'));
      bodegas = recs.length ? Object.keys(recs[0].bodegas) : [];
      if (!bodegas.includes(st.destino)) st.destino = '';
      if (!bodegas.includes(st.origen)) st.origen = '';
      actualizado = new Date();
    } catch (e) { console.error('Solicitud de productos:', e); error = e.message; }
    cargando = false;
    pedido = ls.get(claveBorrador(), {});
    dibujar();
  }

  // ============ SECCIÓN ============
  function render(container) {
    root = container;
    injectStyles();
    const pref = ls.get(KEY + '_pref', {});
    Object.assign(st, { destino: pref.destino || '', origen: pref.origen || '', nombre: pref.nombre || '' });
    root.innerHTML = `<div class="sp">
      <div class="section-header sp-head">
        <div><h1>Solicitud de productos</h1><p>Pide productos a otra bodega viendo el stock en vivo de ambas, y descarga el PDF.</p></div>
        <button class="sp-b" id="sp-ref">🔄 Actualizar stock</button>
      </div>
      <div class="sp-card sp-ctrl">
        <label>Mi sucursal (recibe)<select class="sp-in" id="sp-dest"></select></label>
        <span class="sp-arrow">⇠</span>
        <label>Pedir a (envía)<select class="sp-in" id="sp-orig"></select></label>
        <label>Solicitado por<input class="sp-in" id="sp-nom" value="${esc(st.nombre)}" placeholder="Tu nombre"></label>
        <label class="sp-wide">Observación (opcional)<input class="sp-in" id="sp-obs" placeholder="Ej: urgente para despacho del jueves"></label>
      </div>
      <div class="sp-bar">
        <input class="sp-in sp-q" id="sp-q" type="search" placeholder="Buscar código o producto">
        <label class="sp-chk"><input type="checkbox" id="sp-solostock" checked> Solo con stock en la bodega que envía</label>
        <label class="sp-chk"><input type="checkbox" id="sp-solopedido"> Solo lo que estoy pidiendo</label>
      </div>
      <div class="sp-acts">
        <button class="sp-b" id="sp-pdf-lista">📄 PDF listado para anotar</button>
        <button class="sp-b sp-pri" id="sp-pdf-sol">📄 PDF de mi solicitud</button>
        <button class="sp-b" id="sp-limpiar">Limpiar cantidades</button>
        <span class="sp-meta" id="sp-meta"></span>
      </div>
      <div class="sp-card sp-pad0"><div class="sp-tw" id="sp-tabla"></div></div>
    </div>`;
    const $ = s => root.querySelector(s);
    $('#sp-ref').addEventListener('click', cargar);
    const guardarPref = () => ls.set(KEY + '_pref', { destino: st.destino, origen: st.origen, nombre: st.nombre });
    $('#sp-dest').addEventListener('change', e => { st.destino = e.target.value; if (st.origen === st.destino) st.origen = ''; guardarPref(); pedido = ls.get(claveBorrador(), {}); dibujar(); });
    $('#sp-orig').addEventListener('change', e => { st.origen = e.target.value; guardarPref(); pedido = ls.get(claveBorrador(), {}); dibujar(); });
    $('#sp-nom').addEventListener('change', e => { st.nombre = e.target.value.trim(); guardarPref(); });
    $('#sp-obs').addEventListener('input', e => { st.obs = e.target.value.trim(); });
    $('#sp-q').addEventListener('input', e => { st.q = e.target.value; dibujarTabla(); });
    $('#sp-solostock').addEventListener('change', e => { st.soloStock = e.target.checked; dibujarTabla(); });
    $('#sp-solopedido').addEventListener('change', e => { st.soloPedido = e.target.checked; dibujarTabla(); });
    $('#sp-limpiar').addEventListener('click', () => { if (!Object.keys(pedido).length || confirm('¿Borrar todas las cantidades ingresadas?')) { pedido = {}; ls.set(claveBorrador(), pedido); dibujar(); } });
    $('#sp-pdf-lista').addEventListener('click', () => pdf(false));
    $('#sp-pdf-sol').addEventListener('click', () => pdf(true));
    $('#sp-tabla').addEventListener('input', e => {
      const i = e.target.closest('input[data-cod]'); if (!i) return;
      const v = num(i.value);
      if (v) pedido[i.dataset.cod] = v; else delete pedido[i.dataset.cod];
      ls.set(claveBorrador(), pedido);
      const r = recs.find(x => x.codProducto === i.dataset.cod);
      i.closest('tr').classList.toggle('sp-sel', !!v);
      i.classList.toggle('sp-over', !!(v && r && v > stockEn(r, st.origen)));
      dibujarMeta();
    });
    dibujar();
    if (!recs) cargar();
  }

  function filas() {
    if (!recs || !st.origen || !st.destino) return [];
    const q = txt(st.q.trim());
    return recs.filter(r => (!st.soloStock || stockEn(r, st.origen) > 0 || pedido[r.codProducto]) && (!st.soloPedido || pedido[r.codProducto]) && (!q || txt(r.codProducto + ' ' + r.producto).includes(q)));
  }

  function dibujar() {
    if (!root || !root.querySelector('.sp')) return;
    const opts = (sel, excluir) => `<option value="">Elegir…</option>` + bodegas.filter(b => b !== excluir).map(b => `<option value="${esc(b)}"${b === sel ? ' selected' : ''}>${esc(corto(b))}</option>`).join('');
    root.querySelector('#sp-dest').innerHTML = opts(st.destino, '');
    root.querySelector('#sp-orig').innerHTML = opts(st.origen, st.destino);
    dibujarTabla();
  }
  function dibujarMeta() {
    const el = root.querySelector('#sp-meta');
    const n = Object.keys(pedido).length;
    el.textContent = cargando ? 'Cargando stock en vivo…' : error ? '' : recs ? `${n} ${n === 1 ? 'producto pedido' : 'productos pedidos'} · stock actualizado ${actualizado ? actualizado.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}` : '';
    root.querySelector('#sp-pdf-sol').textContent = `📄 PDF de mi solicitud${n ? ` (${n})` : ''}`;
  }
  function dibujarTabla() {
    const el = root && root.querySelector('#sp-tabla'); if (!el) return;
    dibujarMeta();
    if (error) { el.innerHTML = `<p class="sp-err">No se pudo cargar el stock: ${esc(error)}</p>`; return; }
    if (!recs) { el.innerHTML = '<p class="sp-empty">Cargando stock en vivo…</p>'; return; }
    if (!st.destino || !st.origen) { el.innerHTML = '<p class="sp-empty">Elige tu sucursal y la bodega a la que le pides productos.</p>'; return; }
    const f = filas();
    const d = corto(st.destino), o = corto(st.origen);
    el.innerHTML = f.length ? `<table class="sp-t"><thead><tr><th>Código</th><th>Producto</th><th class="sp-um">Un.</th><th class="num">Stock ${esc(d)}</th><th class="num">Stock ${esc(o)}</th><th class="num">Solicitar</th></tr></thead>
      <tbody>${f.slice(0, 1500).map(r => { const p = pedido[r.codProducto], so = stockEn(r, st.origen); return `<tr class="${p ? 'sp-sel' : ''}">
        <td><b>${esc(r.codProducto)}</b></td><td>${esc(r.producto)}</td><td class="sp-um">${esc(r.unidadMedida)}</td>
        <td class="num">${ent(stockEn(r, st.destino))}</td><td class="num"><b>${ent(so)}</b></td>
        <td class="num"><input class="sp-in sp-cant${p && p > so ? ' sp-over' : ''}" data-cod="${esc(r.codProducto)}" inputmode="decimal" value="${p ? esc(String(p).replace('.', ',')) : ''}" aria-label="Cantidad de ${esc(r.codProducto)}"></td></tr>`; }).join('')}</tbody></table>
      ${f.length > 1500 ? `<p class="sp-empty">Se muestran 1.500 de ${f.length}. Usa el buscador para encontrar el resto.</p>` : ''}`
      : '<p class="sp-empty">Ningún producto coincide.</p>';
  }

  // ============ PDF (formato de los petitorios: Código · Nombre · U/M · stock recibe · stock envía · SOLICITADO) ============
  function pdf(soloPedido) {
    if (!recs || !st.destino || !st.origen) { alert('Elige primero tu sucursal y la bodega a la que pides.'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('No se cargó la librería de PDF'); return; }
    const lista = soloPedido ? recs.filter(r => pedido[r.codProducto]) : recs.filter(r => stockEn(r, st.origen) > 0 || pedido[r.codProducto]);
    if (!lista.length) { alert(soloPedido ? 'Aún no ingresas cantidades.' : 'La bodega que envía no tiene productos con stock.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const D = st.destino.toUpperCase(), O = st.origen.toUpperCase();
    const hoy = new Date(), f = hoy.toLocaleDateString('es-CL');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(`${soloPedido ? 'Solicitud' : 'Listado'} de productos · ${corto(st.origen)} a ${corto(st.destino)}`, 30, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const info = [`Fecha: ${f} ${hoy.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`, `Recibe: ${D}`, `Envía: ${O}`];
    if (st.nombre) info.push(`Solicitado por: ${st.nombre}`);
    doc.text(info.join('   ·   '), 30, 48);
    let y0 = 56;
    if (st.obs) { doc.text(`Observación: ${st.obs}`, 30, 60); y0 = 68; }
    doc.autoTable({
      startY: y0, margin: { left: 24, right: 24 },
      head: [['Código Producto', 'Nombre Producto', 'U/M', D, O, 'SOLICITADO']],
      body: lista.map(r => [r.codProducto, r.producto, r.unidadMedida, ent(stockEn(r, st.destino)), ent(stockEn(r, st.origen)), pedido[r.codProducto] ? nf(pedido[r.codProducto]) : '']),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 2.5, lineColor: [150, 150, 150], lineWidth: 0.3, textColor: [0, 0, 0], overflow: 'ellipsize' },
      headStyles: { fillColor: [217, 217, 217], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 78 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 34, halign: 'center' }, 3: { cellWidth: 58, halign: 'right' }, 4: { cellWidth: 58, halign: 'right' }, 5: { cellWidth: 62, halign: 'right', fontStyle: 'bold' } },
      didParseCell: c => { if (c.section === 'body' && c.column.index === 5) c.cell.styles.fillColor = c.cell.raw ? [255, 242, 204] : [255, 255, 255]; }
    });
    let y = doc.lastAutoTable.finalY + 14;
    doc.setFontSize(8.5);
    doc.text(`${lista.length} productos${soloPedido ? ' solicitados' : ''} · stock en vivo al ${f}`, 30, y);
    if (soloPedido) {
      if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = 40; }
      y += 40;
      doc.line(60, y, 230, y); doc.line(370, y, 540, y);
      doc.text('Preparado por (' + corto(st.origen) + ')', 90, y + 12); doc.text('Recibido por (' + corto(st.destino) + ')', 400, y + 12);
    }
    doc.save(`${soloPedido ? 'Solicitud' : 'Listado'} ${corto(st.origen)} a ${corto(st.destino)} ${f.replace(/\//g, '-')}.pdf`);
  }

  function injectStyles() {
    if (document.getElementById('sp-styles')) return;
    const s = document.createElement('style');
    s.id = 'sp-styles';
    s.textContent = `
      .sp{color:#1c2733}
      .sp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .sp-card{background:#fff;border:1px solid #e1e5ea;border-radius:10px;padding:16px;margin-bottom:12px}
      .sp-pad0{padding:0;overflow:hidden}
      .sp-ctrl{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
      .sp-ctrl label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;min-width:170px}
      .sp-ctrl .sp-wide{flex:1;min-width:220px}
      .sp-arrow{font-size:22px;color:#8a97a5;padding-bottom:8px}
      .sp-in{box-sizing:border-box;border:1px solid #d4d9e0;border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#1c2733;width:100%}
      .sp-in:focus{outline:none;border-color:#1565c0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
      .sp-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:10px}
      .sp-q{flex:1;min-width:220px;width:auto}
      .sp-chk{display:flex;align-items:center;gap:6px;font-size:13px;color:#4b5563;cursor:pointer}
      .sp-chk input{width:16px;height:16px;accent-color:#1565c0}
      .sp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
      .sp-meta{font-size:12px;color:#8a97a5;margin-left:auto}
      .sp-b{border:1px solid #d4d9e0;background:#fff;color:#1c2733;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
      .sp-b:hover{background:#f5f7fa}
      .sp-pri{background:#1565c0;border-color:#1565c0;color:#fff}.sp-pri:hover{background:#0f529e}
      .sp-tw{overflow:auto;max-height:calc(100vh - 360px);min-height:300px}
      .sp-t{width:100%;border-collapse:collapse;font-size:13px}
      .sp-t th{position:sticky;top:0;z-index:1;text-align:left;background:#f5f7fa;color:#5b6b7a;font-size:11px;text-transform:uppercase;padding:9px 10px;white-space:nowrap;box-shadow:inset 0 -1px 0 #e1e5ea}
      .sp-t td{padding:6px 10px;border-top:1px solid #eef0f3}
      .sp-t .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .sp-t tr.sp-sel td{background:#fff8e1}
      .sp-cant{width:90px;text-align:right;padding:6px 8px}
      .sp-over{border-color:#dc2626;background:#fef2f2}
      .sp-empty{color:#8a97a5;padding:24px;text-align:center;margin:0}
      .sp-err{color:#b91c1c;padding:16px;margin:0}
      @media (max-width:700px){
        .sp-ctrl label{min-width:0;flex:1 1 100%}.sp-arrow{display:none}
        .sp-meta{margin-left:0;flex-basis:100%}
        .sp-um{display:none}
        .sp-tw{max-height:none}
        .sp-cant{width:70px}
      }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();
