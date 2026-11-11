// The library file (.readpane): a STORE-only ZIP of the original book files,
// their covers and manifest.json. PURE: builds the manifest and plans a merge;
// libio.js does the IndexedDB and Blob work.
//
// manifest.json:
//   { format: 'readpane-library', version: 1, exportedAt, settings: { key: value },
//     books: [{ meta, file, cover?, position?, bookmarks, highlights, stats?, settings? }] }
// meta is the books record without its cover Blob; file/cover are entry names in the ZIP.

import { mergeStats } from './stats.js';

export const FORMAT = 'readpane-library';
export const EXTENSION = 'readpane';

const bookFile = (meta) => `books/${meta.id}.${/\.([a-z0-9]{1,5})$/i.exec(meta.fileName ?? '')?.[1]?.toLowerCase() ?? 'epub'}`;
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Everything the stores hold -> the manifest. settings = [{ key, value }]. */
export function buildManifest({ books, positions = [], bookmarks = [], highlights = [], stats = [], settings = [] }, exportedAt = Date.now()) {
  const by = (list, key = 'bookId') => list.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), r]), new Map());
  const pos = by(positions);
  const marks = by(bookmarks);
  const hls = by(highlights);
  const st = by(stats);
  const own = new Map(settings.filter((s) => s.key.startsWith('book:')).map((s) => [s.key.slice(5), s.value]));
  return {
    format: FORMAT,
    version: 1,
    exportedAt,
    settings: Object.fromEntries(settings.filter((s) => !s.key.startsWith('book:')).map((s) => [s.key, s.value])),
    books: books.map((b) => ({
      meta: without(b, 'cover'),
      file: bookFile(b),
      cover: b.cover ? `covers/${b.id}.img` : undefined,
      position: pos.get(b.id)?.[0],
      bookmarks: (marks.get(b.id) ?? []).map((m) => without(m, 'id')),
      highlights: (hls.get(b.id) ?? []).map((h) => without(h, 'id')),
      stats: st.get(b.id)?.[0],
      settings: own.get(b.id),
    })),
  };
}

/** A place as a stable string (key order does not matter). */
export function placeKey(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(placeKey).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${k}:${placeKey(v[k])}`).join(',')}}`;
}

export class LibraryFileError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Throws LibraryFileError('not-library' | 'newer') for a manifest we cannot read. */
export function checkManifest(m) {
  if (m?.format !== FORMAT || !Array.isArray(m.books)) throw new LibraryFileError('not-library');
  if (m.version > 1) throw new LibraryFileError('newer');
  return m;
}

/**
 * What an import adds to the local library. local = { bookIds: Set, positions: Map,
 * bookmarks: [], highlights: [], stats: Map, settingKeys: Set }.
 * Books: by id, a book already here is kept. Positions: the newer updatedAt wins.
 * Bookmarks: unique by book + place; highlights by book + start + end. Stats: merged.
 * Settings (global and per book): only those not set here.
 */
export function planImport(manifest, local) {
  const m = checkManifest(manifest);
  const plan = { books: [], positions: [], bookmarks: [], highlights: [], stats: [], settings: [], bytes: 0, kept: 0 };
  const markKeys = new Set(local.bookmarks.map((b) => `${b.bookId}|${placeKey(b.pos)}`));
  const hlKeys = new Set(local.highlights.map((h) => `${h.bookId}|${placeKey(h.start)}|${placeKey(h.end)}`));
  for (const b of m.books) {
    const id = b.meta?.id;
    if (!id || !b.file) continue;
    if (local.bookIds.has(id)) plan.kept++;
    else { plan.books.push(b); plan.bytes += b.meta.size ?? 0; }
    const here = local.positions.get(id);
    if (b.position && (!here || (b.position.updatedAt ?? 0) > (here.updatedAt ?? 0))) plan.positions.push({ ...b.position, bookId: id });
    for (const mk of b.bookmarks ?? []) {
      const key = `${id}|${placeKey(mk.pos)}`;
      if (!markKeys.has(key)) { markKeys.add(key); plan.bookmarks.push({ ...mk, bookId: id }); }
    }
    for (const h of b.highlights ?? []) {
      const key = `${id}|${placeKey(h.start)}|${placeKey(h.end)}`;
      if (!hlKeys.has(key)) { hlKeys.add(key); plan.highlights.push({ ...h, bookId: id }); }
    }
    if (b.stats) plan.stats.push({ ...mergeStats(local.stats.get(id), { ...b.stats, bookId: id }), bookId: id });
    if (b.settings !== undefined && !local.settingKeys.has(`book:${id}`)) plan.settings.push({ key: `book:${id}`, value: b.settings });
  }
  for (const [key, value] of Object.entries(m.settings ?? {})) {
    if (!key.startsWith('book:') && !local.settingKeys.has(key)) plan.settings.push({ key, value });
  }
  return plan;
}
