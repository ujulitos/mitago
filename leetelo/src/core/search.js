// Full-text search across the spine. PURE: works on plain text blocks, so it
// is unit-tested in node over the fixture books.
//
// A section's text is split into blocks: { path, text }, where `path` is the
// element path used by position.js and `text` is that element's textContent.
// A hit is therefore directly a position: { spine, path, offset, frac }.
// Matching ignores case, diacritics and whitespace runs (line breaks in the
// source), and maps back to exact offsets in the original text.

const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);

const nodeText = (n) => (typeof n === 'string' ? n : n.nodeType === 3 ? n.data : null);

/** Text that belongs to el itself (text nodes or inline children), not to its block children. */
function hasOwnText(el) {
  for (const n of el.childNodes) {
    const t = nodeText(n);
    if (t !== null) { if (t.trim()) return true; continue; }
    if (n.localName && !BLOCK.has(n.localName) && n.textContent.trim()) return true;
  }
  return false;
}

/** Split a section root (DOM element or xml.js element) into searchable blocks, document order. */
export function blocksOf(root) {
  const out = [];
  const visit = (el, path) => {
    const kids = [...el.children];
    if (kids.some((k) => BLOCK.has(k.localName)) && !hasOwnText(el)) {
      kids.forEach((k, i) => visit(k, [...path, i]));
      return;
    }
    const text = el.textContent;
    if (text.trim()) out.push({ path, text });
  };
  visit(root, []);
  return out;
}

const isSpace = (c) => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || (c >= 0x2000 && c <= 0x200a) || c === 0x3000;
const MARKS = /\p{M}/gu;

/**
 * Fold for matching: lower case, no diacritics, whitespace runs -> one space.
 * `withMap` also returns map[foldedIndex] = original index (map[s.length] = text.length).
 */
export function fold(text, withMap = false) {
  let s = '';
  const map = withMap ? [] : null;
  let space = false;
  for (let i = 0; i < text.length;) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) {
      if (!space) { s += ' '; map?.push(i); space = true; }
      i++;
      continue;
    }
    space = false;
    if (c < 0x80) {
      s += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i];
      map?.push(i);
      i++;
      continue;
    }
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const f = ch.normalize('NFD').replace(MARKS, '').toLowerCase() || ch;
    s += f;
    if (map) for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  map?.push(text.length);
  return withMap ? { s, map } : s;
}

/** Prepare one section for searching. Keep the result; folding is the costly part. */
export function indexSection(spine, blocks) {
  let start = 0;
  const out = blocks.map((b) => {
    const r = { path: b.path, text: b.text, folded: fold(b.text), start };
    start += b.text.length;
    return r;
  });
  return { spine, blocks: out, chars: start };
}

const squash = (t) => t.replace(/\s+/g, ' ');

// First (or, fromEnd, last) ~n characters of t, cut at a word boundary.
function clip(t, n, fromEnd) {
  t = squash(t).trim();
  if (t.length <= n) return t;
  if (fromEnd) { const sp = t.indexOf(' ', t.length - n); return '…' + t.slice(sp > 0 ? sp + 1 : t.length - n); }
  const sp = t.lastIndexOf(' ', n);
  return t.slice(0, sp > 0 ? sp : n) + '…';
}

function snippet(text, start, end, radius, prev = '', next = '') {
  let a = Math.max(0, start - radius);
  let b = Math.min(text.length, end + radius);
  // Prefer word boundaries for the cut points.
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp > 0 && sp < start) a = sp + 1; }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > end) b = sp; }
  let before = (a > 0 ? '…' : '') + squash(text.slice(a, start)).trimStart();
  let after = squash(text.slice(end, b)).trimEnd() + (b < text.length ? '…' : '');
  // A short block (a heading) borrows context from its neighbours.
  const roomBefore = radius - (start - a), roomAfter = radius - (b - end);
  if (a === 0 && prev.trim() && roomBefore > 10) before = `${clip(prev, roomBefore, true)} ${before}`;
  if (b === text.length && next.trim() && roomAfter > 10) after = `${after} ${clip(next, roomAfter, false)}`;
  return { before, match: squash(text.slice(start, end)), after };
}

/**
 * Search indexed sections (from indexSection) for `query`.
 * Returns { hits: [{ spine, path, offset, length, frac, snippet }], total, truncated }.
 */
export function search(sections, query, { limit = 500, radius = 40 } = {}) {
  const q = fold(String(query)).trim();
  const hits = [];
  let total = 0;
  if (!q) return { hits, total, truncated: false };
  for (const sec of sections) {
    for (const [i, b] of sec.blocks.entries()) {
      let at = b.folded.indexOf(q);
      if (at < 0) continue;
      const { map } = fold(b.text, true);
      for (; at >= 0; at = b.folded.indexOf(q, at + q.length)) {
        total++;
        if (hits.length >= limit) continue;
        const start = map[at];
        const end = map[at + q.length];
        hits.push({
          spine: sec.spine, path: b.path, offset: start, length: end - start,
          frac: sec.chars ? (b.start + start) / sec.chars : 0,
          snippet: snippet(b.text, start, end, radius, sec.blocks[i - 1]?.text, sec.blocks[i + 1]?.text),
        });
      }
    }
  }
  return { hits, total, truncated: total > hits.length };
}
