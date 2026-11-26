// Renderiza una guía (traslado / cliente / entrada) en HTML con el formato de Softland.
// Sirve en el navegador y en Node. tpl = JSON del template, data = datos de la guía.
(function (root) {
  const FAM = { Calibri: "Calibri, Carlito, sans-serif", Arial: "Arial, 'Liberation Sans', sans-serif" };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Corta el texto en una letra completa para que quepa en e.w (como Softland/Excel), sin montarse sobre lo de al lado
  let ctx = null;
  function ajustar(e, txt) {
    txt = String(txt == null ? '' : txt);
    if (!e.w || typeof document === 'undefined') return txt;
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${e.bold ? 'bold ' : ''}${e.size}pt ${FAM[e.fam]}`;
    const max = e.w * 4 / 3; // pt -> px
    if (ctx.measureText(txt).width <= max) return txt;
    while (txt.length && ctx.measureText(txt).width > max) txt = txt.slice(0, -1);
    return txt.replace(/\s+$/, '');
  }

  function textEl(e, txt, dy) {
    txt = ajustar(e, txt);
    const y = e.y + (dy || 0);
    let st = `top:${y}pt;font:${e.bold ? 'bold ' : ''}${e.size}pt/${e.h}pt ${FAM[e.fam]};color:${e.c};`;
    if (e.align === 'center' || e.align === 'right') st += `left:${e.cx0}pt;width:${e.cx1 - e.cx0}pt;text-align:${e.align};`;
    else st += `left:${e.x}pt;` + (e.w ? `width:${e.w}pt;overflow:hidden;` : '');
    return `<div class="t" style="${st}">${esc(txt)}</div>`;
  }

  function renderGuia(tpl, data) {
    const out = [];
    // filas de detalle: una línea de descripción por fila (respeta saltos de línea)
    const rows = [];
    (data.lineas || []).forEach(l => {
      String(l.desc || '').split(/\r?\n/).forEach((d, i) => rows.push(i === 0 ? Object.assign({}, l, { desc: d }) : { desc: d }));
    });
    for (const e of tpl.els) {
      if (e.t === 'rect') out.push(`<div style="position:absolute;left:${e.x}pt;top:${e.y}pt;width:${e.w}pt;height:${e.h}pt;background:${e.c}"></div>`);
      else if (e.t === 'box') out.push(`<div style="position:absolute;left:${e.x}pt;top:${e.y}pt;width:${e.w}pt;height:${e.h}pt;border:${e.lw}pt solid ${e.c};box-sizing:border-box"></div>`);
      else if (e.t === 'img') {
        const src = e.key ? data[e.key] : e.src;
        if (src) out.push(`<img src="${src}" style="position:absolute;left:${e.x}pt;top:${e.y}pt;width:${e.w}pt;height:${e.h}pt">`);
      } else if (e.t === 'text') {
        if (!e.key) out.push(textEl(e, e.text));
        else if (e.row) rows.slice(0, tpl.maxRows).forEach((r, i) => {
          if (r[e.key] != null && r[e.key] !== '') out.push(textEl(e, r[e.key], i * tpl.pitch));
        });
        else {
          const v = data[e.key];
          if (v != null && v !== '') out.push(textEl(e, e.fmt ? e.fmt.replace('{}', v) : v));
        }
      }
    }
    if (tpl.dots) for (let i = rows.length; i < tpl.maxRows; i++)
      out.push(textEl({ x: tpl.dots.x, y: tpl.dots.y, h: 10, size: 8.9, fam: 'Arial', c: '#000' }, '.', i * tpl.pitch));
    return `<div class="pag" style="position:relative;width:${tpl.w}pt;height:${tpl.h}pt;overflow:hidden;background:#fff">${out.join('')}</div>`;
  }

  const CSS = `@page{size:A4;margin:0}body{margin:0}.pag{page-break-after:always}.t{position:absolute;white-space:pre}`;
  const api = { renderGuia, CSS };
  if (typeof module !== 'undefined') module.exports = api; else root.GuiaSoftland = api;
})(this);
