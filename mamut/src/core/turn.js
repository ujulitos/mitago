// Page-turn effects for the paginated view (none | slide | curl | fade | scroll).
//
// Before a turn, the page being left is copied into a layer exactly over (or under)
// the view; the view then moves to the new page underneath, and the copy and/or the
// view are animated with WAAPI (transform and opacity run on the compositor; the
// curl's fold is a registered custom property that drives clip-paths). The new page
// is laid out before anything moves, so no frame is ever blank, and every effect
// ends with its layers removed and the view untouched.

import { capture } from './anchor.js';
import { walkPath } from './position.js';

export const EFFECTS = ['none', 'fade', 'scroll'];
const TIMING = {
  slide: { duration: 260, easing: 'cubic-bezier(.2, .7, .3, 1)' },
  scroll: { duration: 360, easing: 'cubic-bezier(.45, .05, .35, 1)' },
  fade: { duration: 150, easing: 'ease-out' },
  curl: { duration: 380, easing: 'cubic-bezier(.4, .1, .35, 1)' },
};

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Curl geometry, from t = --rp-turn (0 flat .. 1 turned) and the page width --rp-w: the
// fold runs from (xt, top) to (xb, bottom), bottom corner leading. The page keeps what
// is left of the fold; the flap (the page's back) is the peeled part mirrored across it.
// Shading gradients run across the fold (--rp-ang); --tf is the fold's place on their
// line (--rp-k, --rp-l: the gradient-line scale and length, set per page size).
const CSS_TEXT = `
.rp-turn { position: absolute; overflow: hidden; pointer-events: none; contain: strict; }
.rp-turn-page { position: absolute; inset: 0; overflow: hidden; background: var(--rp-turn-bg); }
.rp-turn-page > .rp-section { display: block; width: 100%; height: 100%; }
.rp-turn-clip { position: absolute; inset: 0; }
.rp-turn-clip > .rp-turn-slice { position: absolute; top: 0; }
.rp-turn-moving { box-shadow: 0 0 28px rgba(0, 0, 0, 0.22); }
.rp-curling, .rp-curl-deco {
  --xt: calc((1 - var(--rp-turn)) * 1.2 * var(--rp-w)); --xb: calc(var(--xt) - 0.2 * var(--rp-w)); --xm: calc(var(--xt) - 0.1 * var(--rp-w));
}
.rp-curl-deco { --tf: calc((var(--xm) - 0.5 * var(--rp-w)) * var(--rp-k) + 0.5 * var(--rp-l)); --fw: calc((var(--rp-w) - var(--xm)) * var(--rp-k)); }
.rp-curling { clip-path: polygon(0 0, var(--xt) 0, var(--xb) 100%, 0 100%); }
.rp-curling.rp-mirror { clip-path: polygon(100% 0, calc(100% - var(--xt)) 0, calc(100% - var(--xb)) 100%, 100% 100%); }
.rp-curl-deco.rp-mirror { transform: scaleX(-1); }
.rp-curl-deco > * { position: absolute; inset: 0; }
.rp-curl-shade {
  clip-path: polygon(var(--xt) 0, 100% 0, 100% 100%, var(--xb) 100%); opacity: calc(1 - var(--rp-turn) * var(--rp-turn));
  background: linear-gradient(var(--rp-ang), rgba(0, 0, 0, 0.3) var(--tf), rgba(0, 0, 0, 0) calc(var(--tf) + 110px));
}
.rp-curl-dim {
  clip-path: polygon(0 0, var(--xt) 0, var(--xb) 100%, 0 100%);
  background: linear-gradient(var(--rp-ang), rgba(0, 0, 0, 0) calc(var(--tf) - 60px), rgba(0, 0, 0, 0.12) var(--tf));
}
.rp-curl-lift { filter: drop-shadow(-5px 2px 9px rgba(0, 0, 0, 0.3)); }
.rp-curl-flap {
  position: absolute; inset: 0;
  clip-path: polygon(var(--xt) 0, calc(2 * var(--xt) - var(--rp-w)) 0, calc(2 * var(--xb) - var(--rp-w)) 100%, var(--xb) 100%);
  background:
    linear-gradient(var(--rp-ang), rgba(0, 0, 0, 0.08) calc(var(--tf) - var(--fw)), rgba(255, 255, 255, 0.3) calc(var(--tf) - 0.45 * var(--fw)),
      rgba(0, 0, 0, 0.04) calc(var(--tf) - 0.12 * var(--fw)), rgba(0, 0, 0, 0.2) var(--tf)),
    var(--rp-turn-bg);
}
`;

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  try { CSS.registerProperty({ name: '--rp-turn', syntax: '<number>', inherits: true, initialValue: '0' }); } catch { /* already registered */ }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS_TEXT);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/** A layer over the view's box (same place, size, text variables, paper). */
function layer(view, cls) {
  const l = document.createElement('div');
  l.className = `rp-turn ${cls}`;
  const r = view.getBoundingClientRect();
  Object.assign(l.style, { left: `${view.offsetLeft}px`, top: `${view.offsetTop}px`, width: `${r.width}px`, height: `${r.height}px` });
  for (const name of view.style) if (name.startsWith('--')) l.style.setProperty(name, view.style.getPropertyValue(name));
  const cs = getComputedStyle(view);
  l.style.setProperty('--rp-turn-bg', cs.backgroundColor);
  l.style.setProperty('--rp-w', `${r.width}px`);
  l.style.color = cs.color;
  return l;
}

// Inside the copy's shadow root: one plain column instead of the paged columns.
const SLICE_CSS = ':host(.rp-turn-slice) .rp-body { column-width: auto !important; columns: auto !important; width: var(--rp-cw) !important; height: auto !important; padding: 0 !important; }';
let sliceSheet;

/**
 * Copy of the page (or spread) on screen. Only the blocks on each page are copied (a
 * whole chapter can take 300 ms to lay out again): from the block holding its first
 * character to the block holding the next page's, in one column of the same width, so
 * the lines break the same; shifted so the first block sits where its fragment is,
 * clipped to the page. A spread copies each of its pages into its own slot.
 */
function copyPage(view, pv) {
  const l = layer(view, '');
  const page = document.createElement('div');
  page.className = 'rp-turn-page';
  const cs = getComputedStyle(view); // the spread's gutter
  for (const k of ['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']) page.style[k] = cs[k];
  // The pages' own box (inside a centred spread's outer blank), clipped like the view.
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'absolute', top: '0', bottom: '0', left: `${pv.off}px`, right: `${pv.off}px`, overflow: 'hidden' });
  page.append(box);
  l.append(page);
  view.after(l); // laid out in place to be measured; the effect may move it under the view
  // Fallback: a whole section, as laid out on screen (x: its place from the pages' left).
  const whole = (src, x, w, clip) => {
    const host = document.createElement('section');
    host.className = src.className;
    host.style.cssText = src.style.cssText;
    Object.assign(host.style, { position: 'absolute', top: '0', left: `${x}px`, width: `${w}px`, height: '100%', overflow: clip ? 'hidden' : 'visible' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = src.shadowRoot.adoptedStyleSheets;
    if (src.shadowRoot.firstElementChild) shadow.append(src.shadowRoot.firstElementChild.cloneNode(true));
    box.append(host);
  };
  if (pv.pair) {
    for (const [j, h] of pv.panes().entries()) whole(h, pv.slotLeft(j), pv.cw, true);
    return l;
  }
  for (let j = 0; j < pv.span && pv.page + j < pv.pages; j++) {
    if (!copyColumn(view, pv, pv.page + j, pv.slotLeft(j), box)) {
      box.replaceChildren();
      whole(pv.host, 0, pv.pw, false);
      break;
    }
  }
  return l;
}

/** One column of the section into `box` at x (from the pages' left); false: copy it whole instead. */
function copyColumn(view, pv, col, x, box) {
  const host = document.createElement('section');
  host.className = pv.host.className;
  host.style.cssText = pv.host.style.cssText;
  const shadow = host.attachShadow({ mode: 'open' });
  const root = pv.root;
  const key = pv.key();
  const at = (edge) => { const c = capture(root, edge, key); return c.path ? [walkPath(root, c.path), c.offset] : [null, 0]; };
  const [first] = at(col * pv.colH);
  if (!first || first === root) return false;
  const [last, lastOffset] = col < pv.pages - 1 ? at((col + 1) * pv.colH) : [null, 0];
  const V = view.getBoundingClientRect();
  const x0 = V.left + view.clientLeft + x;
  const onPage = (f) => f.width && f.right > x0 + 1 && f.left < x0 + pv.cw - 1;
  const r = document.createRange();
  r.setStartBefore(first);
  if (last && last !== root) r.setEndAfter(last); else r.setEnd(root, root.childNodes.length);
  const texts = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n); return out; };
  const lines = (n) => { const x = document.createRange(); x.selectNodeContents(n); return [...x.getClientRects()].filter((f) => f.width); };
  // Alignment: the first line of text on this page; the copy has the same text nodes in
  // the same order, and the same line breaks, so the same line is found by its index.
  const real = texts(r.commonAncestorContainer).filter((n) => r.intersectsNode(n));
  let ti = -1, li = -1;
  for (ti = 0; ti < real.length; ti++) { li = lines(real[ti]).findIndex(onPage); if (li >= 0) break; }
  if (li < 0) return false; // no text on this page (a picture): copy it all
  const top = lines(real[ti])[li].top - V.top;
  // The page's own content ends before the next page's first character (a block that
  // breaks there has a box down to the column's end, so whole boxes would not do).
  const own = r.cloneRange();
  if (last && last !== root) {
    let left = lastOffset;
    for (const n of texts(last)) { if (left <= n.length) { own.setEnd(n, left); break; } left -= n.length; }
  }
  let bottom = 0;
  for (const f of own.getClientRects()) if (onPage(f)) bottom = Math.max(bottom, f.bottom - V.top);
  let body = r.cloneContents();
  for (let a = r.commonAncestorContainer; a && a !== root; a = a.parentNode) { const shell = a.cloneNode(false); shell.append(body); body = shell; }
  const wrap = root.cloneNode(false);
  wrap.append(body);
  sliceSheet ??= (() => { const s = new CSSStyleSheet(); s.replaceSync(SLICE_CSS); return s; })();
  shadow.adoptedStyleSheets = [...pv.host.shadowRoot.adoptedStyleSheets, sliceSheet];
  shadow.append(wrap);
  host.classList.add('rp-turn-slice');
  const w = pv.cw - 2 * pv.m;
  Object.assign(host.style, { transform: '', left: `${x + pv.m}px`, width: `${w}px`, height: 'auto' });
  host.style.setProperty('--rp-cw', `${w}px`);
  // Clip the text, not the paper: the copy stays opaque over the whole page.
  const clip = document.createElement('div');
  clip.className = 'rp-turn-clip';
  clip.style.clipPath = `inset(${pv.padY - 1}px 0 ${Math.max(0, V.height - bottom - 1)}px 0)`;
  clip.append(host);
  box.append(clip);
  const now = lines(texts(wrap)[ti])[li].top - box.getBoundingClientRect().top;
  host.style.top = `${top - now}px`; // a layout offset, so glyphs snap to pixels as on the page
  return true;
}

/**
 * Set up an effect for a turn of the paged view pv: dir +1 forward / -1 back, rtl when
 * the book's pages progress right to left. Call before the view changes; then play()
 * (resolves when done) or finish() (jumps to the end, synchronously cleaned up).
 */
export function prepareTurn(effect, dir, rtl, pv) {
  if (!TIMING[effect]) return null;
  setup();
  const view = pv.el;
  const v = rtl ? -dir : dir; // +1: the new page comes in from the right
  const old = copyPage(view, pv);
  const layers = [old];
  const anims = [];
  const viewClasses = [];
  const opts = { ...TIMING[effect], fill: 'both' };
  const animate = (el, frames) => { const a = el.animate(frames, opts); a.pause(); anims.push(a); };
  const above = () => view.after(old);
  const below = () => view.before(old);

  if (effect === 'fade') {
    above();
    animate(old, [{ opacity: 1 }, { opacity: 0 }]);
  } else if (effect === 'scroll') {
    above();
    animate(old, [{ transform: 'translateX(0)' }, { transform: `translateX(${-v * 100}%)` }]);
    animate(view, [{ transform: `translateX(${v * 100}%)` }, { transform: 'translateX(0)' }]);
  } else if (effect === 'slide') {
    // Forward: the new page slides in over the old one; back: the old one slides away.
    const moving = dir > 0 ? view : old;
    (dir > 0 ? below : above)();
    moving.classList.add('rp-turn-moving');
    if (moving === view) viewClasses.push('rp-turn-moving');
    animate(moving, dir > 0
      ? [{ transform: `translateX(${v * 100}%)` }, { transform: 'translateX(0)' }]
      : [{ transform: 'translateX(0)' }, { transform: `translateX(${-v * 100}%)` }]);
  } else if (effect === 'curl') {
    // Forward: the old page peels away; back: the previous page comes back over it.
    const top = dir > 0 ? old : view;
    (dir > 0 ? above : below)();
    const deco = layer(view, `rp-curl-deco${rtl ? ' rp-mirror' : ''}`);
    // Gradients perpendicular to the fold (direction (h, 0.2w)): angle, scale, line length.
    const { width: w, height: h } = view.getBoundingClientRect();
    const n = Math.hypot(h, 0.2 * w);
    deco.style.setProperty('--rp-ang', `${90 + (Math.atan2(0.2 * w, h) * 180) / Math.PI}deg`);
    deco.style.setProperty('--rp-k', String(h / n));
    deco.style.setProperty('--rp-l', `${(w * h + 0.2 * w * h) / n}px`);
    deco.innerHTML = '<div class="rp-curl-shade"></div><div class="rp-curl-dim"></div><div class="rp-curl-lift"><div class="rp-curl-flap"></div></div>';
    (dir > 0 ? old : view).after(deco);
    layers.push(deco);
    const cls = ['rp-curling', ...(rtl ? ['rp-mirror'] : [])];
    top.classList.add(...cls);
    if (top === view) { viewClasses.push(...cls); view.style.setProperty('--rp-w', deco.style.getPropertyValue('--rp-w')); }
    const frames = dir > 0 ? [{ '--rp-turn': 0 }, { '--rp-turn': 1 }] : [{ '--rp-turn': 1 }, { '--rp-turn': 0 }];
    animate(top, frames);
    animate(deco, frames);
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const a of anims) a.cancel();
    for (const l of layers) l.remove();
    view.classList.remove(...viewClasses);
    view.style.removeProperty('--rp-w');
  };
  return {
    effect,
    play() {
      for (const a of anims) a.play();
      return Promise.all(anims.map((a) => a.finished)).then(cleanup, cleanup);
    },
    finish() {
      for (const a of anims) a.finish();
      cleanup();
    },
  };
}
