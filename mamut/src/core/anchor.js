// DOM side of the position model (position.js is the pure side): find the
// first character at a reading edge, and find where a position is laid out.
//
// Both views share one algorithm through a `key(rect)` function that maps a
// client rect to a monotonic "reading coordinate" (its end along the flow):
//   continuous - rect.bottom (viewport y)
//   paginated  - column * columnHeight + bottom within the column
// capture() returns the first character whose key is > edge.

import { pathOf, walkPath } from './position.js';

function textNodes(el) {
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  return out;
}

const range = () => document.createRange();

function charRect(node, i) {
  const len = node.length;
  if (!len) return null;
  const idx = Math.min(Math.max(0, i), len - 1);
  const rectAt = (k) => {
    const r = range();
    r.setStart(node, k);
    r.setEnd(node, Math.min(k + 1, len));
    const rects = r.getClientRects();
    for (let j = rects.length - 1; j >= 0; j--) {
      if (rects[j].width > 0 || rects[j].height > 0) return rects[j];
    }
    return null;
  };
  const direct = rectAt(idx);
  if (direct) return direct;
  // Collapsed whitespace (\n, indentation spaces) has no client rect: scan nearby characters
  // so binary search in capture() and lookup in locate() never fail on pretty-printed HTML.
  for (let step = 1; idx + step < len || idx - step >= 0; step++) {
    if (idx + step < len) {
      const f = rectAt(idx + step);
      if (f) return f;
    }
    if (idx - step >= 0) {
      const b = rectAt(idx - step);
      if (b) return b;
    }
  }
  return null;
}

const isBlockish = (el) => {
  const d = getComputedStyle(el).display;
  return d !== 'inline' && d !== 'contents' && d !== 'none';
};

function captureTextIn(root, el, edge, key) {
  let base = 0;
  for (const node of textNodes(el)) {
    const len = node.length;
    if (!len) continue;
    const whole = range();
    whole.selectNodeContents(node);
    const nr = whole.getBoundingClientRect();
    if ((!nr.width && !nr.height) || key(nr) <= edge) { base += len; continue; }
    let lo = 0, hi = len - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = charRect(node, mid);
      if (r && key(r) > edge) { hit = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (hit >= 0) return { path: pathOf(root, el), offset: base + hit };
    base += len;
  }
  return null;
}

/**
 * First character past `edge` inside root. Descends block children by binary
 * search on key(boundingRect), then binary-searches characters.
 * Returns { path, offset } (position.js model, relative to root).
 */
export function capture(root, edge, key) {
  let el = root;
  let parentKids = null;
  let parentHit = -1;
  for (;;) {
    const kids = [...el.children].filter(isBlockish);
    if (!kids.length) break;
    // If el also has direct non-whitespace text nodes mixed with block children (e.g. an <img> inside a <p>),
    // keep el as the target so its own text is searched in document order.
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) break;
    let lo = 0, hi = kids.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = kids[mid].getBoundingClientRect();
      if ((r.width || r.height) && key(r) > edge) { hit = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (hit < 0) break;
    parentKids = kids;
    parentHit = hit;
    el = kids[hit];
  }
  const found = captureTextIn(root, el, edge, key);
  if (found) return found;
  // If a multi-column block's bounding box slightly crossed `edge` due to bottom margin/descenders
  // while all its characters were before `edge`, check the next block sibling.
  if (parentKids && parentHit >= 0 && parentHit + 1 < parentKids.length) {
    const nextEl = parentKids[parentHit + 1];
    const nextFound = captureTextIn(root, nextEl, edge, key);
    if (nextFound) return nextFound;
  }
  // No text past the edge (a tall image, an empty box): how far down it the edge is.
  const r = el.getBoundingClientRect();
  const inner = r.height ? Math.min(1, Math.max(0, 1 - (key(r) - edge) / r.height)) : 0;
  return inner > 0 ? { path: pathOf(root, el), offset: 0, inner } : { path: pathOf(root, el), offset: 0 };
}

/**
 * Client rect of the character at pos, or of its element when it has no laid-out
 * text (then `inner` moves top down the element).
 */
export function locate(root, { path, offset, inner = 0 }) {
  const el = walkPath(root, path);
  let left = offset;
  for (const node of textNodes(el)) {
    if (left < node.length) {
      // Collapsed whitespace has no box: take the next visible character.
      for (let i = Math.max(0, left); i < node.length; i++) {
        const r = charRect(node, i);
        if (r) return r;
      }
      left = 0;
      continue;
    }
    left -= node.length;
  }
  const r = el.getBoundingClientRect();
  return inner > 0 ? new DOMRect(r.left, r.top + inner * r.height, r.width, r.height * (1 - inner)) : r;
}

/** Element with this id inside root (fragment links, ToC entries). */
export function byId(root, id) {
  if (!id) return null;
  return root.querySelector(`[id="${CSS.escape(id)}"]`) ?? root.querySelector(`a[name="${CSS.escape(id)}"]`);
}

/** {path, offset} of a DOM boundary (node, offset) inside root: the position.js model of a selection end. */
export function pointOf(root, node, offset) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  const r = range();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return { path: pathOf(root, el), offset: r.toString().length };
}

/** Inverse of pointOf: the [text node, offset] at {path, offset} (clamped to the element's text). */
export function boundaryAt(root, { path, offset }) {
  const el = walkPath(root, path);
  let left = offset;
  let last = null;
  for (const node of textNodes(el)) {
    if (left <= node.length) return [node, left];
    left -= node.length;
    last = node;
  }
  return last ? [last, last.length] : [el, 0];
}
