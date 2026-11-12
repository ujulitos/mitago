// Reader UI decisions that need no DOM. PURE, unit-tested in node.

const EXT_PROBLEMS = {
  pdf: 'pdf', acsm: 'acsm', mobi: 'mobi', azw: 'mobi', azw3: 'mobi', kfx: 'mobi', prc: 'mobi',
  txt: 'text', md: 'text', rtf: 'text', doc: 'other-type', docx: 'other-type', odt: 'other-type',
  djvu: 'other-type', html: 'other-type', htm: 'other-type',
};
// Not here: fb2, fbz, cbz, zip (opened), cbr/cb7 (the bytes decide: many .cbr files are ZIPs).

/**
 * A file we can name the problem of before parsing it: by extension (a .txt is
 * "a text file", not "not a ZIP"), or empty. null = parse it; the parser sniffs the
 * bytes and names everything else (pdf, acsm, mobi, not-zip, corrupt, drm, ...).
 */
export function fileProblem(file) {
  if (!file) return 'no-file';
  if (file.size === 0) return 'empty';
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  return (ext && EXT_PROBLEMS[ext]) ?? null;
}

/**
 * Codes whose messages are still pending translation (i18n/pending/formats.json) show
 * the nearest existing message meanwhile: damaged FB2/CBZ -> damaged, RAR/7-Zip -> wrong type.
 */
export const ERROR_FALLBACK = { 'fb2-corrupt': 'corrupt', 'cbz-corrupt': 'corrupt', 'cbz-empty': 'not-epub', cbr: 'other-type', cb7: 'other-type' };

/** Stable error code for anything an open can throw. */
export function errorCode(e) {
  if (e?.code && typeof e.code === 'string') return e.code;
  if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message ?? '')) return 'quota';
  if (e?.name === 'NotReadableError' || e?.name === 'NotFoundError') return 'unreadable';
  return 'unexpected';
}

/**
 * Room to keep a book of `bytes` in the library? estimate = navigator.storage.estimate()
 * (null/partial = unknown -> yes; the save itself still catches QuotaExceededError).
 * Keeps a margin: the stored copy, its cover and IndexedDB overhead (x1.1 + 8 MB).
 */
export function hasRoom(estimate, bytes) {
  const { usage, quota } = estimate ?? {};
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return true;
  return quota - usage >= bytes * 1.1 + 8 * 1024 * 1024;
}

/** The ToC entry for a position: the first entry of its section, else the last one before it. */
export function tocIndexAt(toc, pos) {
  if (!toc?.length || !pos) return -1;
  const first = toc.findIndex((e) => e.spine === pos.spine);
  if (first >= 0) return first;
  return toc.findLastIndex((e) => e.spine >= 0 && e.spine < pos.spine);
}

/** Start of each section as a 0..1 fraction of the book (same weights as position.progress). */
export function sectionStarts(sizes) {
  const total = sizes.reduce((a, b) => a + Math.max(1, b), 0);
  let acc = 0;
  return sizes.map((s) => { const at = acc / total; acc += Math.max(1, s); return at; });
}

/**
 * Chapter ticks for the progress bar: top-level ToC entries (all entries when the
 * ToC is flat), one per section, never closer than minGap, at most max.
 */
export function chapterTicks(toc, sizes, { max = 120, minGap = 0.004 } = {}) {
  const starts = sectionStarts(sizes);
  const top = toc.filter((e) => e.spine >= 0 && e.depth === 0);
  const entries = (top.length >= 2 ? top : toc.filter((e) => e.spine >= 0));
  const out = [];
  let last = -1;
  for (const e of entries) {
    const at = starts[e.spine] ?? 0;
    if (out.length && (e.spine === out[out.length - 1].spine || at - last < minGap)) continue;
    out.push({ at, label: e.label, spine: e.spine, href: e.href });
    last = at;
  }
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

/** Whole percent for display; 100 only at the very end. */
export function percent(p) {
  const n = Math.floor(Math.min(1, Math.max(0, p || 0)) * 100);
  return p >= 0.9995 ? 100 : Math.min(99, n);
}

export const SESSION_MS = 5 * 60 * 1000;

/**
 * Reading sessions (support milestones): a book read for >= 5 active minutes in a
 * day counts once. state = { day, ms: { [bookId]: ms }, counted: [bookId] }.
 * Returns { state, counted } where counted is true exactly once per book per day.
 */
export function addReadingTime(state, bookId, day, ms) {
  const s = state?.day === day ? state : { day, ms: {}, counted: [] };
  const total = (s.ms[bookId] ?? 0) + Math.max(0, ms);
  const next = { day, ms: { ...s.ms, [bookId]: total }, counted: s.counted };
  if (total >= SESSION_MS && !s.counted.includes(bookId)) return { state: { ...next, counted: [...s.counted, bookId] }, counted: true };
  return { state: next, counted: false };
}

/** Local calendar day number (sessions roll over at the reader's midnight). */
export const localDay = (now, offsetMin = new Date(now).getTimezoneOffset()) => Math.floor((now - offsetMin * 60000) / 86400000);
