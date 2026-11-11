// Reading position model. PURE: no DOM, no layout, unit-tested in node.
//
//   { spine, path, offset, frac }
//   spine  - spine index
//   path   - element-child indices from the section root (<body>) to an
//            element, or null for a coarse position (only `frac` is known)
//   offset - character offset into that element's textContent
//   frac   - 0..1 through the section; informational (progress display,
//            scrubbing) and the fallback when `path` cannot be resolved
//   inner  - optional, 0..1 down the element when it has no text at the
//            reading edge (a tall image): without it the place snaps to its top
//
// Never a scroll offset, so it survives font, width, mode and engine changes.

const isInt = (n) => Number.isInteger(n) && n >= 0;
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export const START = Object.freeze({ spine: 0, path: [], offset: 0, frac: 0 });

/** Validate untrusted input (IDB, URL, older versions) into a position, or null. */
export function normalize(raw, spineLength = Infinity) {
  if (!raw || typeof raw !== 'object' || !isInt(raw.spine)) return null;
  if (raw.spine >= spineLength) return { spine: spineLength - 1, path: null, offset: 0, frac: 1 };
  const path = Array.isArray(raw.path) && raw.path.every(isInt) ? [...raw.path] : null;
  const pos = { spine: raw.spine, path, offset: path && isInt(raw.offset) ? raw.offset : 0, frac: clamp01(raw.frac) };
  if (path && clamp01(raw.inner) > 0) pos.inner = clamp01(raw.inner);
  return pos;
}

/** Compact, versioned string form ("1:spine:path.dotted:offset:frac[:inner]"). */
export function serialize(pos) {
  const p = pos.path ? pos.path.join('.') : '~';
  const inner = pos.path && pos.inner > 0 ? `:${clamp01(pos.inner).toFixed(5)}` : '';
  return `1:${pos.spine}:${p}:${pos.offset}:${clamp01(pos.frac).toFixed(5)}${inner}`;
}

export function parse(str, spineLength) {
  const m = /^1:(\d+):(~|\d+(?:\.\d+)*|):(\d+):([\d.]+)(?::([\d.]+))?$/.exec(String(str));
  if (!m) return null;
  const path = m[2] === '~' ? null : m[2] === '' ? [] : m[2].split('.').map(Number);
  return normalize({ spine: Number(m[1]), path, offset: Number(m[3]), frac: Number(m[4]), inner: Number(m[5] ?? 0) }, spineLength);
}

/** Document order: <0 if a is before b. Coarse positions compare by frac. */
export function compare(a, b) {
  if (a.spine !== b.spine) return a.spine - b.spine;
  if (!a.path || !b.path) return (a.frac ?? 0) - (b.frac ?? 0);
  const n = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < n; i++) if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
  // An ancestor's text contains its descendants' text, so offsets in a shorter
  // path are not comparable with a longer one; treat the ancestor as earlier.
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.offset - b.offset || (a.inner ?? 0) - (b.inner ?? 0);
}

export const samePlace = (a, b) => !!a && !!b && compare(a, b) === 0 && (!!a.path === !!b.path);

/** Cumulative weights: section sizes (uncompressed bytes) as the book's length measure. */
function cumulative(sizes) {
  const cum = [0];
  for (const s of sizes) cum.push(cum[cum.length - 1] + Math.max(1, s));
  return cum;
}

/** Whole-book progress 0..1 for a position, weighting sections by size. */
export function progress(pos, sizes) {
  if (!sizes.length) return 0;
  const cum = cumulative(sizes);
  const i = Math.min(Math.max(0, pos.spine), sizes.length - 1);
  if (i === sizes.length - 1 && (pos.frac >= 0.999 || pos.frac === 1)) return 1;
  const p = (cum[i] + clamp01(pos.frac) * (cum[i + 1] - cum[i])) / cum[sizes.length];
  return p >= 0.9995 ? 1 : clamp01(p);
}

/** Inverse of progress(): a coarse position at `fraction` of the book. */
export function atProgress(fraction, sizes) {
  if (fraction >= 0.9995) return { spine: Math.max(0, sizes.length - 1), path: null, offset: 0, frac: 1 };
  const cum = cumulative(sizes);
  const target = clamp01(fraction) * cum[sizes.length];
  let lo = 0, hi = sizes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] <= target) lo = mid + 1; else hi = mid;
  }
  const frac = (target - cum[lo]) / (cum[lo + 1] - cum[lo]);
  return { spine: lo, path: null, offset: 0, frac: clamp01(frac) };
}

/** Element-child index path from root to el (any tree with parentElement/children). */
export function pathOf(root, el) {
  const path = [];
  while (el && el !== root) {
    const parent = el.parentElement;
    if (!parent) return null; // el is not inside root
    path.unshift(Array.prototype.indexOf.call(parent.children, el));
    el = parent;
  }
  return el === root ? path : null;
}

/** Walk a path, clamping to what exists (book edits, sanitizer drift). */
export function walkPath(root, path) {
  let el = root;
  for (const i of path ?? []) {
    const next = el.children[Math.min(i, el.children.length - 1)];
    if (!next) break;
    el = next;
  }
  return el;
}
