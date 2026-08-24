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
     a la vez y VIEL solo alcanza para una, se prioriza a la que
     tiene MENOS stock (la más crítica).
============================================ */

const ReposicionAnalysis = (() => {

  const UMBRAL_STOCK_BAJO_DEFAULT = 30; // se usa si el producto no tiene nivel mínimo configurado
  const PORCENTAJE_MINIMO_ORIGEN = 0.7; // el centro que envía no puede bajar de esto

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
  function umbralPara(codigo, bodega, obtenerMinimo) {
    if (obtenerMinimo) {
      const custom = obtenerMinimo(codigo, bodega);
      if (custom !== null && custom !== undefined && !isNaN(custom)) return Number(custom);
    }
    return UMBRAL_STOCK_BAJO_DEFAULT;
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
  function evaluarRecord(record, obtenerMinimo) {
    const filas = [];
    let vielRestante = record.viel;

    const umbrales = {
      sanFco: umbralPara(record.codigo, 'sanFco', obtenerMinimo),
      aldunate: umbralPara(record.codigo, 'aldunate', obtenerMinimo)
    };

    const destinosBajos = ['sanFco', 'aldunate']
      .filter(d => record[d] <= umbrales[d])
      .sort((a, b) => record[a] - record[b]); // más crítico (menos stock) primero

    destinosBajos.forEach(destino => {
      const stockDestino = record[destino];
      const otro = destino === 'sanFco' ? 'aldunate' : 'sanFco';

      let origen = null;
      let cantidad = 0;

      if (vielRestante > 0) {
        origen = 'viel';
        cantidad = round2(vielRestante);
        vielRestante = 0; // VIEL entrega todo lo que tiene de una vez
      } else {
        const disponibleOtro = disponibleDesdeCentro(record[otro], umbrales[otro]);
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
        resuelto: origen !== null
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
    UMBRAL_STOCK_BAJO_DEFAULT,
    PORCENTAJE_MINIMO_ORIGEN,
    BODEGA_LABEL
  };
})();
