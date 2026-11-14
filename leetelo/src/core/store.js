// IndexedDB: the only persistent state. Books (Blob + metadata), reading
// positions, bookmarks and settings. MV3 kills workers at will, so nothing
// lives anywhere else; every page rebuilds its state from here.
//
// Object stores:
//   books     { id, title, creator, language, fileName, size, spineLength, cover (small image Blob), addedAt, openedAt }
//   files     { id, blob }                       (kept apart so listing never touches blobs)
//   positions { bookId, pos, progress, mode, updatedAt }
//   bookmarks { id (auto), bookId, pos, progress, label, createdAt }   index: bookId
//   settings  { key, value }                    'book:<id>' = that book's own text settings
//   highlights { id (auto), bookId, start, end, text, note, color, progress, createdAt, updatedAt }   index: bookId   (v2)
//   stats     { bookId, ms, days: { <localDay>: ms }, firstAt, lastAt }                                             (v2)

const DB_NAME = 'readpane';
const DB_VERSION = 2;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });

/** Stable book id from content: size + SHA-256 of the first and last 256 KiB (never reads the whole file). */
export async function bookKey(blob) {
  const n = 256 * 1024;
  const head = await blob.slice(0, n).arrayBuffer();
  const tail = blob.size > n ? await blob.slice(Math.max(n, blob.size - n)).arrayBuffer() : new ArrayBuffer(0);
  const buf = new Uint8Array(16 + head.byteLength + tail.byteLength);
  new DataView(buf.buffer).setFloat64(0, blob.size);
  buf.set(new Uint8Array(head), 16);
  buf.set(new Uint8Array(tail), 16 + head.byteLength);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...hash.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function openStore(name = DB_NAME) {
  const open = indexedDB.open(name, DB_VERSION);
  // Upgrades only add stores: a v1 library (books, places, bookmarks) is kept as is.
  open.onupgradeneeded = (e) => {
    const db = open.result;
    if (e.oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('positions', { keyPath: 'bookId' });
      db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true }).createIndex('bookId', 'bookId');
      db.createObjectStore('settings', { keyPath: 'key' });
    }
    if (e.oldVersion < 2) {
      db.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true }).createIndex('bookId', 'bookId');
      db.createObjectStore('stats', { keyPath: 'bookId' });
    }
  };
  const db = await req(open);

  const get = (store, key) => req(db.transaction(store).objectStore(store).get(key));
  async function put(store, value) {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    await done(tx);
    return r.result;
  }

  return {
    db,
    /** Add or refresh a book. Returns its id. */
    async putBook(blob, meta) {
      const id = meta.id ?? (blob ? await bookKey(blob) : undefined);
      const now = Date.now();
      const old = await get('books', id);
      const { preserveOpenedAt, ...cleanMeta } = meta || {};
      const hasValidNewCover = typeof cleanMeta.cover === 'string' && cleanMeta.cover.startsWith('data:');
      const hasValidOldCover = typeof old?.cover === 'string' && old.cover.startsWith('data:');
      const cover = hasValidNewCover ? cleanMeta.cover : (hasValidOldCover ? old.cover : (cleanMeta.cover ?? old?.cover ?? null));
      const tx = db.transaction(['books', 'files'], 'readwrite');
      tx.objectStore('books').put({
        ...old,
        ...cleanMeta,
        ...(cover ? { cover } : {}),
        id,
        size: old?.size ?? blob?.size ?? cleanMeta.size ?? 0,
        addedAt: old?.addedAt ?? now,
        openedAt: (preserveOpenedAt && old?.openedAt) ? old.openedAt : now,
      });
      if (!old && blob) tx.objectStore('files').put({ id, blob });
      await done(tx);
      return id;
    },
    async getBook(id) {
      const [meta, file] = await Promise.all([get('books', id), get('files', id)]);
      return meta && file ? { meta, blob: file.blob } : null;
    },
    /** Metadata only, most recently opened first. */
    async listBooks() {
      const all = await req(db.transaction('books').objectStore('books').getAll());
      return all.sort((a, b) => b.openedAt - a.openedAt);
    },
    async deleteBook(id) {
      const tx = db.transaction(['books', 'files', 'positions', 'bookmarks', 'highlights', 'stats', 'settings'], 'readwrite');
      tx.objectStore('books').delete(id);
      tx.objectStore('files').delete(id);
      tx.objectStore('positions').delete(id);
      tx.objectStore('stats').delete(id);
      tx.objectStore('settings').delete(`book:${id}`);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(`rp-setting:book:${id}`);
        }
      } catch {}
      for (const name of ['bookmarks', 'highlights']) {
        tx.objectStore(name).index('bookId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
          const c = e.target.result;
          if (c) { tx.objectStore(name).delete(c.primaryKey); c.continue(); }
        };
      }
      await done(tx);
    },

    savePosition: (bookId, pos, extra = {}) => put('positions', { bookId, pos, ...extra, updatedAt: Date.now() }),
    getPosition: (bookId) => get('positions', bookId),
    /** Every book's saved place (the library shows % read). */
    listPositions: () => req(db.transaction('positions').objectStore('positions').getAll()),

    addBookmark: (bookId, pos, extra = {}) => put('bookmarks', { bookId, pos, ...extra, createdAt: Date.now() }),
    /** Bookmarks of a book, in creation order (callers sort by position as they like). */
    listBookmarks: (bookId) => req(db.transaction('bookmarks').objectStore('bookmarks').index('bookId').getAll(IDBKeyRange.only(bookId))),
    async deleteBookmark(id) {
      const tx = db.transaction('bookmarks', 'readwrite');
      tx.objectStore('bookmarks').delete(id);
      await done(tx);
    },

    /** Highlights and notes of a book, in creation order. put() with an id updates one. */
    putHighlight: (h) => put('highlights', { ...h, updatedAt: Date.now(), createdAt: h.createdAt ?? Date.now() }),
    listHighlights: (bookId) => req(db.transaction('highlights').objectStore('highlights').index('bookId').getAll(IDBKeyRange.only(bookId))),
    async deleteHighlight(id) {
      const tx = db.transaction('highlights', 'readwrite');
      tx.objectStore('highlights').delete(id);
      await done(tx);
    },

    getStats: (bookId) => get('stats', bookId),
    listStats: () => req(db.transaction('stats').objectStore('stats').getAll()),
    putStats: (rec) => put('stats', rec),

    async getSetting(key, fallback) {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(`rp-setting:${key}`);
          if (raw !== null) return JSON.parse(raw);
        }
      } catch {}
      const val = (await get('settings', key))?.value;
      if (val !== undefined) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`rp-setting:${key}`, JSON.stringify(val));
          }
        } catch {}
        return val;
      }
      return fallback;
    },
    async setSetting(key, value) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`rp-setting:${key}`, JSON.stringify(value));
          if (key === 'theme') {
            localStorage.setItem('rpTheme', typeof value === 'string' ? value : JSON.stringify(value));
          }
          if (key === 'style' && typeof value === 'object' && value !== null) {
            for (const [prop, propVal] of Object.entries(value)) {
              localStorage.setItem(`rp-style:${prop}`, JSON.stringify(propVal));
            }
          }
        }
      } catch (err) {
        console.warn('[Léetelo] Error guardando ajuste en localStorage:', err);
      }
      return put('settings', { key, value });
    },
    async deleteSetting(key) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(`rp-setting:${key}`);
          if (key === 'theme') localStorage.removeItem('rpTheme');
          if (key === 'style') {
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k?.startsWith('rp-style:')) localStorage.removeItem(k);
            }
          }
        }
      } catch {}
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').delete(key);
      await done(tx);
    },

    close: () => db.close(),
  };
}
