// Número a palabras en español (mayúsculas), como lo imprime Softland: "TREINTA Y SIETE MIL ... PESOS"
(function (root) {
  const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE',
    'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES',
    'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  function cientos(n) {
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100), r = n % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
    return [C[c], dec].filter(Boolean).join(' ');
  }
  function letras(n) {
    n = Math.round(Math.abs(Number(n) || 0));
    if (n === 0) return 'CERO PESOS';
    if (n === 1) return 'UN PESO';
    const mill = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
    const p = [];
    if (mill) p.push(mill === 1 ? 'UN MILLON' : letrasSin(mill) + ' MILLONES');
    if (miles) p.push(miles === 1 ? 'MIL' : cientos(miles) + ' MIL');
    if (resto) p.push(cientos(resto));
    return p.join(' ') + ((!miles && !resto) ? ' DE PESOS' : ' PESOS');
  }
  function letrasSin(n) { return letras(n).replace(/ (DE )?PESOS$/, ''); }
  const api = { letras };
  if (typeof module !== 'undefined') module.exports = api; else root.NumLetras = api;
})(this);
