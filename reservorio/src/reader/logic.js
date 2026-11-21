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
 * Chapter ticks for the progress bar: every valid ToC entry (all depths, including
 * fragment anchors inside shared spine sections), ordered along the book and deduplicated
 * only when two entries land virtually on top of each other.
 */
export function chapterTicks(toc, sizes, { max = 200, minGap = 0.0025 } = {}) {
  if (!Array.isArray(toc) || !toc.length || !Array.isArray(sizes) || !sizes.length) return [];
  const starts = sectionStarts(sizes);
  const entries = toc.filter((e) => e && e.spine >= 0 && e.spine < starts.length);
  if (!entries.length) return [];

  const bySpine = new Map();
  for (const e of entries) {
    let list = bySpine.get(e.spine);
    if (!list) { list = []; bySpine.set(e.spine, list); }
    list.push(e);
  }

  const raw = [];
  for (const e of entries) {
    const start = starts[e.spine] ?? 0;
    const nextStart = e.spine + 1 < starts.length ? starts[e.spine + 1] : 1;
    const span = Math.max(0, nextStart - start);
    let frac = 0;
    if (Number.isFinite(e.spineFrac) && e.spineFrac > 0) {
      frac = Math.min(0.999, Math.max(0, e.spineFrac));
    } else if (e.frag) {
      const group = bySpine.get(e.spine);
      if (group && group.length > 1) {
        const idx = group.indexOf(e);
        if (idx > 0) frac = idx / group.length;
      }
    }
    const at = Math.min(1, Math.max(0, start + frac * span));
    raw.push({ at, label: e.label, spine: e.spine, href: e.href });
  }

  raw.sort((a, b) => a.at - b.at);
  const out = [];
  let last = -1;
  for (const item of raw) {
    if (out.length && item.at - last < minGap) continue;
    out.push(item);
    last = item.at;
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

/** Normalize title or author text for filename-independent duplicate matching. */
export function normalizeBookText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function creatorTokenKey(s) {
  const norm = normalizeBookText(s);
  if (!norm) return '';
  return [...new Set(norm.split(' '))].sort().join(' ');
}

/**
 * Find an existing library book matching a candidate even when filenames differ
 * or the file was repackaged/converted. Matches exact content id first, then
 * normalized (title + order-insensitive creator tokens), or (title + spineLength)
 * when neither entry has creator metadata.
 */
export function findDuplicateBook(existingBooks, candidate) {
  if (!Array.isArray(existingBooks) || !existingBooks.length || !candidate) return null;
  if (candidate.id) {
    const byId = existingBooks.find((b) => b?.id === candidate.id);
    if (byId) return byId;
  }

  const candTitle = normalizeBookText(candidate.title);
  if (!candTitle) return null;
  const candAuthor = creatorTokenKey(candidate.creator);
  const candSpine = Number(candidate.spineLength) || 0;

  for (const b of existingBooks) {
    if (!b || normalizeBookText(b.title) !== candTitle) continue;
    const bAuthor = creatorTokenKey(b.creator);
    if (candAuthor && bAuthor) {
      if (candAuthor === bAuthor) return b;
      continue;
    }
    if (!candAuthor && !bAuthor && candSpine > 0 && Number(b.spineLength) === candSpine) {
      return b;
    }
  }
  return null;
}
