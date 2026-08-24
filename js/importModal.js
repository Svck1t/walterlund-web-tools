/* ============================================
   importModal.js
   Componente reutilizable: modal con dropzone para
   arrastrar/seleccionar un archivo.
   No sabe nada de Excel, Stock, ni de ningún módulo
   en particular — solo entrega el File elegido vía callback.
   Cualquier sección nueva que necesite "Importar Excel"
   reutiliza este mismo componente.
============================================ */

const ImportModal = (() => {

  let overlay, dropzone, fileInput, titleEl, hintEl, statusEl, currentOnFile;

  function ensureBuilt() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="import-modal-title">Importar Excel</h2>
          <button class="modal-close" type="button" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">
          <label class="dropzone" tabindex="0">
            <span class="dropzone-icon">📄</span>
            <strong>Arrastra tu archivo aquí</strong>
            <span>o haz click para seleccionarlo</span>
            <span class="dropzone-hint import-modal-hint">Formatos aceptados: .xlsx, .xls</span>
            <input type="file" style="display:none;">
          </label>
          <div class="dropzone-status"></div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    dropzone = overlay.querySelector('.dropzone');
    fileInput = overlay.querySelector('input[type="file"]');
    titleEl = overlay.querySelector('.import-modal-title');
    hintEl = overlay.querySelector('.import-modal-hint');
    statusEl = overlay.querySelector('.dropzone-status');

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  function handleFile(file) {
    if (currentOnFile) currentOnFile(file, { setStatus, close });
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  /**
   * @param {Object} opts
   * @param {string} opts.title            Título del modal
   * @param {string} opts.hint             Texto bajo el dropzone (ej. formatos aceptados)
   * @param {string} opts.accept           Atributo accept del input file
   * @param {function} opts.onFile         (file, { setStatus, close }) => void
   */
  function open({ title = 'Importar Excel', hint = 'Formatos aceptados: .xlsx, .xls', accept = '.xlsx,.xls', onFile }) {
    ensureBuilt();
    titleEl.textContent = title;
    hintEl.textContent = hint;
    fileInput.setAttribute('accept', accept);
    fileInput.value = '';
    setStatus('');
    currentOnFile = onFile;
    overlay.hidden = false;
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  return { open, close, setStatus };
})();
