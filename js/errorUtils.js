/* ============================================
   errorUtils.js
   Responsabilidad única: convertir cualquier valor de error
   (Error real, string, objeto sin .message, undefined, etc.)
   en un texto legible para mostrar en la UI.
============================================ */

function describeError(err) {
  if (!err) return 'Error desconocido (sin detalle).';
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) return err.message;
  try {
    const asJson = JSON.stringify(err);
    if (asJson && asJson !== '{}') return asJson;
  } catch (_) { /* err no es serializable, seguimos abajo */ }
  return String(err);
}
