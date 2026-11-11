// Library export / import as one .readpane file (see libfile.js). The archive is
// a Blob of Blobs (books are never copied into one buffer); import reads book
// entries as slices of the dropped file and writes them straight to IndexedDB.

import { openZip } from '../core/zip.js';
import { zipBlob } from '../core/zipwrite.js';
import { LibraryFileError, buildManifest, planImport } from './libfile.js';
import { hasRoom } from './logic.js';
import { saveBookPhysically } from './reader.js';

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
const all = (store, name) => req(store.db.transaction(name).objectStore(name).getAll());

/** The whole library as a Blob, ready for <a download>. */
export async function exportLibrary(store) {
  const [books, files, positions, bookmarks, highlights, stats, settings] = await Promise.all(
    ['books', 'files', 'positions', 'bookmarks', 'highlights', 'stats', 'settings'].map((n) => all(store, n)));
  const blobs = new Map(files.map((f) => [f.id, f.blob]));
  const kept = books.filter((b) => blobs.has(b.id));
  const manifest = buildManifest({ books: kept, positions, bookmarks, highlights, stats, settings });
  const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest) }];
  for (const [i, b] of manifest.books.entries()) {
    entries.push({ name: b.file, data: blobs.get(b.meta.id) });
    if (b.cover) entries.push({ name: b.cover, data: kept[i].cover });
  }
  return zipBlob(entries);
}

/**
 * Merge a .readpane file into the library. estimate = navigator.storage.estimate() result.
 * Returns { books, kept, bookmarks, highlights } counts, or throws LibraryFileError:
 * 'not-library' | 'newer' | 'no-room' (with .need bytes and .free bytes).
 */
export async function importLibrary(store, file, estimate) {
  let zip;
  let manifest;
  try {
    zip = await openZip(file);
    manifest = JSON.parse(await zip.text('manifest.json'));
  } catch { throw new LibraryFileError('not-library'); }

  const [books, positions, bookmarks, highlights, stats, settings] = await Promise.all(
    ['books', 'positions', 'bookmarks', 'highlights', 'stats', 'settings'].map((n) => all(store, n)));
  const plan = planImport(manifest, {
    bookIds: new Set(books.map((b) => b.id)),
    positions: new Map(positions.map((p) => [p.bookId, p])),
    bookmarks, highlights,
    stats: new Map(stats.map((s) => [s.bookId, s])),
    settingKeys: new Set(settings.map((s) => s.key)),
  });
  const addable = plan.books.filter((b) => zip.has(b.file));
  const need = addable.reduce((a, b) => a + (zip.entry(b.file).size ?? 0), 0);
  if (!hasRoom(estimate, need)) {
    throw Object.assign(new LibraryFileError('no-room'), { need, free: Math.max(0, (estimate?.quota ?? 0) - (estimate?.usage ?? 0)) });
  }

  // One transaction per book: a failure (quota) leaves whole books, never half of one.
  const added = new Set();
  for (const b of addable) {
    const blob = await zip.blob(b.file);
    const cover = b.cover && zip.has(b.cover) ? await zip.blob(b.cover) : null;
    const tx = store.db.transaction(['books', 'files'], 'readwrite');
    tx.objectStore('books').put({ ...b.meta, cover, size: blob.size });
    tx.objectStore('files').put({ id: b.meta.id, blob });
    await done(tx);
    added.add(b.meta.id);
    const bookFileName = b.meta.fileName || b.file;
    saveBookPhysically(new File([blob], bookFileName, { type: blob.type }));
  }
  const present = (id) => added.has(id) || books.some((b) => b.id === id);
  const keep = (list) => list.filter((r) => present(r.bookId));
  const settingFor = (s) => !s.key.startsWith('book:') || present(s.key.slice(5));
  const marks = keep(plan.bookmarks);
  const hls = keep(plan.highlights);
  const tx = store.db.transaction(['positions', 'bookmarks', 'highlights', 'stats', 'settings'], 'readwrite');
  for (const p of keep(plan.positions)) tx.objectStore('positions').put(p);
  for (const m of marks) tx.objectStore('bookmarks').put(m);
  for (const h of hls) tx.objectStore('highlights').put(h);
  for (const s of keep(plan.stats)) tx.objectStore('stats').put(s);
  for (const s of plan.settings.filter(settingFor)) tx.objectStore('settings').put(s);
  await done(tx);
  return { books: added.size, kept: plan.kept, bookmarks: marks.length, highlights: hls.length };
}
