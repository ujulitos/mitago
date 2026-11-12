// Rendering: continuous vertical scroll and paginated (CSS columns) views over
// the same loader, behind one facade (createView) that can switch modes and
// restyle without losing the reader's place.
//
// Each spine section renders into its own shadow root (book CSS stays scoped).
// The reading position is a position.js anchor {spine, path, offset, frac},
// captured only when the USER moves (scroll, page turn) and re-applied after
// anything that changes layout (materialize, evict, font, resize, late image,
// mode switch). Never a scroll offset.

import { capture, locate, byId } from './anchor.js';
import { pathOf, normalize, progress as progressOf, START } from './position.js';
import { prepareTurn, reducedMotion } from './turn.js';
import { pageGeometry, spreadStart } from './spread.js';

// forceColors: the page's theme colours (--rp-ink, --rp-link) replace the book's own
// (dark and sepia themes); false keeps the publisher's colours.
// letterSpacing / wordSpacing: em added by the reader (0 = the book's own); justify: justify
// running text (hyphenated where the language is known). spread: pages per screen in the
// paged view, 'auto' | '1' | '2' (src/core/spread.js).
export const STYLE_DEFAULTS = Object.freeze({
  fontSize: 18, fontFamily: 'publisher', lineHeight: 1.55, margin: 120, marginV: 10, marginH: 20, maxWidth: 900, forceColors: false,
  letterSpacing: 0, wordSpacing: 0, justify: false, spread: 'auto',
});
const FAMILIES = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  // Dyslexia-friendly: installed faces only (no remote fonts), wide and open.
  readable: '"OpenDyslexic", "Atkinson Hyperlegible", Lexend, Verdana, Tahoma, sans-serif',
  condensed: '"Roboto Condensed", "Arial Narrow", sans-serif',
};
const FORCED_COLORS = `
.rp-body { color: var(--rp-ink) !important; background: transparent !important; }
.rp-body :not(img, svg, svg *, video) { color: inherit !important; background-color: transparent !important; border-color: var(--rp-rule, currentColor) !important; }
.rp-body a[href], .rp-body a[data-rp-href] { color: var(--rp-link, inherit) !important; }`;

// Inside every section's shadow root, after the book's own sheets.
const SECTION_CSS = `
:host { display: block; contain: layout style; }
.rp-body { font-size: var(--rp-font-size) !important; line-height: var(--rp-line-height) !important; overflow-wrap: break-word; }
.rp-body * { line-height: inherit !important; }
.rp-body p { margin-top: 0 !important; margin-bottom: 0.75em !important; }
.rp-body img, .rp-body svg, .rp-body video, .rp-body picture, .rp-body figure, .rp-body canvas {
  display: block !important; width: auto !important; max-width: 100% !important; height: auto !important;
  margin-inline: auto; object-fit: contain; break-inside: avoid; vertical-align: middle;
}
/* A picture never needs more than one screen. */
:host(:not(.rp-paged)) .rp-body img, :host(:not(.rp-paged)) .rp-body svg, :host(:not(.rp-paged)) .rp-body video,
:host(:not(.rp-paged)) .rp-body picture, :host(:not(.rp-paged)) .rp-body figure { max-height: 92vh; }
/* Theme hooks, set on the page (custom properties inherit into shadow roots). */
.rp-body img, .rp-body svg image, .rp-body video { filter: var(--rp-img-filter, none); }
::selection { background: var(--rp-sel-bg, Highlight); color: var(--rp-sel-ink, HighlightText); }
::highlight(rp-hit) { background: var(--rp-hit-bg, #ffe58a); color: var(--rp-hit-ink, #1d1f23); }
/* The reader's highlights (src/reader/highlights.js): translucent, so the text keeps its ink. */
::highlight(rp-hl-yellow) { background-color: var(--rp-hl-yellow, rgb(255 212 0 / 0.42)); }
::highlight(rp-hl-green) { background-color: var(--rp-hl-green, rgb(70 200 110 / 0.36)); }
::highlight(rp-hl-blue) { background-color: var(--rp-hl-blue, rgb(70 150 255 / 0.32)); }
::highlight(rp-hl-pink) { background-color: var(--rp-hl-pink, rgb(255 90 170 / 0.30)); }
::highlight(rp-hl-note) { text-decoration: underline dotted var(--rp-soft, currentColor) 1.5px; text-underline-offset: 3px; }
/* Both views lay text out top to bottom: vertical writing (CJK) is shown horizontally,
   and the reader says so (book.vertical). Half a vertical book cut off would be worse. */
.rp-body, .rp-body :not(svg, svg *) { writing-mode: horizontal-tb !important; }
.rp-body pre { white-space: pre-wrap; }
.rp-body table { max-width: 100%; table-layout: fixed; }
/* Layout containment would turn the columns' overflow into ink overflow: the
   view could not scroll to page 2+ and would count one page. */
:host(.rp-paged) { contain: style; }
:host(.rp-paged) .rp-body {
  box-sizing: border-box !important; width: var(--rp-pw) !important; height: var(--rp-ph) !important;
  max-width: none !important; min-height: 0 !important; margin: 0 !important;
  padding: var(--rp-pad-y) var(--rp-m) !important;
  /* --rp-span columns per screen (1, or 2 side by side); the rest overflow to the side. */
  column-count: var(--rp-span, 1) !important; column-width: auto !important; column-gap: calc(2 * var(--rp-m)) !important;
  column-fill: auto !important; overflow: visible !important;
}
/* RTL: columns follow the container's direction, and a right-to-left column flow would
   overflow to negative x, which the view cannot scroll to. Columns stay left to right;
   the text inside keeps its direction. */
:host(.rp-paged) .rp-body[dir=rtl] { direction: ltr !important; }
:host(.rp-paged) .rp-body[dir=rtl] > :not([dir]) { direction: rtl; }
/* Except in a right-to-left book's spread: there the columns do run right to left (a
   spread's first page on the right); the view is rtl too, so the overflow counts leftwards. */
:host(.rp-paged.rp-rev) .rp-body { direction: rtl !important; }
:host(.rp-paged.rp-rev) .rp-body[dir=ltr] > :not([dir]) { direction: ltr; }
:host(.rp-paged) .rp-body :is(img, svg, video) { max-height: calc(var(--rp-ph) - 2 * var(--rp-pad-y)); object-fit: contain; break-inside: avoid; }
`;

// Fixed-layout books are shown as flowing text: drop the page-sized boxes and the
// absolute placement so nothing lands outside the view or on top of other text.
const FXL_CSS = `
.rp-body, .rp-body * { position: static !important; width: auto !important; min-width: 0 !important;
  height: auto !important; min-height: 0 !important; overflow: visible !important; transform: none !important; }
.rp-body img, .rp-body svg { display: block; margin: 0 auto; }
`;

// Page-level rules for the view element itself.
const VIEW_CSS = `
.rp-scroll-view { overflow-y: auto; overflow-x: hidden; overflow-anchor: none;
  padding-block: calc(max(var(--rp-pad-y, 5vh), calc(max(env(safe-area-inset-top, 0px), var(--safe-top, 0px)) + 14px)) + 8px) max(35vh, calc(var(--rp-pad-y, 5vh) + 24px + max(env(safe-area-inset-bottom, 0px), var(--safe-bottom, 0px)))) !important;
  padding-inline: max(var(--rp-margin-x, 10vw), max(env(safe-area-inset-left, 0px), var(--safe-left, 0px))) max(var(--rp-margin-x, 10vw), max(env(safe-area-inset-right, 0px), var(--safe-right, 0px))) !important; box-sizing: border-box; }
.rp-scroll-view > .rp-section { display: block; }
.rp-paged-view { overflow: hidden !important; padding: 0 !important; }
.rp-paged-view > .rp-section { display: block; width: 100%; height: 100%; }
/* A book of one page per section (comics, fixed layout) pairs sections in a spread. */
.rp-paged-view.rp-pair { display: flex; }
.rp-paged-view.rp-pair > .rp-section { flex: none; width: 50%; overflow: clip; }
/* The gutter between two pages: a soft fold in the theme's rule colour. */
.rp-paged-view.rp-spread {
  background-image: linear-gradient(to right, transparent calc(50% - 22px), color-mix(in srgb, var(--rp-rule, #dcdee3) 55%, transparent) 50%, transparent calc(50% + 22px)) !important;
  background-size: 100% calc(100% - 2 * var(--rp-pad-y, 0px)) !important; background-position: center !important; background-repeat: no-repeat !important;
}
`;

/** Read resolved CSS safe-area insets in px so reading views stay clear of notches/home bars. */
function safeInsets() {
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    top: px(cs.scrollPaddingTop),
    bottom: px(cs.scrollPaddingBottom),
    left: px(cs.scrollPaddingLeft),
    right: px(cs.scrollPaddingRight),
  };
}

let viewSheet;
function ensureViewSheet() {
  if (viewSheet) return;
  viewSheet = new CSSStyleSheet();
  viewSheet.replaceSync(VIEW_CSS);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, viewSheet];
}

const cssSheet = (text) => {
  const s = new CSSStyleSheet();
  s.replaceSync(text);
  return s;
};
const sectionSheet = () => cssSheet(SECTION_CSS);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Justify: mark the running text the book aligns to the start (left in ltr, right in rtl),
 * never what it centres or sets flush to the other side (titles, poems, signatures).
 */
function markJustify(root) {
  for (const el of root.querySelectorAll('p, li, dd, blockquote, div')) {
    if (el.tagName === 'DIV' && ![...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
    const cs = getComputedStyle(el);
    const a = cs.textAlign;
    if (a === 'start' || a === 'justify' || a === (cs.direction === 'rtl' ? 'right' : 'left')) el.setAttribute('data-rp-j', '');
  }
}

/** Resolve a {spine, id} fragment target into a precise position inside root. */
function resolveId(root, pos) {
  const el = pos.id ? byId(root, pos.id) : null;
  if (!el) return pos;
  return { spine: pos.spine, path: pathOf(root, el), offset: 0, frac: pos.frac ?? 0 };
}

// ---------------------------------------------------------------------------
// Continuous vertical scroll across the whole spine. Every spine item gets a
// host <section>; only hosts near the viewport are materialized, the rest are
// placeholders sized by measured px-per-byte. Browser scroll anchoring is off
// so it never fights ours.

class ContinuousView {
  constructor(el, book, ctx) {
    Object.assign(this, { el, book, ctx, margin: 1.5, keep: 4 });
    this.pxPerByte = 0.33;
    this.measured = { px: 0, bytes: 0, count: 0 };
    this.position = { ...START };
    // Where the edge cuts the anchor character, in its heights (0 = its top). capture()
    // takes the first character whose bottom is past the edge, so its top is usually above
    // it; restoring "top at the edge" would pull the view back by up to a line on every
    // frame of a scroll (the scroll-mode stutter), so restore puts it back exactly here.
    this.line = 0;
    this.knownTop = 0; // scrollTop at the last capture/restore; anything else = the user moved
    this.stats = { materialized: 0, evicted: 0, maxLive: 0, corrections: 0 };
    this.width = el.clientWidth;

    el.classList.add('rp-scroll-view');
    this.hosts = book.spine.map((item, i) => {
      const host = document.createElement('section');
      host.className = 'rp-section';
      host.dataset.spine = i;
      host.style.height = `${Math.max(40, item.size * this.pxPerByte)}px`;
      host.attachShadow({ mode: 'open' });
      host.rp = { live: false, loading: null, height: null };
      return host;
    });
    el.replaceChildren(...this.hosts);
    // A new book starts from the top: the element can still hold the previous book's
    // offset here, and the scroll event that follows would read as the user moving.
    el.scrollTop = 0;
    this.knownTop = el.scrollTop;

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.materialize(Number(e.target.dataset.spine));
    }, { root: el, rootMargin: `${this.margin * 100}% 0px` });
    for (const h of this.hosts) this.io.observe(h);

    let raf = 0;
    this.onScroll = () => {
      this.sync();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (this.hosts) this.evict(); });
    };
    el.addEventListener('scroll', this.onScroll);
    // Viewport resize: scale unmeasured placeholders, then put the anchor back.
    this.viewRO = new ResizeObserver(() => {
      const w = this.el.clientWidth;
      if (w && this.width && w !== this.width) { this.scalePlaceholders(this.width / w); this.line = 0; }
      this.width = w;
      this.restore();
      this.ctx.onLayout?.();
    });
    this.viewRO.observe(el);
    // Live section resize (late image decode, font load): keep the anchor still.
    this.hostRO = new ResizeObserver(() => this.restore());
  }

  padYPx() {
    const rawMv = Number(this.ctx.style.marginV ?? 10);
    const mvPct = (rawMv > 30 || rawMv < 10) ? 10 : rawMv;
    const base = Math.round((window.innerHeight * (mvPct / 2)) / 100);
    const safeTop = safeInsets().top;
    return Math.max(base, safeTop > 0 ? Math.ceil(safeTop) + 14 : 0);
  }

  /** The reading edge: the view's top plus the vertical margin area kept clear for page chrome. */
  get top() { return this.el.getBoundingClientRect().top + this.el.clientTop + this.padYPx() + 8; }

  get atEnd() {
    if (!this.hosts?.length) return false;
    const canScroll = this.el.scrollHeight > this.el.clientHeight + 10;
    const isBottom = canScroll && (this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 25);
    const lastIndex = this.hosts.length - 1;
    const lastHost = this.hosts[lastIndex];
    if (!lastHost) return false;
    const r = lastHost.getBoundingClientRect();
    const viewBottom = this.el.getBoundingClientRect().bottom - this.padYPx();
    const lastHostFinished = (this.hostAtTop() === lastIndex) && (r.bottom <= viewBottom + 25 || isBottom);
    return isBottom || lastHostFinished;
  }

  hostAtTop() {
    const top = this.top + 1;
    let lo = 0, hi = this.hosts.length - 1, hit = hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.hosts[mid].getBoundingClientRect().bottom > top) { hit = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return hit;
  }

  /** Re-capture the anchor if the user scrolled since we last looked. Call before any layout change. */
  sync() {
    if (this.el.scrollTop === this.knownTop) return;
    this.position = this.capture();
    this.knownTop = this.el.scrollTop;
    this.ctx.emit(this.position);
  }

  capture() {
    const i = this.hostAtTop();
    const host = this.hosts[i];
    const edge = this.top + 1;
    const r = host.getBoundingClientRect();
    const isEnd = (i === this.hosts.length - 1) && this.atEnd;
    const frac = isEnd ? 1 : (r.height ? clamp01((edge - r.top) / r.height) : 0);
    const root = host.shadowRoot.firstElementChild;
    if (!host.rp.live || !root) return { spine: i, path: null, offset: 0, frac }; // fast fling over a placeholder
    // The edge is in space the section adds above or below its text (book margins):
    // no character is there, so hold the place by fraction. Anchoring to the nearest
    // character would snap the view to it on the next restore (a jump while scrolling).
    const rr = root.getBoundingClientRect();
    if (rr.bottom <= edge || rr.top > edge) return { spine: i, path: null, offset: 0, frac };
    const pos = { spine: i, ...capture(root, edge, (b) => b.bottom), frac };
    const c = locate(root, pos);
    this.line = c.height ? Math.max(-4, Math.min(1, (edge - 1 - c.top) / c.height)) : 0;
    return pos;
  }

  /** Scroll so this.position sits at the top edge again. */
  restore() {
    const pos = this.position;
    const host = this.hosts?.[pos.spine];
    if (!host) return;
    const root = host.shadowRoot.firstElementChild;
    let y;
    if (host.rp.live && root && pos.path) { const r = locate(root, pos); y = r.top + this.line * r.height; }
    else { const r = host.getBoundingClientRect(); y = r.top + (pos.frac ?? 0) * r.height; }
    const delta = y - this.top;
    if (Math.abs(delta) >= 0.5) { this.el.scrollTop += delta; this.stats.corrections++; }
    this.knownTop = this.el.scrollTop;
  }

  load(i) { return this.ctx.load(i); }

  roots() { return this.hosts.filter((h) => h.rp.live).map((h) => h.shadowRoot.firstElementChild).filter(Boolean); }

  materialize(i) {
    const host = this.hosts?.[i];
    if (!host || host.rp.live || host.rp.loading) return host?.rp.loading;
    host.rp.loading = (async () => {
      const { wrap, sheets } = await this.load(i);
      if (!this.hosts) return; // destroyed meanwhile
      this.sync();
      host.shadowRoot.adoptedStyleSheets = [...sheets, ...this.ctx.sheets];
      host.shadowRoot.replaceChildren(wrap.cloneNode(true));
      if (this.ctx.style.justify) markJustify(host.shadowRoot.firstElementChild);
      host.style.height = '';
      host.rp.live = true;
      host.rp.loading = null;
      this.ctx.onSection?.(i, host.shadowRoot.firstElementChild);
      this.stats.materialized++;
      const h = host.getBoundingClientRect().height;
      if (host.rp.height === null) {
        this.measured.px += h;
        this.measured.bytes += Math.max(1, this.book.spine[i].size);
        this.pxPerByte = this.measured.px / this.measured.bytes;
        // Early on, re-estimate unmeasured placeholders so the scrollbar is honest.
        if (++this.measured.count <= 8) {
          for (const [j, x] of this.hosts.entries()) {
            if (x.rp.height === null && !x.rp.live) x.style.height = `${Math.max(40, this.book.spine[j].size * this.pxPerByte)}px`;
          }
          this.ctx.onLayout?.();
        }
      }
      host.rp.height = h;
      this.hostRO.observe(host);
      this.restore();
      // The anchor was captured over this section's placeholder (coarse frac):
      // pin it to the character now at the top, or a restyle would drift.
      if (i === this.position?.spine && !this.position.path) {
        this.position = this.capture();
        this.knownTop = this.el.scrollTop;
        this.ctx.emit(this.position);
      }
      this.stats.maxLive = Math.max(this.stats.maxLive, this.hosts.filter((x) => x.rp.live).length);
    })();
    return host.rp.loading;
  }

  /** Drop far-away sections back to placeholders of their measured height. */
  evict() {
    this.sync();
    const vh = this.el.clientHeight;
    const top = this.top;
    let dropped = false;
    for (const host of this.hosts) {
      if (!host.rp.live) continue;
      const r = host.getBoundingClientRect();
      if (r.bottom < top - this.keep * vh || r.top > top + (this.keep + 1) * vh) {
        this.hostRO.unobserve(host);
        host.style.height = `${r.height}px`;
        host.rp.height = r.height;
        host.shadowRoot.replaceChildren();
        host.rp.live = false;
        this.stats.evicted++;
        dropped = true;
      }
    }
    // A placeholder takes the section's exact height, so nothing moves; re-anchor only
    // after a real eviction (never on every scroll frame).
    if (dropped) this.restore();
  }

  scalePlaceholders(ratio) {
    for (const h of this.hosts) {
      if (!h.rp.live) h.style.height = `${Math.max(40, parseFloat(h.style.height) * ratio)}px`;
    }
    this.pxPerByte *= ratio;
  }

  async goTo(pos) {
    this.position = pos;
    this.line = 0;
    await this.materialize(pos.spine);
    if (!this.hosts) return;
    const root = this.hosts[pos.spine].shadowRoot.firstElementChild;
    if (pos.id && root) this.position = resolveId(root, pos);
    this.restore();
    // A coarse target (progress jump, saved from a placeholder) becomes precise once laid out.
    if (!this.position.path && root) this.position = { ...this.capture(), frac: pos.frac ?? 0 };
    this.knownTop = this.el.scrollTop;
    this.ctx.emit(this.position);
  }

  /** Style changed (font, line height, margin): layout moves, the anchor does not. */
  restyle(ratio) {
    this.sync();
    this.line = 0; // lines rewrap: show the anchor's line whole at the edge
    if (ratio !== 1) this.scalePlaceholders(ratio);
    this.restore();
  }

  /** Page numbers in scroll mode: [cur, cur, total, isBookWide] */
  get folio() {
    if (!this.hosts || !this.book?.spine?.length) return [1, 1, 1, true];
    const n = this.book.spine.length;
    if (this.book.tocPages) {
      const cur = Math.min(n, Math.max(1, this.hostAtTop() + 1));
      return [cur, cur, n, true];
    }
    const pageH = Math.max(100, this.el.clientHeight - (this.ctx.inset || 0));
    const scrollH = Math.max(pageH, this.el.scrollHeight);
    const maxScroll = Math.max(1, scrollH - this.el.clientHeight);
    const total = Math.max(1, Math.ceil(scrollH / pageH));
    if (total <= 1) return [1, 1, 1, true];
    const frac = Math.min(1, Math.max(0, this.el.scrollTop / maxScroll));
    const cur = Math.min(total, Math.max(1, Math.round(frac * (total - 1)) + 1));
    return [cur, cur, total, true];
  }

  async next() {
    const delta = (this.el.clientHeight - this.ctx.inset) * 0.85;
    this.el.scrollBy({ top: delta, behavior: 'smooth' });
    await frame();
    this.sync();
  }
  async prev() {
    const delta = -(this.el.clientHeight - this.ctx.inset) * 0.85;
    this.el.scrollBy({ top: delta, behavior: 'smooth' });
    await frame();
    this.sync();
  }

  destroy() {
    this.io.disconnect();
    this.viewRO.disconnect();
    this.hostRO.disconnect();
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.classList.remove('rp-scroll-view');
    this.el.replaceChildren();
    this.el.scrollTop = 0;
    this.hosts = null;
  }
}

// ---------------------------------------------------------------------------
// Paginated: one section at a time, laid out in viewport-sized CSS columns;
// a page turn moves the section left by one page width (a transform, not a
// scroll: the view could not scroll the last page fully into place, because the
// columns' overflow ends at the last column, a margin short of the page). The
// anchor is mapped to a page through a flow coordinate: column * columnHeight + y.
//
// Spreads (src/core/spread.js): `span` columns per screen, each `cw` wide; a turn
// moves a whole spread, and spreads always pair columns 0-1, 2-3, ... (`page` is the
// spread's first column). Right-to-left books run their columns right to left (`rev`),
// so a spread's first page is on the right. Books of one page per section (comics,
// fixed layout) pair sections instead (`pair`): sections 2k and 2k+1 side by side, each
// in its own host; a section that needs more than one page turns pairing off for the book.

class PagedView {
  constructor(el, book, ctx) {
    Object.assign(this, { el, book, ctx });
    this.position = { ...START };
    this.spine = -1;
    this.page = 0;
    this.pages = 1;
    this.span = 1;
    this.imagePages = book.format === 'cbz' || !!book.fixedLayout;
    this.noPair = false;
    el.classList.add('rp-paged-view');
    this.host = this.makeHost();
    this.host2 = null; // pair mode: the spread's second section
    el.replaceChildren(this.host);
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(el);
    // overflow:hidden is still programmatically scrollable (focus, selection): pin it.
    this.onScroll = () => { if (this.el.scrollLeft) this.el.scrollLeft = 0; };
    el.addEventListener('scroll', this.onScroll);
  }

  makeHost() {
    const host = document.createElement('section');
    host.className = 'rp-section rp-paged';
    host.attachShadow({ mode: 'open' });
    // Late image loads change the column count: re-anchor.
    host.shadowRoot.addEventListener('load', () => this.relayout(), true);
    return host;
  }

  get root() { return this.host?.shadowRoot.firstElementChild; }

  /** Hosts on screen, in reading order. */
  panes() { return [this.host, this.host2].filter(Boolean); }

  roots() { return this.sections().map(([, r]) => r); }

  sections() { return this.panes().flatMap((h) => (h.shadowRoot.firstElementChild ? [[Number(h.dataset.spine), h.shadowRoot.firstElementChild]] : [])); }

  /** Page geometry from the view's size and the style (no content needed). */
  measure() {
    const s = this.ctx.style;
    // The page step is the view's real width in whole device pixels (clientWidth rounds
    // to CSS px: at a fractional width every page would sit a fraction further over).
    const dpr = devicePixelRatio || 1;
    const width = Math.round(this.el.getBoundingClientRect().width * dpr) / dpr;
    const rawMh = Number(s.marginH ?? 20);
    const mhPct = rawMh > 60 ? 20 : Math.min(60, Math.max(10, rawMh));
    const sidePx = Math.round((window.innerWidth * (mhPct / 2)) / 100);
    // A book of single-page sections that cannot pair shows them one per screen in Auto.
    const auto = String(s.spread ?? 'auto') === 'auto';
    const g = pageGeometry(width, this.imagePages && this.noPair && auto ? { ...s, marginH: sidePx, margin: sidePx, spread: '1' } : { ...s, marginH: sidePx, margin: sidePx });
    const pw = Math.round((width - 2 * g.off) * dpr) / dpr;
    const ph = this.el.clientHeight;
    const rawMv = Number(s.marginV ?? 10);
    const mvPct = (rawMv > 30 || rawMv < 10) ? 10 : rawMv;
    const safe = safeInsets();
    const basePadY = Math.round((window.innerHeight * (mvPct / 2)) / 100);
    const padY = Math.max(
      basePadY,
      safe.top > 0 ? Math.ceil(safe.top) + 14 : 0,
      safe.bottom > 0 ? Math.ceil(safe.bottom) + 36 : 0,
    );
    const cw = pw / g.span;
    const mBase = g.span === 2 ? Math.round((cw * (mhPct / 2)) / 100) : sidePx;
    const m = Math.max(mBase, Math.ceil(Math.max(safe.left, safe.right)));
    Object.assign(this, {
      span: g.span, off: g.off, m, pw, ph, padY, colH: ph - 2 * padY, cw,
      pair: g.span === 2 && this.imagePages && !this.noPair,
      rev: g.span === 2 && this.book.dir === 'rtl',
    });
  }

  layout() {
    this.measure();
    const { el, pw, cw, ph, m, padY, span, pair, rev, off } = this;
    el.classList.toggle('rp-spread', span === 2);
    el.classList.toggle('rp-pair', pair);
    // The outer blank of a centred spread: a border is outside the overflow clip.
    el.style.borderLeft = el.style.borderRight = off ? `${off}px solid transparent` : '';
    el.style.direction = rev ? 'rtl' : 'ltr';
    el.style.setProperty('--rp-pad-y', `${padY}px`);
    el.parentElement?.style.setProperty('--rp-pad-y', `${padY}px`);
    el.style.setProperty('--rp-margin-x', `${m}px`);
    for (const h of this.panes()) {
      h.classList.toggle('rp-rev', rev && !pair);
      for (const [k, v] of [['--rp-pw', `${pair ? cw : pw}px`], ['--rp-ph', `${ph}px`], ['--rp-m', `${m}px`], ['--rp-pad-y', `${padY}px`], ['--rp-span', pair ? 1 : span]]) h.style.setProperty(k, String(v));
      h.style.transform = '';
    }
    const count = (w) => Math.max(1, Math.ceil((w - 1) / cw));
    this.pages = !this.root ? 1 : pair ? 1 : count(el.scrollWidth);
    this.overflow = pair && this.panes().some((h) => h.shadowRoot.firstElementChild && count(h.scrollWidth) > 1);
    this.place();
  }

  place() {
    const x = this.pair ? 0 : this.page * this.cw * (this.rev ? 1 : -1);
    this.host.style.transform = x ? `translateX(${x}px)` : '';
    if (this.el.scrollLeft) this.el.scrollLeft = 0;
  }

  /** Left edge of spread slot j (0 = the spread's first page), from the left of the pages. */
  slotLeft(j) { return (this.rev ? this.span - 1 - j : j) * this.cw; }

  /** Column index of a client rect (by its x) on the current layout. */
  colOf(x) {
    const b = this.root.getBoundingClientRect();
    return Math.floor((this.rev ? b.right - x : x - b.left) / this.cw);
  }

  key() {
    const b = this.root.getBoundingClientRect();
    const y0 = b.top + this.padY;
    const { cw, colH } = this;
    return this.rev
      ? (r) => Math.floor((b.right - r.left - 1) / cw) * colH + (r.bottom - y0)
      : (r) => Math.floor((r.right - 1 - b.left) / cw) * colH + (r.bottom - y0);
  }

  setPage(p) {
    this.page = spreadStart(Math.min(Math.max(0, p), this.pages - 1), this.span);
    this.place();
  }

  fill(host, spine, { wrap, sheets }) {
    host.dataset.spine = spine;
    host.shadowRoot.adoptedStyleSheets = [...sheets, ...this.ctx.sheets];
    host.shadowRoot.replaceChildren(wrap.cloneNode(true));
    if (this.ctx.style.justify) markJustify(host.shadowRoot.firstElementChild);
  }

  /** Lay out the section holding `spine` (in pair mode: its pair). */
  async show(spine) {
    this.measure();
    const base = this.pair ? spine - (spine % 2) : spine;
    const key = `${this.pair ? 'p' : ''}${base}`;
    if (key === this.shown && this.root) return;
    const second = this.pair && base + 1 < this.book.spine.length ? base + 1 : -1;
    const [a, b] = await Promise.all([this.ctx.load(base), second >= 0 ? this.ctx.load(second) : null]);
    if (!this.host) return;
    this.fill(this.host, base, a);
    if (b) {
      this.host2 ??= this.makeHost();
      this.fill(this.host2, second, b);
      this.host.after(this.host2);
    } else { this.host2?.remove(); this.host2 = null; }
    this.spine = base;
    this.shown = key;
    for (const [i, r] of this.sections()) this.ctx.onSection?.(i, r);
    this.page = 0;
    this.layout();
    if (this.overflow) { this.noPair = true; await this.show(spine); }
  }

  pageOf(pos) {
    if (!this.root || this.pair) return 0;
    if (!pos.path) return Math.min(this.pages - 1, Math.floor(clamp01(pos.frac ?? 0) * this.pages));
    return this.colOf(locate(this.root, pos).left + 1);
  }

  captureAt() {
    const c = capture(this.root, this.page * this.colH, this.key());
    const atEnd = this.atEnd;
    const spine = atEnd ? this.book.spine.length - 1 : this.spine;
    return { spine, ...c, frac: atEnd ? 1 : this.page / this.pages };
  }

  async relayout() {
    if (!this.root) return;
    const before = `${this.span} ${this.page} ${this.pages}`;
    this.measure();
    const spine = this.position.spine;
    // Pairing came or went (resize, setting), or a section turned out too long to pair.
    if (`${this.pair ? 'p' : ''}${this.pair ? spine - (spine % 2) : this.spine}` !== this.shown) await this.show(spine);
    else {
      this.layout();
      if (this.overflow) { this.noPair = true; await this.show(spine); }
    }
    if (!this.host) return;
    this.setPage(this.pageOf(this.position));
    if (`${this.span} ${this.page} ${this.pages}` !== before) {
      this.position = this.captureAt();
      this.ctx.emit(this.position);
      this.ctx.onLayout?.();
    }
  }

  async goTo(pos) {
    this.position = pos;
    await this.show(pos.spine);
    if (!this.host) return;
    this.layout();
    if (pos.id) {
      const root = new Map(this.sections()).get(pos.spine) ?? this.root;
      this.position = resolveId(root, pos);
    }
    this.setPage(this.pageOf(this.position));
    if (!this.position.path || this.atEnd) this.position = this.captureAt();
    this.ctx.emit(this.position);
  }

  restyle() { return this.relayout(); }

  get atStart() { return this.spine <= 0 && this.page <= 0; }
  get atEnd() { return this.page + this.span >= this.pages && this.spine + (this.pair ? 2 : 1) >= this.book.spine.length; }

  /** Page numbers on screen: [first, last, of]; pair mode counts the book's pages (its sections). */
  get folio() {
    if (this.pair) { const n = this.book.spine.length; return [this.spine + 1, Math.min(this.spine + 2, n), n, true]; }
    return [this.page + 1, Math.min(this.page + this.span, this.pages), this.pages, false];
  }

  async turn(dir) {
    this.fx?.finish(); // a turn during a turn: the running effect ends first
    const within = dir > 0 ? this.page + this.span < this.pages : this.page > 0;
    const next = this.spine + dir * (this.pair ? 2 : 1);
    if (!within && (next < 0 || next >= this.book.spine.length)) return false;
    // The page being left, copied over (or under) the view before anything changes.
    const fx = this.root ? prepareTurn(this.ctx.effect(), dir, this.book.dir === 'rtl', this) : null;
    if (within) this.setPage(this.page + dir * this.span);
    else {
      await this.show(next);
      this.setPage(dir > 0 ? 0 : this.pages - 1);
    }
    this.position = this.captureAt();
    this.ctx.emit(this.position);
    if (fx && this.host) { this.fx = fx; fx.play().then(() => { if (this.fx === fx) this.fx = null; }); } else fx?.finish();
    return true;
  }

  next() { return this.turn(1); }
  prev() { return this.turn(-1); }

  destroy() {
    this.fx?.finish();
    this.ro.disconnect();
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.classList.remove('rp-paged-view', 'rp-spread', 'rp-pair');
    for (const k of ['border-left', 'border-right', 'direction', '--rp-pad-y']) this.el.style.removeProperty(k);
    this.el.replaceChildren();
    this.el.scrollLeft = 0;
    this.host = null;
    this.host2 = null;
  }
}

// ---------------------------------------------------------------------------

/**
 * createView(el, book, loader, { mode: 'scroll'|'paged', style, onPosition(pos, progress), onSection(spine, root), onLayout(), inset })
 * -> { mode, position, progress, goTo(pos), goToHref(path#frag), setMode(m), setStyle(partial),
 *      sections(), next(), prev(), destroy(), impl }
 * onSection: a section's DOM was (re)built (lazy load, mode switch); ranges into the old one are dead.
 * onLayout: paged mode re-paginated without the reader moving (resize, style): page numbers changed.
 * All methods that move are async and resolve once the new place is laid out.
 */
export function createView(el, book, loader, { mode = 'scroll', style = {}, onPosition, onSection, onLayout, inset = 0, effect = 'none' } = {}) {
  ensureViewSheet();
  const sizes = book.spine.map((s) => s.size);
  const cache = new Map(); // spine index -> Promise<loaded section>, small LRU shared by both modes
  const settingsSheet = new CSSStyleSheet();
  const ctx = {
    style: { ...STYLE_DEFAULTS, ...style },
    inset, // scroll mode: px below the view's top where the reading edge sits (clear of an overlay bar)
    sheets: [sectionSheet(), ...(book.fixedLayout ? [cssSheet(FXL_CSS)] : []), settingsSheet],
    load(i) {
      if (cache.has(i)) { const p = cache.get(i); cache.delete(i); cache.set(i, p); return p; }
      const p = loader.load(i);
      p.catch(() => cache.delete(i));
      cache.set(i, p);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      return p;
    },
    emit(pos) {
      const isEnd = impl?.atEnd;
      const p = isEnd ? 1 : progressOf(pos, sizes);
      const finalPos = isEnd ? { ...pos, spine: sizes.length - 1, frac: 1 } : pos;
      onPosition?.(finalPos, p);
    },
    effect: () => (reducedMotion() ? 'none' : effect), // page-turn effect (paged mode)
    onSection,
    onLayout,
  };

  function applyStyle() {
    const s = ctx.style;
    const rawMh = Number(s.marginH ?? 20);
    const mhPct = rawMh > 60 ? 20 : Math.min(60, Math.max(10, rawMh));
    const sideVw = `${mhPct / 2}vw`;
    const rawMv = Number(s.marginV ?? 10);
    const mvPct = (rawMv > 30 || rawMv < 10) ? 10 : rawMv;
    const padYVh = `${mvPct / 2}vh`;
    el.style.setProperty('--rp-font-size', `${s.fontSize}px`);
    el.style.setProperty('--rp-line-height', String(s.lineHeight));
    el.style.setProperty('--rp-margin', sideVw);
    el.style.setProperty('--rp-margin-x', sideVw);
    el.style.setProperty('--rp-pad-y', padYVh);
    el.parentElement?.style.setProperty('--rp-pad-y', padYVh);
    el.style.setProperty('--rp-max-width', `${s.maxWidth ?? 900}px`);
    const fam = FAMILIES[s.fontFamily] ?? (s.fontFamily !== 'publisher' ? s.fontFamily : null);
    const spacing = s.fontFamily === 'readable' ? '.rp-body { letter-spacing: 0.02em; word-spacing: 0.12em; }' : '';
    const text = '.rp-body, .rp-body :not(code, kbd, samp, pre, pre *)';
    settingsSheet.replaceSync([
      fam ? `${text} { font-family: ${fam} !important; }` : '',
      spacing,
      s.letterSpacing ? `${text} { letter-spacing: ${s.letterSpacing}em !important; }` : '',
      s.wordSpacing ? `${text} { word-spacing: ${s.wordSpacing}em !important; }` : '',
      s.justify ? '[data-rp-j] { text-align: justify !important; } [lang] [data-rp-j], [data-rp-j][lang] { hyphens: auto; }' : '',
      s.forceColors ? FORCED_COLORS : '',
    ].join('\n'));
  }
  applyStyle();

  let impl = null;
  let currentMode = mode;
  const make = (m) => (m === 'paged' ? new PagedView(el, book, ctx) : new ContinuousView(el, book, ctx));
  impl = make(mode);

  const clean = (pos) => {
    if (pos?.id !== undefined && Number.isInteger(pos.spine)) return { spine: pos.spine, path: null, offset: 0, frac: 0, id: pos.id };
    return normalize(pos, book.spine.length) ?? { ...START };
  };

  return {
    get mode() { return currentMode; },
    get position() {
      if (impl.sync) impl.sync();
      if (impl?.atEnd) return { ...impl.position, spine: sizes.length - 1, frac: 1 };
      return impl.position;
    },
    get progress() {
      if (impl?.atEnd) return 1;
      return progressOf(impl.position, sizes);
    },
    get style() { return { ...ctx.style }; },
    get impl() { return impl; },
    get effect() { return effect; },
    /** Page-turn effect for paged mode: none | slide | curl | fade | scroll. */
    setEffect(e) { effect = e; },
    goTo: (pos) => impl.goTo(clean(pos)),
    /** Internal link or ToC href ("OEBPS/text/ch3.xhtml#frag"). Returns false if not in the spine. */
    async goToHref(href) {
      const [path, frag = ''] = href.split('#');
      const spine = book.spineIndex.get(path);
      if (spine === undefined) return false;
      await impl.goTo(frag ? { spine, path: null, offset: 0, frac: 0, id: decodeURIComponent(frag) } : { spine, path: [], offset: 0, frac: 0 });
      return true;
    },
    async setMode(m) {
      if (m === currentMode) return;
      const pos = this.position;
      impl.destroy();
      currentMode = m;
      impl = make(m);
      await impl.goTo(pos);
    },
    setStyle(partial) {
      const before = ctx.style;
      if (impl.sync) impl.sync();
      ctx.style = { ...before, ...partial };
      if (ctx.style.justify && !before.justify) for (const r of impl.roots()) markJustify(r);
      applyStyle();
      const ratio = (ctx.style.fontSize / before.fontSize) * (ctx.style.lineHeight / before.lineHeight);
      return impl.restyle(ratio);
    },
    /** Sections laid out now: [[spine, root]] (root = the chapter's .rp-body inside its shadow root). */
    sections() {
      if (!impl.hosts) return impl.sections();
      return impl.hosts.flatMap((h, i) => (h.rp.live && h.shadowRoot.firstElementChild ? [[i, h.shadowRoot.firstElementChild]] : []));
    },
    next: () => impl.next(),
    prev: () => impl.prev(),
    destroy() { impl.destroy(); cache.clear(); },
  };
}
