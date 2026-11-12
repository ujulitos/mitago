// Reading view chrome: top bar (hides while reading, back on intent), the
// progress rail, and the contents / search / bookmarks panel and settings
// popover. Every control is a button with a name; every key has a mouse twin.

import { icon } from '../lib/icons.js';
import { t, tn } from '../lib/i18n.js';
import { showToast } from '../lib/toast.js';
import { THEMES, applyTheme } from '../lib/theme.js';
import { STYLE_DEFAULTS } from '../core/render.js';
import { EFFECTS, reducedMotion } from '../core/turn.js';
import { indexSection, search } from '../core/search.js';
import { byId } from '../core/anchor.js';
import { atProgress, samePlace, walkPath } from '../core/position.js';
import { $, el, labelled, radioGroup } from './dom.js';
import { chapterTicks, percent, tocIndexAt } from './logic.js';

export const MEASURES = { narrow: 30, medium: 35, wide: 44 }; // em: ~62, ~72, ~90 characters per line
export const READER_DEFAULTS = { ...STYLE_DEFAULTS, marginV: 10, marginH: 20 };
const SIZES = { min: 12, max: 36, step: 2 };
const LINE_HEIGHTS = [1.3, 1.4, 1.9];
const WORD_SPACINGS = [0, 0.12, 0.25];

let rp;
let store;
let marks = [];
let segs = {};
let lastFocus = null;

// ---------------------------------------------------------------------------------- chrome
/** Show the bar (bar is always visible). */
export function wake() { $('reading').classList.remove('calm'); }
export function hideChrome() { $('reading')?.classList.remove('mobile-ui-visible'); }
function calm() {
  // #bar never hides
}
export const settle = () => { hideChrome(); };

let lastTop = 0;
let lastInput = -Infinity; // the reader's own scrolling (wheel, keys, touch), not a jump
function onViewScroll() {
  const viewEl = $('view');
  if (!viewEl) return;
  const top = viewEl.scrollTop;
  const delta = Math.abs(top - lastTop);
  lastTop = top;
  if (!$('reading')?.classList.contains('mobile-ui-visible')) return;
  if ($('rail')?.classList.contains('dragging')) return;
  if (!$('panel')?.hidden && $('panel')?.dataset.pane === 'settings') return;
  if (delta > 3 && performance.now() - lastInput < 1000) hideChrome();
}

// ------------------------------------------------------------------------------- panels
const PANES = { toc: 'toc-pane', search: 'search-pane', marks: 'marks-pane', hl: 'hl-pane', settings: 'settings' };
const BUTTONS = { toc: 'btn-toc', search: 'btn-search', marks: 'btn-marks', hl: 'btn-hl', settings: 'btn-settings' };

export function openPanel(which) {
  if (!$('panel').hidden && $('panel').dataset.pane === which) {
    if (which === 'search') $('q').focus();
    return;
  }
  lastFocus = document.activeElement?.closest?.('.bar') ? document.activeElement : $(BUTTONS[which]);
  $('panel').hidden = false;
  $('panel').dataset.pane = which;
  for (const [k, id] of Object.entries(PANES)) $(id).hidden = k !== which;
  for (const [k, id] of Object.entries(BUTTONS)) $(id).setAttribute('aria-expanded', String(k === which));
  $('panel-title').textContent = { toc: t('contents'), search: t('search'), marks: t('bookmarks'), hl: t('highlights'), settings: t('settings_title') }[which];
  wake();
  if (which === 'search') { $('q').focus(); $('q').select(); }
  if (which === 'toc') {
    refreshTocPages();
    const cur = $('toc').querySelector('[aria-current="true"]') ?? $('toc').querySelector('button');
    cur?.scrollIntoView({ block: 'center' });
    cur?.focus();
  }
  if (which === 'marks') ($('bookmarks').querySelector('.jump') ?? $('mark-add')).focus();
  if (which === 'hl') ($('hl-list').querySelector('.jump') ?? $('panel-close')).focus();
  if (which === 'settings') $('panel-close')?.focus();
}

export function closePanel(restore = true) {
  if ($('panel').hidden) return false;
  $('panel').hidden = true;
  for (const id of Object.values(BUTTONS)) $(id).setAttribute('aria-expanded', 'false');
  if (restore) (lastFocus?.isConnected ? lastFocus : $('view')).focus();
  return true;
}

function togglePanel(which) {
  if (!$('panel').hidden && $('panel').dataset.pane === which) closePanel();
  else openPanel(which);
}

// ------------------------------------------------------------------------------------ ToC
const spinePagesCache = new Map();
let tocLayoutKey = '';

function syncPagedLayoutCache() {
  if (!rp?.view || !rp?.book) return;
  const impl = rp.view.impl;
  const s = rp.view.style;
  const key = `${rp.bookId}|${rp.view.mode}|${impl?.cw ?? 0}|${impl?.colH ?? 0}|${impl?.m ?? 0}|${s.fontSize}|${s.lineHeight}|${s.fontFamily}|${s.wordSpacing}|${s.justify}`;
  if (key !== tocLayoutKey) {
    spinePagesCache.clear();
    tocLayoutKey = key;
  }
  if (rp.view.mode === 'paged' && impl && !impl.pair && impl.root && Number.isInteger(impl.spine)) {
    spinePagesCache.set(impl.spine, Math.max(1, impl.pages || 1));
  }
}

function tocEntryPage(e, ctx) {
  if (e.spine < 0) return null;
  if (ctx.onePerSpine) return e.spine + 1;
  if (ctx.mode === 'scroll') {
    const host = ctx.hosts?.[e.spine];
    if (!host) return null;
    let relTop = Math.max(0, host.offsetTop - ctx.baseTop);
    const frag = e.href?.includes('#') ? decodeURIComponent(e.href.split('#')[1]) : '';
    if (frag && host.rp?.live && host.shadowRoot?.firstElementChild) {
      const target = byId(host.shadowRoot.firstElementChild, frag);
      if (target) relTop += Math.max(0, target.getBoundingClientRect().top - host.getBoundingClientRect().top);
    }
    return Math.min(ctx.totalBookPages, Math.max(1, Math.floor(relTop / ctx.pageH) + 1));
  }
  let page = ctx.spineStartPage[e.spine] ?? 1;
  const frag = e.href?.includes('#') ? decodeURIComponent(e.href.split('#')[1]) : '';
  if (frag && e.spine === ctx.impl?.spine && ctx.impl?.root) {
    const target = byId(ctx.impl.root, frag);
    if (target) {
      const col = Math.max(0, Math.min((ctx.impl.pages || 1) - 1, ctx.impl.colOf(target.getBoundingClientRect().left + 1)));
      page += col;
    }
  }
  return page;
}

function buildTocPageContext() {
  if (!rp?.view || !rp?.book) return null;
  const impl = rp.view.impl;
  if (rp.book.tocPages || impl?.pair || rp.book.format === 'cbz' || rp.book.fixedLayout) {
    return { onePerSpine: true };
  }
  if (rp.view.mode === 'scroll') {
    const hosts = impl?.hosts ?? [];
    const pageH = Math.max(100, (impl?.el?.clientHeight || window.innerHeight) - (impl?.ctx?.inset || 0));
    const baseTop = hosts[0]?.offsetTop ?? 0;
    const totalBookPages = Math.max(1, impl?.folio?.[2] ?? Math.ceil((impl?.el?.scrollHeight || pageH) / pageH));
    return { mode: 'scroll', hosts, pageH, baseTop, totalBookPages };
  }
  syncPagedLayoutCache();
  const s = rp.view.style;
  const fs = Number(s.fontSize ?? 18);
  const lh = Number(s.lineHeight ?? 1.4);
  const textW = Math.max(80, (impl?.cw || window.innerWidth) - 2 * (impl?.m || 24));
  const textH = Math.max(80, impl?.colH || window.innerHeight * 0.8);
  const linesPerPage = Math.max(1, textH / (fs * lh));
  const charsPerLine = Math.max(12, textW / (fs * 0.52));
  const geomBytes = Math.max(400, (linesPerPage * charsPerLine * 0.85) / 0.62);
  let obsBytes = 0;
  let obsPages = 0;
  for (const [sp, pg] of spinePagesCache) {
    const sz = rp.book.spine[sp]?.size ?? 0;
    if (sz >= 2000 && pg >= 2) {
      obsBytes += sz;
      obsPages += pg;
    }
  }
  const bytesPerPage = obsPages > 0
    ? Math.min(geomBytes * 2.5, Math.max(geomBytes * 0.4, obsBytes / obsPages))
    : geomBytes;
  const spineStartPage = [];
  let acc = 1;
  for (let sp = 0; sp < rp.book.spine.length; sp++) {
    spineStartPage.push(acc);
    const sz = rp.book.spine[sp]?.size ?? 0;
    const pg = spinePagesCache.get(sp) ?? Math.max(1, Math.round(sz / bytesPerPage));
    acc += pg;
  }
  return { mode: 'paged', impl, spineStartPage };
}

function refreshTocPages() {
  const tocEl = $('toc');
  if (!tocEl || !rp?.book?.toc?.length) return;
  const ctx = buildTocPageContext();
  if (!ctx) return;
  const buttons = tocEl.querySelectorAll('button[data-index]');
  for (const b of buttons) {
    const idx = Number(b.dataset.index);
    const entry = rp.book.toc[idx];
    const span = b.querySelector('.toc-page');
    if (!entry || !span) continue;
    const p = tocEntryPage(entry, ctx);
    span.textContent = p ? t('toc_page', p) : '';
  }
}

function renderToc() {
  const toc = rp.book.toc;
  $('toc-empty').hidden = toc.length > 0;
  $('toc').replaceChildren(...toc.map((e, i) => {
    const labelSpan = el('span', { className: 'toc-label', textContent: e.label || t('untitled') });
    const pageSpan = el('span', { className: 'toc-page' });
    const b = el('button', { type: 'button', dataset: { index: i, depth: Math.min(e.depth, 4) }, style: `--depth:${Math.min(e.depth, 4)}` }, labelSpan, pageSpan);
    if (e.spine < 0) { b.disabled = true; b.title = t('toc_missing'); }
    b.addEventListener('click', async () => {
      await rp.view.goToHref(e.href);
      if (matchMedia('(max-width: 900px)').matches) closePanel(false);
      $('view').focus();
    });
    return el('li', {}, b);
  }));
  refreshTocPages();
  // Arrow keys move through the list; Home/End jump.
  $('toc').onkeydown = (e) => {
    const all = [...$('toc').querySelectorAll('button:not(:disabled)')];
    const i = all.indexOf(document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    all[Math.max(0, Math.min(all.length - 1, to))].focus();
  };
}

let tocCurrent = -1;
function markToc(pos) {
  const i = tocIndexAt(rp.book.toc, pos);
  if (i === tocCurrent) return;
  $('toc').querySelector('[aria-current]')?.removeAttribute('aria-current');
  const b = $('toc').querySelector(`[data-index="${i}"]`);
  b?.setAttribute('aria-current', 'true');
  tocCurrent = i;
  if (!rp.book.tocPages) $('chapter').textContent = rp.book.toc[i]?.label ?? '';
}

/** A comic whose ToC is only page markers: the bar names the page(s) on screen, not the nearest marker. */
function pageLine(pos) {
  if (!rp.book.tocPages) return;
  const pair = rp.view?.mode === 'paged' && rp.view.impl.pair;
  $('chapter').textContent = pair ? $('folio').textContent : t('page_of', pos.spine + 1, rp.book.spine.length);
}

// --------------------------------------------------------------------------------- search
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/** Build the index in slices, yielding to the page so it never freezes. */
async function ensureIndex() {
  if (rp.index) return rp.index;
  if (rp.indexing) return rp.indexing;
  const book = rp.book;
  rp.indexing = (async () => {
    const t0 = performance.now();
    const n = book.spine.length;
    const sections = [];
    $('search-progress').hidden = false;
    let slice = performance.now();
    for (let i = 0; i < n; i++) {
      sections.push(indexSection(i, await rp.loader.blocks(i)));
      if (performance.now() - slice > 30) {
        const pct = Math.round(((i + 1) / n) * 100);
        $('search-fill').style.width = `${pct}%`;
        $('search-status').textContent = t('indexing', pct);
        await yieldToUi();
        if (rp.book !== book) throw new Error('book closed');
        slice = performance.now();
      }
    }
    $('search-progress').hidden = true;
    rp.timings.index = performance.now() - t0;
    rp.index = sections;
    return sections;
  })();
  try { return await rp.indexing; } finally { rp.indexing = null; }
}

function chapterOf(spine) {
  const i = tocIndexAt(rp.book.toc, { spine });
  return rp.book.toc[i]?.label ?? t('section_n', spine + 1);
}

/** Mark a hit in the text (CSS Custom Highlight API; nothing in the DOM changes). */
function highlightHit(hit) {
  if (!globalThis.CSS?.highlights) return;
  CSS.highlights.delete('rp-hit');
  if (!hit) return;
  const impl = rp.view.impl;
  const root = new Map(rp.view.sections()).get(hit.spine);
  if (!root) return;
  const range = document.createRange();
  const w = document.createTreeWalker(walkPath(root, hit.path), NodeFilter.SHOW_TEXT);
  let left = hit.offset;
  let need = hit.length;
  let started = false;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    let from = 0;
    if (!started) {
      if (left >= n.length) { left -= n.length; continue; }
      range.setStart(n, left);
      started = true;
      from = left;
    }
    if (need <= n.length - from) {
      range.setEnd(n, from + need);
      CSS.highlights.set('rp-hit', new Highlight(range));
      return;
    }
    need -= n.length - from;
  }
}

async function jumpTo(hit, button) {
  rp.beforeSearch ??= rp.view.position;
  $('search-back').hidden = false;
  $('results').querySelector('.current')?.classList.remove('current');
  button?.classList.add('current');
  await rp.view.goTo(hit);
  highlightHit(hit);
}

export async function runSearch(query) {
  const q = String(query ?? '').trim();
  if ($('panel').hidden || $('panel').dataset.pane !== 'search') openPanel('search');
  $('q').value = q;
  if (!q) { $('results').replaceChildren(); $('search-status').textContent = ''; return { hits: [], total: 0 }; }
  $('search-status').textContent = t('indexing', 0);
  const res = search(await ensureIndex(), q);
  $('search-status').textContent = res.total === 0 ? t('no_results', q)
    : res.truncated ? t('results_truncated', res.hits.length, res.total) : tn('results_count', res.total);
  $('results').replaceChildren(...res.hits.map((h, i) => {
    const b = el('button', { type: 'button', dataset: { hit: i } },
      el('span', { class: 'where', textContent: `${chapterOf(h.spine)}` }),
      h.snippet.before, el('mark', { textContent: h.snippet.match }), h.snippet.after);
    b.addEventListener('click', () => jumpTo(h, b));
    return el('li', {}, b);
  }));
  $('results').onkeydown = (e) => {
    const all = [...$('results').querySelectorAll('button')];
    const i = all.indexOf(document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1 }[e.key];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (to < 0) $('q').focus();
    else all[Math.min(all.length - 1, to)].focus();
  };
  return res;
}

export async function backToReadingPlace() {
  if (rp.beforeSearch) await rp.view.goTo(rp.beforeSearch);
  rp.beforeSearch = null;
  $('search-back').hidden = true;
  highlightHit(null);
}

// ------------------------------------------------------------------------------ bookmarks
const hereMark = () => { const pos = rp.view?.position; return marks.find((m) => samePlace(m.pos, pos)); };

export async function renderMarks() {
  marks = (await store.listBookmarks(rp.bookId)).sort((a, b) => a.progress - b.progress);
  $('marks-empty').hidden = marks.length > 0;
  $('bookmarks').replaceChildren(...marks.map((m) => {
    const jump = el('button', { type: 'button', class: 'jump' }, m.chapter ?? m.label, el('small', { textContent: t('percent', percent(m.progress)) }));
    jump.addEventListener('click', async () => { await rp.view.goTo(m.pos); markBookmarkState(); });
    const del = labelled(el('button', { type: 'button', class: 'icon-btn' }, icon('trash', 15)), t('delete_bookmark'));
    del.addEventListener('click', async () => {
      const next = del.closest('li').nextElementSibling ?? del.closest('li').previousElementSibling;
      const i = [...$('bookmarks').children].indexOf(next);
      await store.deleteBookmark(m.id);
      await renderMarks();
      ($('bookmarks').children[Math.max(0, i - (next && i > 0 ? 1 : 0))]?.querySelector('.jump') ?? $('mark-add')).focus();
    });
    return el('li', {}, jump, del);
  }));
  markBookmarkState();
  return marks;
}

function markBookmarkState() {
  const here = !!hereMark();
  const b = $('btn-bookmark');
  b.setAttribute('aria-pressed', String(here));
  b.replaceChildren(icon(here ? 'bookmarkOn' : 'bookmark', 19));
  labelled(b, `${here ? t('remove_bookmark') : t('add_bookmark')} (B)`);
  $('mark-add').disabled = here;
  $('mark-reason').hidden = !here;
  $('mark-reason').textContent = here ? t('already_bookmarked') : '';
}

export async function addBookmark() {
  const pos = rp.view.position;
  const progress = rp.view.progress;
  const chapter = chapterOf(pos.spine);
  const id = await store.addBookmark(rp.bookId, pos, { progress, chapter, label: chapter });
  await renderMarks();
  return id;
}

export async function toggleBookmark() {
  const m = hereMark();
  if (m) { await store.deleteBookmark(m.id); await renderMarks(); return null; }
  return addBookmark();
}

// ------------------------------------------------------------------------------- settings
function openSettings() {
  openPanel('settings');
}
export function closeSettings(restore = true) {
  if ($('panel').hidden || $('panel').dataset.pane !== 'settings') return false;
  return closePanel(restore);
}

/** Effective theme -> page colours and the engine's colour forcing. */
export function applyReadingTheme(choice) {
  rp.theme = applyTheme(choice);
  const forced = true;
  if (rp.view && rp.view.style.forceColors !== forced) rp.view.setStyle({ forceColors: forced });
  segs.theme?.set(rp.theme);
  segs.libTheme?.set(rp.theme);
  const toggle = $('lib-theme-toggle');
  const lbl = $('lib-theme-label');
  if (toggle) toggle.dataset.value = rp.theme;
  if (lbl) lbl.textContent = t('theme');
  return forced;
}

export async function setStyle(partial) {
  rp.view.setStyle(partial);
  syncSettings();
  const { forceColors, ...keep } = rp.view.style;
  if (partial.marginV !== undefined || partial.marginH !== undefined) {
    try {
      const globalStyle = { ...(await store.getSetting('style', {})), marginV: keep.marginV, marginH: keep.marginH };
      await store.setSetting('style', globalStyle);
    } catch {}
  }
  // A book with its own settings keeps them to itself; the global defaults stay untouched.
  if (rp.ownStyle) await store.setSetting(`book:${rp.bookId}`, { style: keep });
  else await store.setSetting('style', keep);
}

/** "Use these settings for this book only": on = a copy kept for this book; off = back to the global ones. */
async function setOwnStyle(on) {
  rp.ownStyle = on;
  if (on) {
    const { forceColors, ...keep } = rp.view.style;
    await store.setSetting(`book:${rp.bookId}`, { style: keep });
    syncSettings();
    return;
  }
  await store.deleteSetting(`book:${rp.bookId}`);
  await setStyle({ ...READER_DEFAULTS, ...(await store.getSetting('style', {})) });
}

export function bumpSize(dir) {
  const next = Math.min(SIZES.max, Math.max(SIZES.min, rp.view.style.fontSize + dir * SIZES.step));
  if (next !== rp.view.style.fontSize) return setStyle({ fontSize: next });
}

function syncSettings() {
  const s = rp.view.style;
  $('size-val').textContent = String(s.fontSize);
  const down = $('size-down');
  const up = $('size-up');
  down.disabled = s.fontSize <= SIZES.min;
  up.disabled = s.fontSize >= SIZES.max;
  labelled(down, down.disabled ? t('smallest_size') : `${t('smaller_text')} (−)`);
  labelled(up, up.disabled ? t('largest_size') : `${t('larger_text')} (+)`);
  segs.font?.set(s.fontFamily);

  const lh = Number(s.lineHeight ?? 1.4);
  if ($('slider-lh')) $('slider-lh').value = String(lh);
  if ($('lh-val')) $('lh-val').textContent = lh.toFixed(2);

  const rawMv = Number(s.marginV ?? 10);
  const mv = (rawMv > 30 || rawMv < 10) ? 10 : rawMv;
  if ($('slider-margin-v')) $('slider-margin-v').value = String(mv);
  if ($('margin-v-val')) $('margin-v-val').textContent = `${mv}%`;

  const rawMh = Number(s.marginH ?? 20);
  const mh = rawMh > 60 ? 20 : Math.min(60, Math.max(10, rawMh));
  if ($('slider-margin-h')) $('slider-margin-h').value = String(mh);
  if ($('margin-h-val')) $('margin-h-val').textContent = `${mh}%`;

  segs.ws?.set(s.wordSpacing);
  segs.justify?.set(String(!!s.justify));
  segs.turn?.set(rp.view?.effect);
  segs.spread?.set(String(s.spread ?? 'auto'));
  segs.mode?.set(rp.view?.mode);
  segs.theme?.set(rp.theme ?? 'sepia');
  segs.libTheme?.set(rp.theme ?? 'sepia');
  $('own-style').setAttribute('aria-checked', String(!!rp.ownStyle));
}

// ---------------------------------------------------------------------- shortcuts dialog
const KEYS = [
  [['/'], 'search'], [['T'], 'contents'], [['B'], 'key_bookmark'], [['H'], 'key_highlight'], [['+', '−'], 'key_size'],
  [['→', '←', 'Space'], 'key_turn'], [['Home', 'End'], 'key_ends'], [['Esc'], 'key_close'], [['O'], 'key_open'], [['?'], 'key_help'],
];
let keysFocus = null;
export function openKeys() {
  const d = $('keys');
  if (d.open) return;
  keysFocus = (!$('panel').hidden && $('panel').dataset.pane === 'settings') ? $('btn-settings') : document.activeElement;
  closeSettings(false);
  d.showModal();
  $('keys-close').focus();
}
export function closeKeys() {
  const d = $('keys');
  if (!d.open) return false;
  d.close();
  return true;
}
function initKeys() {
  $('keys-list').replaceChildren(...KEYS.flatMap(([keys, label]) => [
    el('dt', {}, ...keys.flatMap((k, i) => [i ? ' ' : null, el('kbd', { textContent: k })])),
    el('dd', { textContent: t(label) }),
  ]));
  $('keys-close').addEventListener('click', closeKeys);
  // Esc closes natively; either way the focus goes back where it was.
  $('keys').addEventListener('close', () => { if (keysFocus?.isConnected && keysFocus.offsetParent) keysFocus.focus({ preventScroll: true }); });
  $('btn-keys').addEventListener('click', openKeys);
}

function wireSlider(slider, onValue) {
  if (!slider) return;
  const apply = () => onValue(Number(slider.value));
  slider.addEventListener('input', apply);
  slider.addEventListener('change', apply);
  let dragging = false;
  const setFromPointer = (clientX) => {
    const r = slider.getBoundingClientRect();
    if (!r.width) return;
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const step = Number(slider.step || 1);
    const thumbPad = 11;
    const usable = Math.max(1, r.width - 2 * thumbPad);
    const rawFrac = Math.min(1, Math.max(0, (clientX - r.left - thumbPad) / usable));
    const rtl = getComputedStyle(slider).direction === 'rtl';
    const frac = rtl ? 1 - rawFrac : rawFrac;
    const raw = min + frac * (max - min);
    const snapped = min + Math.round((raw - min) / step) * step;
    const decimals = (String(slider.step).split('.')[1] || '').length;
    const next = Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
    if (Number(slider.value) !== next) {
      slider.value = String(next);
      onValue(next);
    }
  };
  slider.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    dragging = true;
    slider.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setFromPointer(e.clientX);
  });
  slider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    setFromPointer(e.clientX);
  });
  const stop = () => { dragging = false; };
  slider.addEventListener('pointerup', stop);
  slider.addEventListener('pointercancel', stop);
}

function initSettings() {
  $('size-down').append(icon('minus', 16));
  $('size-up').append(icon('plus', 16));
  $('size-down').addEventListener('click', () => bumpSize(-1));
  $('size-up').addEventListener('click', () => bumpSize(1));
  const fam = {
    publisher: 'inherit',
    serif: 'Georgia, serif',
    sans: 'system-ui, sans-serif',
    readable: 'Verdana, Tahoma, sans-serif',
    condensed: '"Roboto Condensed", "Arial Narrow", sans-serif',
  };
  segs.font = radioGroup($('seg-font'), ['publisher', 'serif', 'sans', 'readable', 'condensed'].map((v) => ({
    value: v, label: t(`font_${v}`), content: [el('span', { style: `font-family:${fam[v]}`, textContent: t(`font_${v}_short`) })],
  })), (v) => setStyle({ fontFamily: v }));
  wireSlider($('slider-lh'), (v) => {
    if ($('lh-val')) $('lh-val').textContent = v.toFixed(2);
    setStyle({ lineHeight: v });
  });
  const steps = (id, values, icons, key) => $(id) && radioGroup($(id), values.map((v, i) => ({
    value: v, label: t(['spacing_book', 'spacing_wide', 'spacing_wider'][i]), content: [icon(icons[i], 18)],
  })), (v) => setStyle({ [key]: v }));
  if ($('seg-ws')) {
    segs.ws = steps('seg-ws', WORD_SPACINGS, ['wsNormal', 'wsWide', 'wsWider'], 'wordSpacing');
  }
  segs.justify = radioGroup($('seg-justify'), [['false', 'alignStart', 'justify_off'], ['true', 'alignJustify', 'justify_on']].map(([v, ic, k]) => ({
    value: v, label: t(k), content: [icon(ic, 18)],
  })), (v) => setStyle({ justify: v === 'true' }));
  segs.turn = radioGroup($('seg-turn'), EFFECTS.map((v) => ({ value: v, label: t(`turn_${v}`) })), async (v) => {
    rp.view.setEffect(v);
    syncSettings();
    await store.setSetting('turn', v);
  });
  if (reducedMotion()) $('seg-turn').title = t('turn_reduced');
  segs.spread = radioGroup($('seg-spread'), [['auto', 'spread_auto_hint', 'spread_auto'], ['1', 'spread_one'], ['2', 'spread_two']].map(([v, k, short = k]) => ({
    value: v, label: t(k), content: [el('span', { textContent: t(short) })],
  })), (v) => setStyle({ spread: v }));
  wireSlider($('slider-margin-v'), (v) => {
    if ($('margin-v-val')) $('margin-v-val').textContent = `${v}%`;
    setStyle({ marginV: v });
  });
  wireSlider($('slider-margin-h'), (v) => {
    if ($('margin-h-val')) $('margin-h-val').textContent = `${v}%`;
    setStyle({ marginH: v });
  });
  initAnalogClock();
  const closeLibThemeDropdown = () => {
    const dd = $('lib-theme-dropdown');
    const toggle = $('lib-theme-toggle');
    if (dd) dd.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  };
  const setupThemeGroup = (id) => {
    const elSwatches = $(id);
    if (!elSwatches) return null;
    return radioGroup(elSwatches, THEMES.map((v) => ({
      value: v,
      label: t(`theme_${v}`),
      content: [el('span', { className: 'theme-btn-label', textContent: t(`theme_${v}`) })],
    })), async (v) => {
      applyReadingTheme(v);
      await store.setSetting('theme', v);
    });
  };
  segs.theme = setupThemeGroup('seg-theme');
  segs.libTheme = setupThemeGroup('lib-theme');
  const libThemeToggle = $('lib-theme-toggle');
  if (libThemeToggle) {
    const chev = $('lib-theme-chevron');
    if (chev && !chev.hasChildNodes()) chev.append(icon('chevron', 14));
    libThemeToggle.setAttribute('aria-label', t('theme'));
    libThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = $('lib-theme-dropdown');
      const isOpen = dd?.classList.toggle('open');
      libThemeToggle.setAttribute('aria-expanded', String(!!isOpen));
    });
    document.addEventListener('pointerdown', (e) => {
      const dd = $('lib-theme-dropdown');
      if (dd?.classList.contains('open') && !e.target.closest('#lib-theme-dropdown')) {
        closeLibThemeDropdown();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLibThemeDropdown();
    });
  }
  segs.mode = radioGroup($('seg-mode'), [['scroll', 'scroll'], ['paged', 'pages']].map(([v, ic]) => ({
    value: v, label: t(`mode_${v}`), content: [icon(ic, 16), el('span', { textContent: t(`mode_${v}`) })],
  })), (v) => rp.setMode(v));
  $('own-style').addEventListener('click', () => setOwnStyle($('own-style').getAttribute('aria-checked') !== 'true'));
}

// ----------------------------------------------------------------------------------- rail
let ticks = [];
const sizesOf = () => rp.book.spine.map((s) => s.size);

function railFrac(clientX) {
  const r = $('rail-track').getBoundingClientRect();
  return Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
}

function showTip(f) {
  const tip = $('rail-tip');
  const pos = atProgress(f, sizesOf());
  const label = chapterOf(pos.spine);
  tip.replaceChildren(el('b', { textContent: t('percent', percent(f)) }), el('span', { textContent: label }));
  const track = $('rail-track').getBoundingClientRect();
  const rail = $('rail').getBoundingClientRect();
  const rawX = track.left - rail.left + f * track.width;
  tip.style.top = '';
  tip.hidden = false;
  const half = Math.min(130, (tip.offsetWidth || 140) / 2) + 8;
  const railW = rail.width || window.innerWidth;
  const clampedX = Math.max(half, Math.min(railW - half, rawX));
  tip.style.left = `${clampedX}px`;
}

let dragTarget = null;
let dragBusy = false;
async function dragTo(f) {
  dragTarget = f;
  if (dragBusy) return;
  dragBusy = true;
  while (dragTarget !== null) {
    const x = dragTarget;
    dragTarget = null;
    await rp.goToProgress(x);
  }
  dragBusy = false;
}

function initRail() {
  const rail = $('rail');
  rail.addEventListener('pointerdown', (e) => {
    if (!rp.view) return;
    rail.setPointerCapture(e.pointerId);
    rail.classList.add('dragging');
    const f = railFrac(e.clientX);
    showTip(f);
    paintRail(f);
    dragTo(f);
  });
  rail.addEventListener('pointermove', (e) => {
    if (!rp.view) return;
    const f = railFrac(e.clientX);
    showTip(f);
    if (rail.classList.contains('dragging')) { paintRail(f); dragTo(f); }
  });
  const end = () => { rail.classList.remove('dragging'); $('rail-tip').hidden = true; };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
  rail.addEventListener('pointerleave', () => { if (!rail.classList.contains('dragging')) $('rail-tip').hidden = true; });
  rail.addEventListener('keydown', (e) => {
    const p = rp.view?.progress ?? 0;
    const to = { ArrowDown: p + 0.01, ArrowRight: p + 0.01, ArrowUp: p - 0.01, ArrowLeft: p - 0.01, PageDown: p + 0.1, PageUp: p - 0.1, Home: 0, End: 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const f = Math.min(1, Math.max(0, to));
    showTip(f);
    rp.goToProgress(f);
  });
  rail.addEventListener('blur', () => { $('rail-tip').hidden = true; });
}

function renderTicks() {
  ticks = chapterTicks(rp.book.toc, sizesOf());
  $('ticks').replaceChildren(...ticks.map((k) => el('i', { style: `left:${(k.at * 100).toFixed(3)}%` })));
}

function paintRail(p) {
  $('rail-thumb').style.left = `${p * 100}%`;
  $('rail-thumb').style.top = '';
  $('rail-fill').style.width = `${p * 100}%`;
  $('rail-fill').style.height = '';
}

// ------------------------------------------------------------------------------ position
const sectionWordsCache = new Map();

function countWords(root) {
  if (!root) return 0;
  const text = root.textContent || '';
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 32) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function paintChapterTime() {
  const el = $('chapter-time');
  if (!el || !rp?.view) return;
  const pos = rp.view.position;
  if (!pos) {
    el.textContent = '';
    return;
  }
  const spineIndex = pos.spine;
  const impl = rp.view.impl;
  let wordsInChapter = sectionWordsCache.get(spineIndex);
  if (wordsInChapter === undefined) {
    const root = impl?.root ?? (new Map(rp.view.sections()).get(spineIndex));
    if (root) {
      wordsInChapter = countWords(root);
      if (wordsInChapter > 0) sectionWordsCache.set(spineIndex, wordsInChapter);
    }
  }

  let fracRemaining = 0;
  if (rp.view?.impl?.atEnd) {
    fracRemaining = 0;
  } else if (rp.view.mode === 'paged' && impl?.folio) {
    const [, b, n] = impl.folio;
    fracRemaining = n > 0 ? Math.max(0, (n - b) / n) : 0;
  } else {
    fracRemaining = Math.max(0, 1 - (pos.frac || 0));
  }

  let mins = 0;
  if (wordsInChapter && wordsInChapter > 0) {
    const wordsLeft = Math.round(wordsInChapter * fracRemaining);
    mins = Math.ceil(wordsLeft / 220);
  } else if (rp.view.mode === 'paged' && impl?.folio) {
    const [, b, n] = impl.folio;
    mins = Math.max(0, n - b);
  } else {
    const size = rp.book?.spine?.[spineIndex]?.size ?? 12000;
    const bytesLeft = Math.round(size * fracRemaining);
    mins = Math.ceil((bytesLeft / 6) / 220);
  }

  if (mins <= 0) {
    el.textContent = t('time_left_chapter_less_minute');
  } else if (mins < 60) {
    el.textContent = t('time_left_chapter', mins);
  } else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    el.textContent = t('time_left_chapter_hours', h, m);
  }
  el.hidden = false;
}

let clockVisible = true;

export function setClockVisible(visible) {
  clockVisible = !!visible;
  const clockEl = $('analog-clock');
  if (clockEl) {
    clockEl.hidden = !clockVisible;
    clockEl.classList.toggle('clock-hidden', !clockVisible);
  }
  if ($('pct')) $('pct').hidden = false;
  const barToggle = $('clock-bar-toggle');
  const barLabel = $('clock-bar-label');
  if (barToggle) {
    barToggle.setAttribute('aria-checked', String(clockVisible));
    barToggle.setAttribute('aria-pressed', String(clockVisible));
    const titleText = t('clock');
    barToggle.title = titleText;
    barToggle.setAttribute('aria-label', titleText);
  }
  if (barLabel) {
    barLabel.textContent = t('clock');
  }
  try {
    localStorage.setItem('rp_show_clock', clockVisible ? '1' : '0');
    if (store) store.setSetting('show_clock', clockVisible).catch(() => {});
  } catch {}
}

function initAnalogClock() {
  const clockEl = $('analog-clock');
  if (!clockEl || clockEl._clockInited) return;
  clockEl._clockInited = true;

  const saved = localStorage.getItem('rp_show_clock');
  if (saved !== null) {
    setClockVisible(saved === '1');
  } else {
    store?.getSetting?.('show_clock', true).then((v) => {
      if (v !== undefined) setClockVisible(!!v);
    }).catch(() => {});
  }

  const barToggle = $('clock-bar-toggle');
  if (barToggle && !barToggle._inited) {
    barToggle._inited = true;
    barToggle.addEventListener('click', () => {
      setClockVisible(!clockVisible);
    });
  }
  const clockSeg = $('clock-segmented');
  if (clockSeg && !clockSeg._segInited) {
    clockSeg._segInited = true;
    clockSeg.addEventListener('click', (e) => {
      if (barToggle && e.target !== barToggle && !barToggle.contains(e.target)) {
        barToggle.click();
      }
    });
  }

  function update() {
    if (clockEl.hidden || clockEl.classList.contains('clock-hidden')) return;
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const hourDeg = ((hours % 12) + minutes / 60 + seconds / 3600) * 30;
    const minDeg = (minutes + seconds / 60) * 6;
    const hourHand = $('clock-hour');
    const minHand = $('clock-min');
    if (hourHand) hourHand.setAttribute('transform', `rotate(${hourDeg.toFixed(2)} 88 88)`);
    if (minHand) minHand.setAttribute('transform', `rotate(${minDeg.toFixed(2)} 88 88)`);
    clockEl.title = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  update();
  setInterval(update, 1000);
}

/** Called on every position change (debounced saves happen in reader.js). */
export function onPosition(pos, progress) {
  if (rp.view?.impl?.atEnd) {
    progress = 1;
    pos = { ...pos, frac: 1 };
  }
  if (!$('rail').classList.contains('dragging')) paintRail(progress);
  const pct = percent(progress);
  $('pct').textContent = t('percent', pct);
  markToc(pos);
  paintFolio();
  paintChapterTime();
  const rail = $('rail');
  rail.setAttribute('aria-valuenow', String(pct));
  rail.setAttribute('aria-valuetext', `${t('percent', pct)}, ${$('chapter').textContent}`);
  if (marks.length || $('btn-bookmark').getAttribute('aria-pressed') === 'true') markBookmarkState();
  $('book-fill').style.width = `${progress * 100}%`;
}

function paintChapterPages() {
  const el = $('chapter-pages');
  if (!el) return;
  if (!rp?.view || !rp?.book || rp.book.tocPages) { el.textContent = ''; return; }
  const impl = rp.view.impl;
  if (rp.view.mode === 'paged' && impl?.folio) {
    const [a, b, n] = impl.folio;
    el.textContent = a === b ? t('page_of', a, n) : t('folio_spread', a, b, n);
    return;
  }
  const spine = rp.view.position?.spine ?? 0;
  const host = impl?.hosts?.[spine];
  const viewEl = impl?.el;
  if (!host || !viewEl) { el.textContent = ''; return; }
  const pageH = Math.max(100, viewEl.clientHeight - (impl.ctx?.inset || 0));
  const rect = host.getBoundingClientRect();
  const secH = Math.max(pageH, rect.height || host.offsetHeight || pageH);
  const total = Math.max(1, Math.ceil(secH / pageH));
  const passed = Math.max(0, (impl.top ?? viewEl.getBoundingClientRect().top) - rect.top);
  let cur = total <= 1 ? 1 : Math.min(total, Math.floor(passed / pageH) + 1);
  if (impl.atEnd || rp.view.position?.frac >= 0.9995) cur = total;
  el.textContent = t('page_of', cur, total);
}

/** Page arrows and page numbers: after a move, or a re-pagination in place. */
export function paintFolio() {
  if (!rp.view) return;
  const impl = rp.view.impl;
  if (rp.view.mode === 'paged') {
    $('page-prev').disabled = impl.atStart;
    $('page-next').disabled = impl.atEnd;
  }
  if (impl?.folio) {
    const [a, b, n, book] = impl.folio;
    $('folio').textContent = a === b ? t('page_of', a, n) : t('folio_spread', a, b, n);
    $('folio').title = book ? $('folio').textContent : a === b ? t('page_of_chapter', a, n) : t('folio_spread_chapter', a, b, n);
  }
  syncPagedLayoutCache();
  paintChapterPages();
  pageLine(rp.view.position);
  paintChapterTime();
  if (!$('panel').hidden && $('panel').dataset.pane === 'toc') refreshTocPages();
}

/** A book was just laid out: fill everything that depends on it. */
export async function setupBook() {
  tocCurrent = -1;
  spinePagesCache.clear();
  tocLayoutKey = '';
  $('reading').classList.remove('mobile-ui-visible');
  $('book-title').textContent = rp.book.title || t('untitled');
  $('results').replaceChildren();
  $('search-status').textContent = '';
  $('search-back').hidden = true;
  $('q').value = '';
  rp.beforeSearch = null;
  highlightHit(null);
  renderToc();
  renderTicks();
  syncMode();
  syncSettings();
  await renderMarks();
  onPosition(rp.view.position, rp.view.progress); // current chapter, rail, % for the new lists
  lastTop = $('view')?.scrollTop ?? 0;
}

export function syncMode() {
  const paged = rp.view.mode === 'paged';
  $('reading').classList.toggle('paged', paged);
  $('page-prev').hidden = !paged;
  $('page-next').hidden = !paged;
  $('folio').hidden = false;
  if ($('pct')) $('pct').hidden = false;
  if ($('chapter-time')) $('chapter-time').hidden = false;
  if ($('clock-widget')) $('clock-widget').hidden = false;
  if ($('analog-clock')) $('analog-clock').hidden = !clockVisible;
  if ($('clock-segmented')) $('clock-segmented').hidden = false;
  if ($('clock-bar-toggle')) $('clock-bar-toggle').hidden = false;
  $('row-turn').hidden = !paged;
  $('row-spread').hidden = !paged;
  segs.mode?.set(rp.view.mode);
}

export function initReading(state, deps) {
  rp = state;
  store = deps.store;
  const set = (id, name, label, key) => { $(id).replaceChildren(icon(name, 19)); labelled($(id), key ? `${label} (${key})` : label); };
  set('back', 'back', t('back_to_library'));
  set('btn-toc', 'contents', t('contents'), 'T');
  set('btn-search', 'search', t('search'), '/');
  set('btn-marks', 'bookmarks', t('bookmarks'));
  set('btn-hl', 'highlighter', t('highlights'));
  set('btn-settings', 'text', t('reading_settings'));
  set('panel-close', 'close', t('close_panel'), 'Esc');
  $('search-icon').append(icon('search', 16));
  $('page-prev').append(icon('prev', 26));
  $('page-next').append(icon('next', 26));
  labelled($('page-prev'), t('previous_page'));
  labelled($('page-next'), t('next_page'));
  labelled($('rail'), t('progress_label'));
  $('search-back').replaceChildren(icon('back', 15), el('span', { textContent: t('back_to_place') }));
  $('mark-add').replaceChildren(icon('bookmark', 15), el('span', { textContent: t('add_bookmark') }));
  markBookmarkState();

  $('back').addEventListener('click', deps.onBack);
  $('btn-toc').addEventListener('click', () => togglePanel('toc'));
  $('btn-search').addEventListener('click', () => togglePanel('search'));
  $('btn-marks').addEventListener('click', () => togglePanel('marks'));
  $('btn-hl').addEventListener('click', () => togglePanel('hl'));
  $('btn-bookmark').addEventListener('click', () => toggleBookmark());
  $('btn-settings').addEventListener('click', () => togglePanel('settings'));
  $('panel-close').addEventListener('click', () => closePanel());
  $('mark-add').addEventListener('click', () => addBookmark());
  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('q').value); });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); $('results').querySelector('button')?.focus(); }
  });
  $('search-back').addEventListener('click', () => backToReadingPlace());
  $('page-prev').addEventListener('click', () => rp.turn(-1));
  $('page-next').addEventListener('click', () => rp.turn(1));
  // A mouse click on a page arrow keeps focus on the text, so the arrow keys still turn pages after it.
  for (const id of ['page-prev', 'page-next']) $(id).addEventListener('pointerdown', (e) => e.preventDefault());

  // Touch swipe gestures for mobile / tablet reading (especially in paged mode)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  $('view').addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = performance.now();
    }
  }, { passive: true });
  $('view').addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1 && rp.view?.mode === 'paged') {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const elapsed = performance.now() - touchStartTime;
      if (elapsed < 600 && Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        const rtl = rp.book?.dir === 'rtl';
        const dir = deltaX < 0 ? (rtl ? -1 : 1) : (rtl ? 1 : -1);
        rp.turn(dir);
      }
    }
  }, { passive: true });
  $('view').addEventListener('scroll', onViewScroll, { passive: true });
  for (const type of ['wheel', 'touchmove']) $('view').addEventListener(type, () => { lastInput = performance.now(); }, { passive: true, capture: true });
  addEventListener('keydown', (e) => {
    if (!e.target?.closest?.('.panel, .popover, .hl-bar, dialog, #rail')) lastInput = performance.now();
  }, { passive: true, capture: true });
  $('bar').addEventListener('focusin', wake);
  document.addEventListener('pointermove', (e) => { if (e.clientY < 72 && !$('reading').hidden) wake(); }, { passive: true });
  // Click outside the settings popover closes it.
  let tapStartX = 0;
  let tapStartY = 0;
  let overlayWasOpen = false;
  document.addEventListener('pointerdown', (e) => {
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    overlayWasOpen = !$('panel').hidden || !$('hl-bar').hidden;
    if (!$('panel').hidden && !e.target.closest('#panel, [aria-controls="panel"], #panel-close')) closePanel(false);
  });
  $('reading').addEventListener('click', (e) => {
    if (overlayWasOpen) return;
    if (e.target.closest('#bar, #rail, #clock-widget, #page-prev, #page-next, #panel, #settings, #hl-bar')) return;
    if (Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 12) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel).trim().length > 0) return;
    if (e.composedPath().some((n) => n.tagName === 'A' || n.dataset?.rpHref)) return;
    $('reading').classList.toggle('mobile-ui-visible');
  });
  initSettings();
  initKeys();
  initRail();
}
