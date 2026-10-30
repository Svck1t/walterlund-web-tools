/*
 * claude-shim.js
 * La página original corría dentro de Claude y usaba claude.use('db' | 'user' | 'downloads').
 * Este archivo reemplaza esas tres funciones para que funcione en cualquier hosting (GitHub Pages, etc.):
 *   - db        -> Firebase Firestore (compartido en tiempo real) o localStorage (modo local)
 *   - user      -> siempre con permiso de escritura
 *   - downloads -> descarga normal del navegador
 * No hace falta tocar el index.html.
 */
(function () {
  'use strict';

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  };

  /* ---------- user ---------- */
  const user = { can: () => true };

  /* ---------- db: Firebase ---------- */
  function firebaseDb() {
    const app = firebase.initializeApp(window.FIREBASE_CONFIG);
    const fs = firebase.firestore(app);
    return { collection: name => fs.collection(name) };
  }

  /* ---------- db: modo local (localStorage) ---------- */
  function localDb() {
    const PREFIX = 'wl_bodega:';
    const load = n => { try { return JSON.parse(localStorage.getItem(PREFIX + n)) || {}; } catch (e) { return {}; } };
    const save = (n, o) => { try { localStorage.setItem(PREFIX + n, JSON.stringify(o)); } catch (e) {} };
    const listeners = {};

    function snapshot(n) {
      const o = load(n);
      return {
        docs: Object.keys(o).map(id => ({ id, data: () => o[id] })),
        metadata: { fromCache: false }
      };
    }
    function emit(n) { (listeners[n] || []).forEach(cb => cb(snapshot(n))); }

    window.addEventListener('storage', e => {
      if (e.key && e.key.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length));
    });

    return {
      collection(n) {
        return {
          doc(id) {
            return {
              async set(d) { const o = load(n); o[id] = d; save(n, o); emit(n); },
              async update(d) { const o = load(n); o[id] = Object.assign({}, o[id], d); save(n, o); emit(n); },
              async delete() { const o = load(n); delete o[id]; save(n, o); emit(n); }
            };
          },
          onSnapshot(ok) {
            (listeners[n] = listeners[n] || []).push(ok);
            setTimeout(() => ok(snapshot(n)), 0);
            return () => { listeners[n] = listeners[n].filter(f => f !== ok); };
          }
        };
      }
    };
  }

  let db;
  if (window.FIREBASE_CONFIG && window.firebase) {
    db = firebaseDb();
  } else {
    db = localDb();
    console.info('[WL] Modo local: configura firebase-config.js para compartir datos entre personas.');
  }

  window.claude = {
    use: async name => ({ db, user, downloads })[name] || null
  };
})();
