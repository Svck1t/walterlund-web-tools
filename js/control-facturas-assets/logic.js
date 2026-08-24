// ⚠️ Reemplaza esta URL por la de tu Apps Script Web App (paso "Implementar")
  const API_URL = "https://script.google.com/macros/s/AKfycbxchbWwNZnnx72MF5d_NZockO1XD56He_Ti-nIb3Hx7HLb_0u-gpqRTh0Vy3c23BrXl/exec";
  const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  let registrosCache = null; // se llena la primera vez que se abre "Buscar" (completo, hasta 200 filas)
  let recientesCache = null; // liviano (8 filas), para el panel de la pestaña "Ingresar"

  // ----- Caché local (localStorage): muestra al instante lo último visto mientras se refresca en segundo plano -----
  function guardarCacheLocal(clave, datos) {
    try {
      localStorage.setItem("cf_" + clave, JSON.stringify({ datos: datos, ts: Date.now() }));
    } catch (e) {
      /* si el navegador bloquea localStorage, simplemente no cacheamos */
    }
  }
  function leerCacheLocal(clave) {
    try {
      const raw = localStorage.getItem("cf_" + clave);
      if (!raw) return null;
      return JSON.parse(raw).datos;
    } catch (e) {
      return null;
    }
  }

  // ----- Tags (Bodega / Proceso / Documento) -----
  const GRIDS_INGRESAR = ["tags-ingresar-bodega", "tags-ingresar-proceso", "tags-ingresar-doc"];
  const GRIDS_MODAL = ["tags-modal-bodega", "tags-modal-proceso", "tags-modal-doc"];

  function wireTagGrid(gridId) {
    root.querySelectorAll(`#${gridId} input[type="checkbox"]`).forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.closest(".tag-check").classList.toggle("checked", cb.checked);
      });
    });
  }
  [...GRIDS_INGRESAR, ...GRIDS_MODAL].forEach(wireTagGrid);

  // Junta las casillas marcadas de varias grillas (una sola sección de un formulario)
  function tagsSeleccionados(gridIds) {
    return gridIds.flatMap((id) =>
      Array.from(root.querySelectorAll(`#${id} input[type="checkbox"]:checked`)).map((cb) => cb.value)
    );
  }

  function marcarTags(gridIds, tags) {
    gridIds.forEach((id) => {
      root.querySelectorAll(`#${id} input[type="checkbox"]`).forEach((cb) => {
        const marcado = tags.includes(cb.value);
        cb.checked = marcado;
        cb.closest(".tag-check").classList.toggle("checked", marcado);
      });
    });
  }

  function limpiarTags(gridIds) {
    marcarTags(gridIds, []);
  }

  // ----- Navegación entre tabs -----
  const tabBtns = root.querySelectorAll(".tab-btn");
  const tabs = root.querySelectorAll(".tab");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabs.forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      root.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "dashboard") cargarDashboard();
      if (btn.dataset.tab === "buscar") cargarListado();
    });
  });

  // ----- Ingresar -----
  const formIngresar = root.getElementById("form-ingresar");
  const btnIngresar = root.getElementById("btn-ingresar");
  const msgIngresar = root.getElementById("msg-ingresar");

  root.getElementById("fecha").value = new Date().toISOString().slice(0, 10);

  formIngresar.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgIngresar.className = "msg";
    msgIngresar.textContent = "";

    const numeroIngresado = root.getElementById("numero").value.trim();

    // Chequeo rápido en el navegador con lo que ya tengamos cargado (no reemplaza al del servidor)
    if (registrosCache && registrosCache.some((r) => String(r.numero) === numeroIngresado)) {
      msgIngresar.className = "msg err";
      msgIngresar.textContent = "Esa factura ya está registrada";
      return;
    }

    btnIngresar.disabled = true;
    btnIngresar.textContent = "Registrando...";

    const ahora = new Date();
    const horaActual = String(ahora.getHours()).padStart(2, "0") + ":" + String(ahora.getMinutes()).padStart(2, "0");

    const payload = {
      numero: root.getElementById("numero").value.trim(),
      fecha: root.getElementById("fecha").value,
      hora: horaActual,
      bodega: tagsSeleccionados(["tags-ingresar-bodega"]).join(", "),
      proceso: tagsSeleccionados(["tags-ingresar-proceso"]).join(", "),
      documento: tagsSeleccionados(["tags-ingresar-doc"]).join(", "),
      nc: "",
      observacion: root.getElementById("observacion").value.trim(),
      prioritario: root.getElementById("prioritario").checked,
    };

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.ok) {
        msgIngresar.className = "msg err";
        msgIngresar.textContent = data.error || "No se pudo registrar";
      } else {
        msgIngresar.className = "msg ok";
        msgIngresar.textContent = data.mensaje;

        // Agregarla al instante al listado local (sin esperar recarga)
        const [anio, mes, dia] = payload.fecha.split("-").map(Number);
        const fechaObj = new Date(anio, mes - 1, dia);
        const nuevoRegistro = {
          numero: payload.numero,
          fecha: String(dia).padStart(2, "0") + "-" + String(mes).padStart(2, "0") + "-" + anio,
          fechaISO: payload.fecha,
          dia: DIAS[fechaObj.getDay()],
          hora: payload.hora,
          bodega: payload.bodega,
          proceso: payload.proceso,
          documento: payload.documento,
          nc: payload.nc,
          observacion: payload.observacion,
          prioritario: payload.prioritario,
          mes: MESES[mes - 1],
          anio: anio,
        };
        if (registrosCache) {
          registrosCache.unshift(nuevoRegistro);
          renderListado(filtrar(registrosCache));
          guardarCacheLocal("listado", registrosCache);
        }
        if (recientesCache) recientesCache.unshift(nuevoRegistro);
        else recientesCache = [nuevoRegistro];
        renderRecientes(registrosCache || recientesCache);
        guardarCacheLocal("recientes", (registrosCache || recientesCache).slice(0, 8));

        formIngresar.reset();
        limpiarTags(GRIDS_INGRESAR);
        root.getElementById("fecha").value = new Date().toISOString().slice(0, 10);
      }
    } catch (err) {
      msgIngresar.className = "msg err";
      if (err instanceof SyntaxError) {
        // El servidor tardó demasiado y devolvió una página de error en vez de JSON.
        // La factura puede haberse guardado igual — invalidamos la caché y avisamos.
        registrosCache = null;
        dashboardCargado = false;
        msgIngresar.textContent =
          "El servidor se demoró en responder. Antes de reintentar, revisa en 'Buscar' si la factura " +
          payload.numero + " ya quedó registrada, para no duplicarla.";
      } else {
        msgIngresar.textContent = "Error de conexión: " + err.message;
      }
    } finally {
      btnIngresar.disabled = false;
      btnIngresar.textContent = "Registrar factura";
    }
  });

  // ----- Buscar + Listado (unificado) -----
  const filtroTexto = root.getElementById("filtro-texto");
  const filtroFecha = root.getElementById("filtro-fecha");
  const btnFiltrar = root.getElementById("btn-filtrar");
  const btnLimpiarFiltro = root.getElementById("btn-limpiar-filtro");

  function renderListado(registros) {
    const el = root.getElementById("listado-content");
    if (registros.length === 0) {
      el.innerHTML = '<p class="loading" style="padding:16px;">No hay facturas que coincidan.</p>';
      return;
    }
    el.innerHTML = `
      <table class="listado">
        <thead>
          <tr>
            <th>N° Factura</th>
            <th>Fecha</th>
            <th>Día</th>
            <th>Hora</th>
            <th>Bodega</th>
            <th>Proceso</th>
            <th>Documento</th>
            <th>N/C</th>
            <th>Motivo N/C</th>
            <th>Específica</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${(() => {
            const BODEGA_VALIDAS = ["VIEL", "SAN IGNACIO", "SAN FRANCISCO"];
            const PROCESO_VALIDAS = ["CORTE", "RETIRO", "TRANSPORTE", "VALPARAISO"];
            const DOCUMENTO_VALIDAS = ["GUIA", "BOLETA"];
            return registros
              .map((r) => {
                const d = {
                  bodega: String(r.bodega || "").split(",").map((s) => s.trim().toUpperCase()).filter((t) => BODEGA_VALIDAS.includes(t)).map((t) => ETIQUETA_BONITA[t] || t),
                  proceso: String(r.proceso || "").split(",").map((s) => s.trim().toUpperCase()).filter((t) => PROCESO_VALIDAS.includes(t)).map((t) => ETIQUETA_BONITA[t] || t),
                  documento: String(r.documento || "").split(",").map((s) => s.trim().toUpperCase()).filter((t) => DOCUMENTO_VALIDAS.includes(t)).map((t) => ETIQUETA_BONITA[t] || t),
                  nc: r.nc === "Completa" ? "N/C Total" : r.nc === "Parcial" ? "N/C Parcial" : "",
                  especifica: String(r.observacion || "").trim(),
                };
                return `
            <tr>
              <td class="num" style="vertical-align:top;">${r.numero}${r.prioritario ? '<span class="asterisco-prioritario" title="Prioritario">*</span>' : ""}</td>
              <td style="vertical-align:top;">${r.fecha}</td>
              <td style="vertical-align:top;">${r.dia || "-"}</td>
              <td style="vertical-align:top;">${r.hora || "-"}</td>
              <td style="vertical-align:top;">${d.bodega.length ? celdaApilada(d.bodega, "badge-bodega") : '<span class="badge badge-aldunate">Aldunate</span>'}</td>
              <td style="vertical-align:top;">${celdaApilada(d.proceso, "badge-proceso")}</td>
              <td style="vertical-align:top;">${celdaApilada(d.documento, "badge-documento")}</td>
              <td style="vertical-align:top;">${d.nc ? `<span class="badge badge-nc">${d.nc}</span>` : "-"}</td>
              <td style="vertical-align:top;">${r.motivoNc || "-"}</td>
              <td class="obs" style="vertical-align:top;">${d.especifica || "-"}</td>
              <td class="acciones-cell" style="vertical-align:top;">
                <button class="btn-mini btn-editar" data-numero="${r.numero}">Editar</button>
                <button class="btn-mini eliminar btn-eliminar" data-numero="${r.numero}">Eliminar</button>
              </td>
            </tr>`;
              })
              .join("");
          })()}
        </tbody>
      </table>
      <div class="resultados-count">${registros.length} factura${registros.length === 1 ? "" : "s"}</div>
    `;

    // Conectar botones de acciones de esta tabla
    el.querySelectorAll(".btn-editar").forEach((btn) => {
      btn.addEventListener("click", () => abrirModalEditar(btn.dataset.numero));
    });
    el.querySelectorAll(".btn-eliminar").forEach((btn) => {
      btn.addEventListener("click", () => eliminarFactura(btn.dataset.numero));
    });
  }

  async function cargarListado(forzar) {
    const el = root.getElementById("listado-content");
    if (registrosCache && !forzar) {
      renderListado(filtrar(registrosCache));
      renderRecientes(registrosCache);
      return;
    }

    if (!registrosCache) {
      const cacheLocal = leerCacheLocal("listado");
      if (cacheLocal && cacheLocal.length) {
        registrosCache = cacheLocal;
        renderListado(filtrar(registrosCache));
        renderRecientes(registrosCache);
      } else {
        el.innerHTML = '<p class="loading" style="padding:16px;">Cargando...</p>';
      }
    }

    try {
      const res = await fetch(`${API_URL}?action=listado`);
      const data = await res.json();

      if (!data.ok) {
        if (!registrosCache) el.innerHTML = `<div class="msg err" style="margin:16px;">${data.error}</div>`;
        return;
      }

      registrosCache = data.registros;
      renderListado(filtrar(registrosCache));
      renderRecientes(registrosCache);
      guardarCacheLocal("listado", registrosCache);
    } catch (err) {
      if (!registrosCache) el.innerHTML = `<div class="msg err" style="margin:16px;">Error de conexión: ${err.message}</div>`;
    }
  }

  // ----- Panel "Últimos movimientos" (pestaña Ingresar) -----
  function renderRecientes(registros) {
    const el = root.getElementById("recientes-content");
    if (!el) return;
    const ultimos = registros.slice(0, 8);
    if (ultimos.length === 0) {
      el.innerHTML = '<p class="loading">Sin registros aún.</p>';
      return;
    }
    el.innerHTML = ultimos
      .map(
        (r) => `
      <div class="recientes-row">
        <span class="num">N° ${r.numero}</span>
        <span class="cuando">${r.hora || "-"}<br>${r.fecha}</span>
      </div>`
      )
      .join("");
  }

  // Carga inicial liviana (la pestaña "Ingresar" es la que se ve primero al abrir la web,
  // así que no hace falta pedir las 200 filas completas, solo las 8 del panel lateral)
  async function cargarRecientesLigero() {
    if (registrosCache) {
      renderRecientes(registrosCache);
      return;
    }

    const cacheLocal = leerCacheLocal("recientes");
    if (cacheLocal && cacheLocal.length) {
      recientesCache = cacheLocal;
      renderRecientes(recientesCache);
    }

    try {
      const res = await fetch(`${API_URL}?action=listado&limite=8`);
      const data = await res.json();
      if (data.ok) {
        recientesCache = data.registros;
        renderRecientes(recientesCache);
        guardarCacheLocal("recientes", recientesCache);
      }
    } catch (err) {
      if (!recientesCache) {
        const el = root.getElementById("recientes-content");
        if (el) el.innerHTML = '<p class="loading">No se pudo cargar.</p>';
      }
    }
  }
  cargarRecientesLigero();

  // ----- Guía de Transporte (impresión) -----
  const CAMPOS_TRANSPORTE = [
    ["t-fecha", "p-fecha", true],
    ["t-factura", "p-factura", false],
    ["t-nombre", "p-nombre", false],
    ["t-rut", "p-rut", false],
    ["t-direccion", "p-direccion", false],
    ["t-ciudad", "p-ciudad", false],
    ["t-fono", "p-fono", false],
    ["t-transporte", "p-transporte", false],
    ["t-paquetes", "p-paquetes", false],
  ];

  function formatFechaSlip(iso) {
    if (!iso) return "-";
    const [anio, mes, dia] = iso.split("-");
    return `${dia}-${mes}-${anio}`;
  }

  function actualizarVistaPrevia() {
    CAMPOS_TRANSPORTE.forEach(([inputId, previewId, esFecha]) => {
      const input = root.getElementById(inputId);
      const preview = root.getElementById(previewId);
      if (!input || !preview) return;
      const valor = input.value.trim();
      if (esFecha) {
        preview.textContent = formatFechaSlip(valor);
      } else {
        preview.textContent = valor || "-";
      }
    });
  }

  CAMPOS_TRANSPORTE.forEach(([inputId]) => {
    const input = root.getElementById(inputId);
    if (input) input.addEventListener("input", actualizarVistaPrevia);
  });

  root.getElementById("t-fecha").value = new Date().toISOString().slice(0, 10);
  actualizarVistaPrevia();

  root.getElementById("btn-imprimir-transporte").addEventListener("click", () => {
    // Nota: como este widget vive dentro de un Shadow DOM (para no ensuciar los
    // estilos del resto de la plataforma), el truco original de "ocultar todo
    // el body salvo el área de impresión" no funciona a través del límite del
    // shadow root. En su lugar, abrimos una ventana aparte solo con la guía.
    const printArea = root.getElementById("slip-print-area");
    const w = window.open("", "_blank", "width=820,height=920");
    if (!w) {
      alert("El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e inténtalo de nuevo.");
      return;
    }
    w.document.write(
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />' +
      '<title>Guía de Transporte</title><style>' + CF_PRINT_CSS + '</style></head><body>' +
      printArea.outerHTML +
      '</body></html>'
    );
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  });

  root.getElementById("btn-limpiar-transporte").addEventListener("click", () => {
    CAMPOS_TRANSPORTE.forEach(([inputId]) => {
      const input = root.getElementById(inputId);
      if (input && inputId !== "t-fecha") input.value = "";
    });
    root.getElementById("t-fecha").value = new Date().toISOString().slice(0, 10);
    actualizarVistaPrevia();
  });

  function filtrar(registros) {
    const t = filtroTexto.value.trim().toLowerCase();
    const f = filtroFecha.value; // yyyy-mm-dd
    return registros.filter((r) => {
      const coincideTexto =
        !t ||
        String(r.numero).toLowerCase().includes(t) ||
        String(r.observacion || "").toLowerCase().includes(t) ||
        String(r.bodega || "").toLowerCase().includes(t) ||
        String(r.proceso || "").toLowerCase().includes(t) ||
        String(r.documento || "").toLowerCase().includes(t) ||
        String(r.nc || "").toLowerCase().includes(t);
      const coincideFecha = !f || r.fechaISO === f;
      return coincideTexto && coincideFecha;
    });
  }

  btnFiltrar.addEventListener("click", () => {
    if (registrosCache) renderListado(filtrar(registrosCache));
  });
  filtroTexto.addEventListener("input", () => {
    if (registrosCache) renderListado(filtrar(registrosCache));
  });
  filtroFecha.addEventListener("change", () => {
    if (registrosCache) renderListado(filtrar(registrosCache));
  });
  btnLimpiarFiltro.addEventListener("click", () => {
    filtroTexto.value = "";
    filtroFecha.value = "";
    if (registrosCache) renderListado(registrosCache);
  });

  // ----- Dashboard -----
  let dashboardCargado = false;

  function renderDashboard(data) {
    const el = root.getElementById("dashboard-content");
    const filasMes = data.porMes
      .map(
        (m) => `
      <tr>
        <td>${m.mes}</td>
        <td class="num">${m.total}</td>
        <td>${m.normal}</td>
        <td>${m.corte}</td>
        <td>${m.bodega}</td>
        <td>${m.valparaiso}</td>
        <td>${m.guia}</td>
        <td>${m.nc}</td>
      </tr>`
      )
      .join("");

    const t = data.totalAnio;
    const pt = data.porTipo;
    const etiquetasTipo = [
      ["normal", "Normal"],
      ["corte", "Corte"],
      ["viel", "Viel"],
      ["sanignacio", "San Ignacio"],
      ["sanfrancisco", "San Francisco"],
      ["retiro", "Retiro"],
      ["transporte", "Transporte"],
      ["valparaiso", "Valparaíso"],
      ["guia", "Guía"],
      ["nc", "Nota de Crédito"],
      ["boleta", "Boleta"],
      ["otros", "Otros"],
    ];
    const filasPorTipo = etiquetasTipo
      .map(([key, label]) => `<tr><td>${label}</td><td class="num">${pt[key]}</td></tr>`)
      .join("");

    const filasUltimas = data.ultimas
      .map(
        (f) => `<tr><td class="num">${f.numero}</td><td>${f.fecha}</td><td>${f.hora || "-"}</td><td class="obs">${f.observacion || "-"}</td></tr>`
      )
      .join("");

    el.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="num">${data.total}</div><div class="label">Facturas totales</div></div>
        <div class="kpi"><div class="num">${data.esteMes}</div><div class="label">Este mes</div></div>
      </div>

      <div class="tabla-wrap" style="margin-bottom:20px;">
        <div style="padding:16px 16px 0;">
          <h2 style="font-size:15px; margin:0 0 2px;">Resumen anual ${data.anio}</h2>
          <p class="sub" style="margin-bottom:12px;">Detalle mes a mes por tipo de factura.</p>
        </div>
        <table class="listado">
          <thead>
            <tr><th>Mes</th><th>Total</th><th>Normal</th><th>Corte</th><th>Bodega</th><th>Valparaíso</th><th>Guía</th><th>N/C</th></tr>
          </thead>
          <tbody>
            ${filasMes}
            <tr style="background:var(--bg); font-weight:700;">
              <td>TOTAL AÑO</td><td>${t.total}</td><td>${t.normal}</td><td>${t.corte}</td><td>${t.bodega}</td><td>${t.valparaiso}</td><td>${t.guia}</td><td>${t.nc}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="tabla-wrap" style="margin-bottom:20px;">
        <div style="padding:16px 16px 0;">
          <h2 style="font-size:15px; margin:0 0 2px;">Facturas por tipo (histórico)</h2>
          <p class="sub" style="margin-bottom:12px;">Una factura puede tener varios tipos a la vez, por eso la suma puede ser mayor al total de facturas.</p>
        </div>
        <table class="listado">
          <thead><tr><th>Tipo</th><th>Cantidad</th></tr></thead>
          <tbody>${filasPorTipo}</tbody>
        </table>
      </div>

      <div class="tabla-wrap">
        <div style="padding:16px 16px 0;">
          <h2 style="font-size:15px; margin:0 0 12px;">Últimas registradas</h2>
        </div>
        <table class="listado">
          <thead><tr><th>N°</th><th>Fecha</th><th>Hora</th><th>Observación</th></tr></thead>
          <tbody>${filasUltimas}</tbody>
        </table>
      </div>`;
  }

  async function cargarDashboard(forzar) {
    if (dashboardCargado && !forzar) return;
    const el = root.getElementById("dashboard-content");

    if (!dashboardCargado) {
      const cacheLocal = leerCacheLocal("dashboard");
      if (cacheLocal) {
        renderDashboard(cacheLocal);
      } else {
        el.innerHTML = '<p class="loading">Cargando...</p>';
      }
    }

    try {
      const res = await fetch(`${API_URL}?action=dashboard`);
      const data = await res.json();

      if (!data.ok) {
        if (!dashboardCargado) el.innerHTML = `<div class="msg err">${data.error}</div>`;
        return;
      }

      renderDashboard(data);
      guardarCacheLocal("dashboard", data);
      dashboardCargado = true;
    } catch (err) {
      if (!dashboardCargado) el.innerHTML = `<div class="msg err">Error de conexión: ${err.message}</div>`;
    }
  }
  // ----- Editar / Eliminar -----
  const modalOverlay = root.getElementById("modal-overlay");
  const formEditar = root.getElementById("form-editar");
  const modalMsg = root.getElementById("modal-msg");
  const modalGuardar = root.getElementById("modal-guardar");
  let numeroEnEdicion = null;

  // Etiquetas bonitas para mostrar en el listado (los valores guardados son códigos en mayúscula)
  const ETIQUETA_BONITA = {
    CORTE: "Corte", VIEL: "Viel", "SAN IGNACIO": "San Ignacio", "SAN FRANCISCO": "San Francisco",
    RETIRO: "Retiro", TRANSPORTE: "Transporte", VALPARAISO: "Valparaíso", GUIA: "Guía", BOLETA: "Boleta",
  };

  function celdaApilada(items, claseBadge) {
    if (!items || items.length === 0) return "-";
    return items
      .map((v) => `<div style="margin-bottom:3px;"><span class="badge ${claseBadge}">${v}</span></div>`)
      .join("");
  }

  // ----- Mostrar/ocultar el bloque de motivo según el select de NC -----
  const selectNC = root.getElementById("modal-nc");
  const wrapMotivo = root.getElementById("modal-nc-motivo-wrap");
  const selectMotivo = root.getElementById("modal-nc-motivo");
  const wrapMotivoOtro = root.getElementById("modal-nc-motivo-otro-wrap");
  const inputMotivoOtro = root.getElementById("modal-nc-motivo-otro");
  const seccionNC = root.getElementById("seccion-nc");

  selectNC.addEventListener("change", () => {
    const activo = selectNC.value !== "";
    wrapMotivo.style.display = activo ? "block" : "none";
    seccionNC.classList.toggle("activa", activo);
    if (!activo) {
      selectMotivo.value = "";
      wrapMotivoOtro.style.display = "none";
      inputMotivoOtro.value = "";
    }
  });
  selectMotivo.addEventListener("change", () => {
    wrapMotivoOtro.style.display = selectMotivo.value === "Otro" ? "block" : "none";
  });

  function abrirModalEditar(numero) {
    const registro = registrosCache.find((r) => String(r.numero) === String(numero));
    if (!registro) return;
    numeroEnEdicion = numero;

    const tags = [
      ...String(registro.bodega || "").split(",").map((s) => s.trim()).filter((t) => t && t !== "ALDUNATE"),
      ...String(registro.proceso || "").split(",").map((s) => s.trim()).filter(Boolean),
      ...String(registro.documento || "").split(",").map((s) => s.trim()).filter(Boolean),
    ];
    const ncValor = registro.nc || "";
    const ncMotivo = registro.motivoNc || "";
    const libre = String(registro.observacion || "").trim();

    root.getElementById("modal-numero").textContent = registro.numero;
    root.getElementById("modal-fecha").value = registro.fechaISO || "";
    root.getElementById("modal-hora").value = registro.hora || "";
    root.getElementById("modal-prioritario").checked = !!registro.prioritario;
    marcarTags(GRIDS_MODAL, tags);

    root.getElementById("modal-observacion").value = libre;

    selectNC.value = ncValor;
    const activo = ncValor !== "";
    wrapMotivo.style.display = activo ? "block" : "none";
    seccionNC.classList.toggle("activa", activo);
    if (activo && ncMotivo) {
      const opciones = Array.from(selectMotivo.options).map((o) => o.value);
      if (opciones.includes(ncMotivo)) {
        selectMotivo.value = ncMotivo;
        wrapMotivoOtro.style.display = "none";
      } else {
        selectMotivo.value = "Otro";
        wrapMotivoOtro.style.display = "block";
        inputMotivoOtro.value = ncMotivo;
      }
    } else {
      selectMotivo.value = "";
      wrapMotivoOtro.style.display = "none";
      inputMotivoOtro.value = "";
    }

    modalMsg.className = "msg";
    modalMsg.textContent = "";
    modalOverlay.classList.add("active");
  }

  function cerrarModal() {
    modalOverlay.classList.remove("active");
    numeroEnEdicion = null;
  }

  root.getElementById("modal-cancelar").addEventListener("click", cerrarModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) cerrarModal();
  });

  formEditar.addEventListener("submit", async (e) => {
    e.preventDefault();
    modalMsg.className = "msg";
    modalMsg.textContent = "";

    // Si se marcó Nota de Crédito, el motivo es obligatorio
    const ncValor = selectNC.value;
    let motivoFinal = "";
    if (ncValor) {
      if (!selectMotivo.value) {
        modalMsg.className = "msg err";
        modalMsg.textContent = "Selecciona el motivo de la Nota de Crédito";
        return;
      }
      if (selectMotivo.value === "Otro" && !inputMotivoOtro.value.trim()) {
        modalMsg.className = "msg err";
        modalMsg.textContent = "Especifica el motivo de la Nota de Crédito";
        return;
      }
      motivoFinal = selectMotivo.value === "Otro" ? inputMotivoOtro.value.trim() : selectMotivo.value;
    }

    modalGuardar.disabled = true;
    modalGuardar.textContent = "Guardando...";

    const fechaVal = root.getElementById("modal-fecha").value;
    const horaVal = root.getElementById("modal-hora").value;

    const bodegaVal = tagsSeleccionados(["tags-modal-bodega"]).join(", ");
    const procesoVal = tagsSeleccionados(["tags-modal-proceso"]).join(", ");
    const documentoVal = tagsSeleccionados(["tags-modal-doc"]).join(", ");
    const libreFinal = root.getElementById("modal-observacion").value.trim();

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          accion: "editar",
          numero: numeroEnEdicion,
          fecha: fechaVal,
          hora: horaVal,
          bodega: bodegaVal,
          proceso: procesoVal,
          documento: documentoVal,
          nc: ncValor,
          motivoNc: motivoFinal,
          observacion: libreFinal,
          prioritario: root.getElementById("modal-prioritario").checked,
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        modalMsg.className = "msg err";
        modalMsg.textContent = data.error || "No se pudo actualizar";
        return;
      }

      // Actualizar el registro en la caché local
      const [anio, mes, dia] = fechaVal.split("-").map(Number);
      const fechaObj = new Date(anio, mes - 1, dia);
      const idx = registrosCache.findIndex((r) => String(r.numero) === String(numeroEnEdicion));
      if (idx !== -1) {
        registrosCache[idx] = {
          ...registrosCache[idx],
          fecha: String(dia).padStart(2, "0") + "-" + String(mes).padStart(2, "0") + "-" + anio,
          fechaISO: fechaVal,
          dia: DIAS[fechaObj.getDay()],
          hora: horaVal,
          bodega: bodegaVal,
          proceso: procesoVal,
          documento: documentoVal,
          nc: ncValor,
          motivoNc: motivoFinal,
          observacion: libreFinal,
          prioritario: root.getElementById("modal-prioritario").checked,
          mes: MESES[mes - 1],
          anio: anio,
        };
      }
      renderListado(filtrar(registrosCache));
      cerrarModal();
    } catch (err) {
      modalMsg.className = "msg err";
      modalMsg.textContent = "Error de conexión: " + err.message;
    } finally {
      modalGuardar.disabled = false;
      modalGuardar.textContent = "Guardar";
    }
  });

  async function eliminarFactura(numero) {
    if (!confirm(`¿Eliminar la factura N° ${numero}? Esta acción no se puede deshacer.`)) return;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ accion: "eliminar", numero }),
      });
      const data = await res.json();

      if (!data.ok) {
        alert(data.error || "No se pudo eliminar");
        return;
      }

      registrosCache = registrosCache.filter((r) => String(r.numero) !== String(numero));
      renderListado(filtrar(registrosCache));
      renderRecientes(registrosCache);
    } catch (err) {
      alert("Error de conexión: " + err.message);
    }
  }

  // ----- Botones de actualización manual -----
  root.getElementById("btn-refrescar-listado").addEventListener("click", () => cargarListado(true));
  root.getElementById("btn-refrescar-dashboard").addEventListener("click", () => cargarDashboard(true));

  // ----- Sincronización automática cada 45s (solo si la pestaña está visible) -----
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const activo = root.querySelector(".tab-btn.active")?.dataset.tab;
    if (activo === "buscar" || activo === "ingresar") cargarListado(true);
    if (activo === "dashboard") cargarDashboard(true);
  }, 45000);
