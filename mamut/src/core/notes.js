// Highlights and notes: book order and export (Markdown, JSON). PURE: no DOM, unit-tested.
//
// A highlight as stored (store.js 'highlights'):
//   { id, bookId, start, end, text, note, color, progress, createdAt, updatedAt }
//   start, end - position.js serialize() strings ("1:spine:path:offset:frac"), end exclusive;
//                frac is the exact share of the chapter's characters before the point.
//   color      - one of COLORS; note - '' when none; progress - 0..1 through the book.
//
// JSON export: format "readpane-highlights", version 1. Stable: keys always in this order,
// highlights in book order, dates ISO 8601, unknown colours exported as given.
//   { "format": "readpane-highlights", "version": 1, "exportedAt": "...",
//     "book": { "id", "title", "creator", "language" },
//     "highlights": [ { "start", "end", "chapter", "text", "note", "color", "progress", "createdAt", "updatedAt" } ] }

import { parse, compare } from './position.js';

export const COLORS = ['yellow', 'green', 'blue', 'pink'];
export const FORMAT = 'readpane-highlights';

const NOWHERE = { spine: Number.MAX_SAFE_INTEGER, path: null, offset: 0, frac: 0 };
const order = (a, b) => a.spine - b.spine || a.frac - b.frac || compare(a, b);

/** Book order: by start, then by end. A copy; unparseable positions go last. */
export function sortHighlights(list) {
  const keyed = list.map((h) => ({ h, s: parse(h.start) ?? NOWHERE, e: parse(h.end) ?? NOWHERE }));
  keyed.sort((a, b) => order(a.s, b.s) || order(a.e, b.e));
  return keyed.map((k) => k.h);
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** At most `max` characters, cut at a word where possible. */
export function snippet(text, max = 160) {
  const s = oneLine(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// A line that would start a heading, list, quote or rule in Markdown keeps its literal text.
const literal = (line) => line.replace(/^(\s*)([#>+*-]|\d+[.)])(?=\s|$)/, '$1\\$2');

const spineOf = (h) => parse(h.start)?.spine ?? -1;

/**
 * Markdown: "# Title", the author in italics, then per chapter "## Chapter", each
 * highlight as a "> quote" with its note (as written) below.
 * book { title, creator }; chapterOf(spine) -> label.
 */
export function toMarkdown(book, highlights, { chapterOf = (i) => `${i + 1}` } = {}) {
  const out = [`# ${literal(oneLine(book.title))}`];
  if (oneLine(book.creator)) out.push('', `_${oneLine(book.creator)}_`);
  let chapter = null;
  for (const h of sortHighlights(highlights)) {
    const label = oneLine(chapterOf(spineOf(h)));
    if (label !== chapter) { out.push('', `## ${literal(label)}`); chapter = label; }
    out.push('', `> ${literal(oneLine(h.text))}`);
    const note = String(h.note ?? '').replace(/\r\n?/g, '\n').trim();
    if (note) out.push('', note);
  }
  return `${out.join('\n')}\n`;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** JSON export (shape at the top of this file), as text. */
export function toJson(book, highlights, { chapterOf = (i) => `${i + 1}`, now = Date.now() } = {}) {
  const doc = {
    format: FORMAT,
    version: 1,
    exportedAt: iso(now),
    book: { id: book.id ?? null, title: book.title ?? '', creator: book.creator ?? '', language: book.language ?? '' },
    highlights: sortHighlights(highlights).map((h) => ({
      start: h.start,
      end: h.end,
      chapter: chapterOf(spineOf(h)),
      text: h.text ?? '',
      note: h.note ?? '',
      color: h.color ?? COLORS[0],
      progress: Number.isFinite(h.progress) ? Math.round(h.progress * 1e5) / 1e5 : null,
      createdAt: iso(h.createdAt),
      updatedAt: iso(h.updatedAt),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** A safe download name: "<title> - highlights.<ext>". */
export function exportName(title, ext) {
  const base = oneLine(String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')).replace(/^[.\s]+/, '').slice(0, 80).trim();
  return `${base || 'book'} - highlights.${ext}`;
}
