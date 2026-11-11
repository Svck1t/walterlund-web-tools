/* ============================================
   reposicionAnalysis.js
   Responsabilidad única: dado el stock consolidado de
   SAN FRANCISCO 918, VIEL y ALDUNATE, determinar qué
   productos tienen stock bajo y qué traslados internos
   los pueden resolver.

   Reglas de negocio (definidas con Sebastián, agosto 2026):
   - VIEL es bodega de acopio: nunca RECIBE traslados, solo
     los envía. Puede quedar en 0 sin problema — el objetivo
     es vaciarla para poder seguir recepcionando importaciones.
   - SAN FRANCISCO 918 (20% clientes presenciales) y ALDUNATE
     (80% despachos) son centros de distribución y pueden
     traspasarse stock entre sí. El centro que ENVÍA nunca
     puede bajar de un 70% de su stock actual de ese producto.
   - Un producto se considera "stock bajo" en SAN FRANCISCO 918
     o ALDUNATE cuando su cantidad es ≤ su nivel mínimo. Ese
     mínimo es, por defecto, 30 unidades para todos los productos,
     pero puede sobreescribirse producto por producto y bodega por
     bodega (ver NivelesMinimosStore) — refleja que cada bodega
     tiene capacidades/posiciones distintas, y no todos los
     productos rotan igual.
   - Prioridad de origen: primero VIEL (si tiene stock del
     producto); solo si VIEL no tiene, se evalúa el otro centro
     de distribución.
   - El otro centro de distribución nunca se usa como origen si
     él mismo también está en stock bajo (según SU PROPIO nivel
     mínimo) — no tiene sentido descapitalizar una bodega que
     también necesita reposición.
   - Al trasladar, se envía TODO lo que la bodega de origen puede
     dar sin bajar de su límite (0 para VIEL, 70% de su stock
     actual para el otro centro de distribución).
   - Si un mismo producto está bajo en ambas bodegas de distribución
     a la vez, VIEL se REPARTE entre las dos (corregido nov 2026; antes
     se le daba todo a la más crítica y la otra quedaba sin traslado):
     primero se cubre lo que le falta a cada una para llegar a su
     mínimo (en proporción a ese faltante si VIEL no alcanza), y lo que
     sobra se reparte según lo que despacha cada centro: 80% ALDUNATE,
     20% SAN FRANCISCO 918.
============================================ */

const ReposicionAnalysis = (() => {

  const UMBRAL_STOCK_BAJO_DEFAULT = 30; // se usa si el producto no tiene nivel mínimo configurado
  const PORCENTAJE_MINIMO_ORIGEN = 0.7; // el centro que envía no puede bajar de esto
  // Preventivo: avisa cuando el stock está sobre el mínimo pero a menos de un 50% de él
  // (ej. mínimo 20 → avisa con 30 o menos), para reponer antes de que un pedido grande lo deje en 0.
  const MARGEN_PREVENTIVO = 1.5;
  // Reparto del sobrante de VIEL cuando ambos centros necesitan (según lo que despacha cada uno)
  const PESO_CENTRO = { aldunate: 0.8, sanFco: 0.2 };

  const BODEGA_LABEL = {
    sanFco: 'SAN FRANCISCO 918',
    viel: 'VIEL',
    aldunate: 'ALDUNATE'
  };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Nivel mínimo a usar para un producto+bodega: el configurado manualmente
   * (vía `obtenerMinimo`) si existe, si no el umbral por defecto.
   * `obtenerMinimo` es opcional — sin ella, se comporta igual que antes (umbral fijo).
   */
  // Un mínimo vacío ('') o no numérico NO es 0: es "sin configurar" y usa el umbral por defecto.
  // (Antes Number('') daba 0 y el producto solo aparecía cuando ya se había agotado.)
  function minimoValido(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) || n < 0 ? null : n;
  }
  function umbralPara(codigo, bodega, obtenerMinimo) {
    const custom = obtenerMinimo ? minimoValido(obtenerMinimo(codigo, bodega)) : null;
    return custom !== null ? custom : UMBRAL_STOCK_BAJO_DEFAULT;
  }
  function fuenteUmbral(codigo, bodega, obtenerMinimo) {
    if (!obtenerMinimo) return 'defecto';
    const v = obtenerMinimo(codigo, bodega);
    if (v === null || v === undefined) return 'defecto';
    return minimoValido(v) === null ? 'invalido' : 'configurado';
  }

  /** Cuánto puede dar un centro de distribución sin bajar del 70% de su stock actual.
   *  Si el propio centro ya está en stock bajo (según su propio mínimo), no puede dar nada. */
  function disponibleDesdeCentro(stockActual, umbralPropio) {
    if (stockActual <= umbralPropio) return 0;
    return Math.max(0, round2(stockActual * (1 - PORCENTAJE_MINIMO_ORIGEN)));
  }

  /**
   * Evalúa un producto completo (ambas bodegas de distribución a la vez,
   * para no repartir dos veces el mismo stock de VIEL).
   * `obtenerMinimo(codigo, bodega)` es opcional: si se pasa, se usa para
   * consultar el nivel mínimo configurado manualmente por producto.
   * Devuelve un array con 0, 1 o 2 filas (una por bodega con stock bajo).
   */
  function evaluarRecord(record, obtenerMinimo, factor = 1) {
    const filas = [];
    let vielRestante = record.viel;

    const umbrales = {
      sanFco: umbralPara(record.codigo, 'sanFco', obtenerMinimo),
      aldunate: umbralPara(record.codigo, 'aldunate', obtenerMinimo)
    };

    const destinosBajos = ['sanFco', 'aldunate']
      .filter(d => record[d] <= umbrales[d] * factor)
      .sort((a, b) => record[a] - record[b]); // más crítico (menos stock) primero

    // Cuánto de VIEL le toca a cada destino bajo
    const asignViel = {};
    if (record.viel > 0 && destinosBajos.length === 1) {
      asignViel[destinosBajos[0]] = round2(record.viel);          // uno solo: VIEL entrega todo
    } else if (record.viel > 0 && destinosBajos.length === 2) {
      // en resmas/unidades se reparte en enteros; si VIEL trae decimales (kg) se mantienen 2 decimales
      const redondear = Number.isInteger(record.viel) ? Math.floor : round2;
      const falta = d => Math.max(0, umbrales[d] - record[d]);
      const faltaTotal = destinosBajos.reduce((t, d) => t + falta(d), 0);
      if (faltaTotal >= record.viel && faltaTotal > 0) {
        // VIEL no alcanza para dejar a ambas en su mínimo: en proporción a lo que le falta a cada una
        destinosBajos.forEach(d => { asignViel[d] = redondear(record.viel * falta(d) / faltaTotal); });
      } else {
        // cubre el faltante de cada una y reparte el resto 80% Aldunate / 20% San Francisco
        const resto = record.viel - faltaTotal;
        destinosBajos.forEach(d => { asignViel[d] = redondear(falta(d) + resto * PESO_CENTRO[d]); });
      }
      // que la suma sea exactamente lo que tiene VIEL (los redondeos van a la más crítica)
      const dif = round2(record.viel - destinosBajos.reduce((t, d) => t + asignViel[d], 0));
      asignViel[destinosBajos[0]] = round2(asignViel[destinosBajos[0]] + dif);
    }

    destinosBajos.forEach(destino => {
      const stockDestino = record[destino];
      const otro = destino === 'sanFco' ? 'aldunate' : 'sanFco';

      let origen = null;
      let cantidad = 0;

      if (asignViel[destino] > 0) {
        origen = 'viel';
        cantidad = asignViel[destino];
        vielRestante = round2(vielRestante - cantidad);
      } else {
        // en modo preventivo, el otro centro tampoco presta si está cerca de su propio mínimo
        const disponibleOtro = disponibleDesdeCentro(record[otro], umbrales[otro] * factor);
        if (disponibleOtro > 0) {
          origen = otro;
          cantidad = disponibleOtro;
        }
      }

      const stockOrigenActual = origen ? record[origen] : null;

      filas.push({
        codigo: record.codigo,
        nombre: record.nombre,
        unidad: record.unidad,
        destino,
        destinoLabel: BODEGA_LABEL[destino],
        stockDestino,
        umbralDestino: umbrales[destino],
        origen,
        origenLabel: origen ? BODEGA_LABEL[origen] : null,
        stockOrigenActual,
        stockOrigenResultante: origen ? round2(stockOrigenActual - cantidad) : null,
        stockDestinoResultante: origen ? round2(stockDestino + cantidad) : null,
        cantidad,
        resuelto: origen !== null,
        preventivo: factor > 1 && stockDestino > umbrales[destino]
      });
    });

    return filas;
  }

  /**
   * Analiza todos los registros importados y devuelve la lista completa de filas.
   * `obtenerMinimo(codigo, bodega)` es opcional (ver evaluarRecord).
   */
  function analizar(records, obtenerMinimo) {
    const filas = records.flatMap((r) => evaluarRecord(r, obtenerMinimo));
    filas.sort((a, b) => {
      if (a.destino !== b.destino) return a.destino.localeCompare(b.destino);
      return a.codigo.localeCompare(b.codigo);
    });
    return filas;
  }

  /** Productos sobre su mínimo pero a menos de un 50% de él: reposición preventiva (solo filas nuevas). */
  function preventivos(records, obtenerMinimo) {
    return records.flatMap(r => evaluarRecord(r, obtenerMinimo, MARGEN_PREVENTIVO))
      .filter(f => f.preventivo)
      .sort((a, b) => (a.stockDestino / (a.umbralDestino || 1)) - (b.stockDestino / (b.umbralDestino || 1)));
  }

  /** Explica, para un producto, por qué aparece o no en la reposición. */
  function diagnosticar(record, obtenerMinimo) {
    const bod = ['sanFco', 'aldunate'].map(b => {
      const min = umbralPara(record.codigo, b, obtenerMinimo);
      const fuente = fuenteUmbral(record.codigo, b, obtenerMinimo);
      const bajo = record[b] <= min;
      const cerca = !bajo && record[b] <= min * MARGEN_PREVENTIVO;
      return { bodega: b, label: BODEGA_LABEL[b], stock: record[b], min, fuente, bajo, cerca };
    });
    const filas = evaluarRecord(record, obtenerMinimo);
    return { record, bodegas: bod, filas };
  }

  function resumen(filas) {
    const resueltos = filas.filter(f => f.resuelto);
    return {
      totalStockBajo: filas.length,
      totalConTraslado: resueltos.length,
      totalSinSolucion: filas.length - resueltos.length
    };
  }

  return {
    analizar,
    resumen,
    preventivos,
    diagnosticar,
    minimoValido,
    MARGEN_PREVENTIVO,
    UMBRAL_STOCK_BAJO_DEFAULT,
    PORCENTAJE_MINIMO_ORIGEN,
    BODEGA_LABEL
  };
})();
