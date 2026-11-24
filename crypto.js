/* Шифрование и хранилище на устройстве. Все медицинские данные — только в зашифрованном виде. */
'use strict';
const MC = window.MC = window.MC || {};

MC.b64 = {
  enc(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
};

MC.crypto = {
  async deriveKey(password, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: MC.b64.dec(saltB64), iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async decryptBlob(key, blob) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: MC.b64.dec(blob.iv), additionalData: new TextEncoder().encode(blob.aad || '') }, key, MC.b64.dec(blob.ct));
    return plain;
  },
  async gunzipToText(buf) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  },
  async encJSON(key, obj, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: MC.b64.enc(iv), ct: MC.b64.enc(ct), aad };
  },
  async decJSON(key, rec) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: MC.b64.dec(rec.iv), additionalData: new TextEncoder().encode(rec.aad) }, key, MC.b64.dec(rec.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  },
  async pinHash(pin, saltB64) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: MC.b64.dec(saltB64), iterations: 150000, hash: 'SHA-256' }, base, 256);
    return MC.b64.enc(bits);
  }
};

/* IndexedDB: kv (настройки, ключ устройства), notes (зашифрованные записи) */
MC.db = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('medcard', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('notes'); };
      r.onsuccess = () => { this._db = r.result; res(this._db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store); let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  get(store, k) { return this.tx(store, 'readonly', s => this.req(s.get(k))); },
  put(store, k, v) { return this.tx(store, 'readwrite', s => this.req(s.put(v, k))); },
  del(store, k) { return this.tx(store, 'readwrite', s => this.req(s.delete(k))); },
  all(store) { return this.tx(store, 'readonly', s => this.req(s.getAll())); },
  keys(store) { return this.tx(store, 'readonly', s => this.req(s.getAllKeys())); },
  clear(store) { return this.tx(store, 'readwrite', s => this.req(s.clear())); }
};
