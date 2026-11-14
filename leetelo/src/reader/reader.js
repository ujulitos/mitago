// Reader page: the library (home) and the reading view, one page. Opens a book
// from the picker, a drop, IndexedDB (?book=<id>) or a redirected local file
// (?src=file:///…). Books, positions, bookmarks and settings live in IndexedDB.

import '../lib/chrome-shim.js';
import { openAny } from '../core/formats.js';
import { createLoader } from '../core/loader.js';
import { createView } from '../core/render.js';
import { openStore, bookKey } from '../core/store.js';
import { atProgress, START } from '../core/position.js';
import { icon } from '../lib/icons.js';
import { localizeDom, t } from '../lib/i18n.js';
import { showToast } from '../lib/toast.js';
import { $ } from './dom.js';
import { addReadingTime, errorCode, fileProblem, hasRoom, localDay } from './logic.js';
import { hideNotice, importFile, initLibrary, problemText, renderLibrary, showNotice } from './library.js';
import { addStatTime } from './stats.js';
import { EXTENSION } from './libfile.js';
import { openRemote } from './remote.js';
import { clearHighlights, closeHighlightBar, exportHighlights, highlightSelection, highlights, initHighlights, onTextMoved, paint as paintHighlights, setupHighlights } from './highlights.js';
import {
  MEASURES, READER_DEFAULTS, addBookmark, applyReadingTheme, bumpSize, closeKeys, closePanel, closeSettings,
  hideChrome, initReading, openKeys, onPosition as paintPosition, openPanel, paintFolio, runSearch, setStyle, settle, setupBook, syncMode, toggleBookmark, wake,
} from './reading.js';

// Exposed for the e2e suite and debugging; nothing reads it in production paths.
const rp = (window.__rp = { errors: [], timings: {}, ready: false });
const storeReady = openStore();

/**
 * Guard against an iOS standalone PWA WebKit bug where `env(safe-area-inset-top)` resolves
 * to 0px on cold launch under `black-translucent`. Measures native `env()` directly and
 * applies `--safe-top` / `--safe-bottom` fallbacks only when needed on iOS standalone.
 */
function syncSafeAreaFallback(notify = true) {
  const root = document.documentElement;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPod|iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true || matchMedia?.('(display-mode: standalone)')?.matches;
  if (!isIOS || !isStandalone) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  (document.body || root).appendChild(probe);
  const pcs = getComputedStyle(probe);
  const envTop = parseFloat(pcs.paddingTop) || 0;
  const envBottom = parseFloat(pcs.paddingBottom) || 0;
  probe.remove();

  const portrait = window.innerHeight >= window.innerWidth;
  const expectedFullH = (portrait ? Math.max(screen.width || 0, screen.height || 0) : Math.min(screen.width || 0, screen.height || 0));
  const fullViewport = expectedFullH > 0 && window.innerHeight >= expectedFullH - 20;
  const maxDim = Math.max(screen.width || 0, screen.height || 0);
  const statusBarStyle = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') || 'default';
  const translucentBar = statusBarStyle === 'black-translucent';
  const wantTop = (!translucentBar || !fullViewport || envTop >= 20) ? '' : (!portrait ? '' : `${maxDim >= 852 ? 59 : maxDim >= 812 ? 47 : 20}px`);
  const wantBottom = (!fullViewport || envBottom > 0) ? '' : (maxDim >= 812 ? `${portrait ? 34 : 21}px` : '');
  const prevTop = root.style.getPropertyValue('--safe-top');
  const prevBottom = root.style.getPropertyValue('--safe-bottom');
  if (wantTop) root.style.setProperty('--safe-top', wantTop); else root.style.removeProperty('--safe-top');
  if (wantBottom) root.style.setProperty('--safe-bottom', wantBottom); else root.style.removeProperty('--safe-bottom');
  if (notify && (wantTop !== prevTop || wantBottom !== prevBottom)) window.dispatchEvent(new Event('resize'));
}
syncSafeAreaFallback(false);
addEventListener('pageshow', () => syncSafeAreaFallback(true));
addEventListener('orientationchange', () => syncSafeAreaFallback(true));
addEventListener('resize', () => syncSafeAreaFallback(false));

// ---- position saving ----------------------------------------------------------------
let saveTimer = 0;
let pending = null;
let section = null;
function onPosition(pos, progress) {
  if (rp.view?.impl?.atEnd) {
    progress = 1;
    pos = { ...pos, spine: (rp.book?.spine?.length ? rp.book.spine.length - 1 : pos.spine), frac: 1 };
  }
  const now = Date.now();
  if (section?.bookId !== rp.bookId || section.spine !== pos.spine) section = { bookId: rp.bookId, spine: pos.spine, since: now };
  rp.position = pos;
  rp.progress = progress;
  rp.lastActive = Date.now();
  paintPosition(pos, progress);
  onTextMoved();
  pending = { pos, progress };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
  if (rp.bookId) {
    const nextCat = progress >= 0.9995 ? 'read' : (progress > 0 ? 'reading' : null);
    if (nextCat) {
      storeReady.then(async (store) => {
        try {
          const categories = await store.getSetting('book_categories', {});
          if (categories[rp.bookId] !== nextCat) {
            categories[rp.bookId] = nextCat;
            await store.setSetting('book_categories', categories);
          }
        } catch {}
      });
    }
  }
}
async function flush() {
  clearTimeout(saveTimer);
  if (!pending || !rp.bookId || !rp.view) return;
  const { pos, progress } = pending;
  const { bookId, view: { mode } } = rp; // read now: closing the book clears them during the await
  pending = null;
  const store = await storeReady;
  await store.savePosition(bookId, pos, { progress, mode });
  if (progress >= 0.9995) {
    try {
      const categories = await store.getSetting('book_categories', {});
      if (categories[bookId] !== 'read') {
        categories[bookId] = 'read';
        await store.setSetting('book_categories', categories);
      }
    } catch {}
  }
  rp.saves = (rp.saves ?? 0) + 1;
}
rp.flush = flush;
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
addEventListener('pagehide', flush);
addEventListener('beforeunload', flush);

// Scroll mode reads at this line, with top breathing space below the bar.
const READING_EDGE = 24;

// ---- views --------------------------------------------------------------------------
function closeReading() {
  if (!rp.view) return;
  flush();
  closePanel(false);
  closeSettings(false);
  globalThis.CSS?.highlights?.delete('rp-hit');
  clearHighlights();
  rp.view.destroy();
  rp.loader?.revoke();
  Object.assign(rp, { view: null, loader: null, book: null, bookId: null, index: null, ready: false, kept: undefined, ownStyle: false });
}

async function showLibrary() {
  await flush();
  closeReading();
  if (location.search) history.replaceState(null, '', location.pathname);
  $('reading').hidden = true;
  $('library').hidden = false;
  document.title = 'Léetelo';
  await renderLibrary();
}

/** Lay a book out at its saved place. Returns true when it had one. */
async function show(book, id, { push = false } = {}) {
  const store = await storeReady;
  closeReading();
  Object.assign(rp, { book, bookId: id, index: null, ready: false });
  rp.loader = createLoader(book);
  hideNotice();
  $('library').hidden = true;
  $('reading').hidden = false;
  wake();
  const saved = await store.getPosition(id);
  try {
    const categories = await store.getSetting('book_categories', {});
    const targetCat = (saved?.progress ?? 0) >= 0.9995 ? 'read' : 'reading';
    if (categories[id] !== targetCat) {
      categories[id] = targetCat;
      await store.setSetting('book_categories', categories);
    }
  } catch {}
  const forceColors = applyReadingTheme(await store.getSetting('theme', null));
  // This book's own text settings (P1-4) replace the global ones entirely.
  const own = await store.getSetting(`book:${id}`, null);
  rp.ownStyle = !!own?.style;
  const globalStyle = (await store.getSetting('style', {})) || {};
  const rawStyle = { ...READER_DEFAULTS, ...globalStyle, ...(own?.style ?? {}) };
  if (globalStyle.marginV !== undefined) rawStyle.marginV = globalStyle.marginV;
  if (globalStyle.marginH !== undefined) rawStyle.marginH = globalStyle.marginH;
  const mvNum = Number(rawStyle.marginV);
  rawStyle.marginV = (!Number.isFinite(mvNum) || mvNum > 30 || mvNum < 10) ? 10 : mvNum;
  const mhNum = Number(rawStyle.marginH);
  rawStyle.marginH = (!Number.isFinite(mhNum) || mhNum > 60 || mhNum < 10) ? 20 : mhNum;
  const validFonts = new Set(['condensed', 'source_sans', 'fira_condensed', 'atkinson', 'noto_sans', 'asap_condensed']);
  if (!validFonts.has(rawStyle.fontFamily)) {
    rawStyle.fontFamily = rawStyle.fontFamily === 'readable' ? 'atkinson' : 'condensed';
  }
  const em = typeof rawStyle.measure === 'number' ? rawStyle.measure : (MEASURES[rawStyle.measure] ?? 35);
  const maxWidth = Math.round(em * (rawStyle.fontSize ?? 18));
  const style = { ...rawStyle, maxWidth, forceColors };
  const mode = saved?.mode ?? await store.getSetting('mode', 'scroll');
  $('reading').classList.toggle('paged', mode === 'paged'); // final view size before layout
  const effect = await store.getSetting('turn', 'none');
  rp.view = createView($('view'), book, rp.loader, { mode, style, onPosition, onSection: paintHighlights, onLayout: paintFolio, inset: READING_EDGE, effect });
  wheelFor(mode);
  rp.inset = READING_EDGE;
  await rp.view.goTo(saved?.pos ?? START);
  const url = `?book=${id}`;
  if (push) history.pushState({ lib: true }, '', url);
  else if (location.search !== url) history.replaceState({ lib: !!history.state?.lib }, '', url);
  await setupBook();
  await setupHighlights();
  document.title = `${book.title || t('untitled')} — Léetelo`;
  $('view').focus({ preventScroll: true });
  if (book.fixedLayout) showToast({ level: 'warn', text: t('fixed_layout'), details: [t('fixed_layout_more')] });
  else if (book.vertical) showToast({ level: 'warn', text: t('vertical_text'), details: [t('vertical_text_more')] });
  rp.ready = true;
  return !!saved?.pos;
}

/** navigator.storage.estimate(), or null where it is unavailable. */
async function estimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

/** Ask once for persistent storage (no prompt; Chrome decides). Result kept for diagnostics. */
function askPersist() {
  if (rp.persisted !== undefined) return;
  rp.persisted = null;
  navigator.storage?.persist?.().then((v) => { rp.persisted = v; }, () => {});
}

/** Explain a failed open where it happened: in the library, or over the open book. */
async function fail(code, name = '') {
  rp.errors.push(code);
  if (rp.view) {
    const [text, next] = problemText(code, name);
    showToast({ level: 'error', text, details: [next] });
    return;
  }
  if ($('library').hidden) await showLibrary();
  showNotice(code, { name });
}

// ---- opening --------------------------------------------------------------------------
/** A small cover for the shelf (decoded once at import, never the full image). */
async function coverThumb(book) {
  if (!book?.cover) return null;
  try {
    const bmp = await createImageBitmap(await book.zip.blob(book.cover));
    const w = Math.min(320, bmp.width);
    const h = Math.round((bmp.height / bmp.width) * w);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch { return null; } // SVG or broken cover: the shelf typesets the title instead
}

// Comic ToC labels ("Page 11"). The key is pending translation: English until it is merged.
const pageLabel = (n) => { const s = t('comic_page', n); return s === 'comic_page' ? `Page ${n}` : s; };

/** Guarda físicamente el libro importado en la carpeta /libros del servidor. */
export async function saveBookPhysically(file) {
  if (!file || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const filename = file.name || 'libro.epub';
    const res = await fetch(`/api/upload?name=${encodeURIComponent(filename)}`, {
      method: 'POST',
      body: file,
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(filename)
      }
    });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent('rp-book-saved', { detail: { name: filename } }));
    }
  } catch (err) {
    console.warn('[Léetelo] No se pudo guardar el libro físicamente en /libros:', err);
  } finally {
    clearTimeout(timer);
  }
}

async function openFile(file) {
  const t0 = performance.now();
  const problem = fileProblem(file);
  if (problem) return fail(problem, file?.name);
  const push = !rp.view && !location.search;
  // Guardar copia física en la carpeta /libros del proyecto
  await saveBookPhysically(file);
  try {
    const book = await openAny(file, file.name, { pageLabel });
    rp.timings.parse = performance.now() - t0;
    const store = await storeReady;
    const id = await bookKey(file);
    const known = (await store.listBooks()).some((b) => b.id === id);
    // Space: a new book that will not fit is still opened, just not kept (said once it's open).
    let kept = known || hasRoom(await estimate(), file.size);
    if (kept) {
      try {
        await store.putBook(file, {
          id, title: book.title, creator: book.creator, language: book.language,
          description: book.description || '',
          fileName: file.name ?? '', spineLength: book.spine.length, ...(known ? {} : { cover: await coverThumb(book) }),
        });
        if (!known) askPersist();
      } catch (e) {
        if (errorCode(e) !== 'quota') throw e;
        kept = false;
      }
    }
    const reopened = await show(book, id, { push });
    rp.kept = kept;
    if (!kept) {
      const [text, next] = problemText('quota', file.name);
      showToast({ level: 'error', text, details: [next] });
    }
    rp.timings.firstRender = performance.now() - t0;
  } catch (e) { fail(errorCode(e), file.name); }
}

async function importBookOnly(file) {
  try {
    const book = await openAny(file, file.name, { pageLabel });
    const store = await storeReady;
    const id = await bookKey(file);
    const known = (await store.listBooks()).some((b) => b.id === id);
    if (!known) {
      await store.putBook(file, {
        id,
        title: book.title || file.name.replace(/\.[^.]+$/, ''),
        creator: book.creator || '',
        language: book.language || '',
        description: book.description || '',
        fileName: file.name ?? '',
        spineLength: book.spine.length,
        cover: await coverThumb(book),
      });
      askPersist();
      return true;
    }
  } catch (err) {
    console.warn('importBookOnly error:', file?.name, err);
  }
  return false;
}
rp.importBookOnly = importBookOnly;

async function openStored(id, { push = false } = {}) {
  try {
    const store = await storeReady;
    const rec = await store.getBook(id);
    if (!rec) return fail('gone');
    const book = await openAny(rec.blob, rec.meta?.fileName, { pageLabel });
    if (typeof rec.meta?.cover !== 'string' || !rec.meta.cover.startsWith('data:')) {
      const freshCover = await coverThumb(book);
      if (freshCover) rec.meta = { ...rec.meta, cover: freshCover };
    }
    await store.putBook(rec.blob, rec.meta); // most recently opened first on the shelf
    await show(book, id, { push });
  } catch (e) { fail(errorCode(e)); }
}

// Tier 2: the service worker redirects file:///….epub (.fb2, .fbz, .cbz) here as ?src=<file URL>.
async function openSrc(url) {
  if (!/^file:/i.test(url)) { fail('not-local'); return; }
  let blob;
  try {
    const res = await fetch(url);
    blob = await res.blob();
  } catch {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    fail(allowed ? 'unreadable' : 'file-access');
    return;
  }
  const name = decodeURIComponent(url.split('/').pop());
  openFile(new File([blob], name, { type: blob.type }));
}

async function addFilesToLibrary(files) {
  let count = 0;
  let lastTitle = '';
  for (const file of files) {
    if (file.name?.toLowerCase().endsWith(`.${EXTENSION}`)) {
      await openLibraryFile(file);
      continue;
    }
    await saveBookPhysically(file);
    const ok = await importBookOnly(file);
    if (ok) {
      count++;
      lastTitle = file.name.replace(/\.[^.]+$/, '');
    }
  }
  await renderLibrary();
  if (count === 1) {
    showToast({ text: `${t('book_added')}: ${lastTitle}` });
  } else if (count > 1) {
    showToast({ text: `${count} ${t('books_added')}` });
  }
}

const pickFile = () => $('file').click();
$('file').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (files && files.length) {
    if (!$('library').hidden) {
      await addFilesToLibrary(files);
    } else {
      for (const f of files) await openFile(f);
    }
  }
  e.target.value = '';
});

function backToLibrary() {
  if (history.state?.lib) history.back();
  else showLibrary();
}

// ---- moving through the book -----------------------------------------------------------
rp.turn = async (dir) => {
  if (!rp.view) return;
  hideChrome();
  await (dir > 0 ? rp.view.next() : rp.view.prev());
  settle();
};
rp.goToProgress = (f) => rp.view.goTo(atProgress(f, rp.book.spine.map((s) => s.size)));
rp.setMode = async (m) => {
  if (!rp.view || m === rp.view.mode) return;
  $('reading').classList.toggle('paged', m === 'paged');
  await rp.view.setMode(m);
  wheelFor(m);
  syncMode();
  await (await storeReady).setSetting('mode', m);
  pending = { pos: rp.view.position, progress: rp.view.progress };
  await flush();
};
rp.setStyle = setStyle;
rp.search = runSearch;
rp.addBookmark = addBookmark;
rp.bookmarks = async () => (await storeReady).listBookmarks(rp.bookId);
rp.highlight = highlightSelection;
rp.highlights = highlights;
rp.exportHighlights = exportHighlights;
rp.openFile = openFile;
rp.openStored = openStored;

const typing = (n) => n?.closest?.('input, textarea, select, [contenteditable="true"]');
document.addEventListener('keydown', (e) => {
  rp.lastActive = Date.now();
  if (e.key === 'Escape') {
    if (closeKeys() || closeHighlightBar() || closeSettings() || closePanel()) e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || $('keys').open) return;
  if (e.key === '?') { e.preventDefault(); openKeys(); return; }
  if ($('reading').hidden) {
    if (e.key === 'o') { e.preventDefault(); pickFile(); }
    return;
  }
  if (!rp.view) return;
  const k = e.key;
  const shortcut = { '/': () => openPanel('search'), t: () => (closeSettings(false), $('btn-toc').click()), b: toggleBookmark, h: () => highlightSelection().then(() => closeHighlightBar()), '+': () => bumpSize(1), '=': () => bumpSize(1), '-': () => bumpSize(-1) }[k];
  if (shortcut) { e.preventDefault(); shortcut(); return; }
  // Page keys move the book unless focus is on a control that uses them itself (slider, radio
  // group, lists in the panel, popover, toolbar). A bar button doesn't, so after using one the
  // arrows still turn pages; only Space/Enter stay with the button (they press it).
  if (e.target.closest('[role="slider"], [role="radio"], .panel, .popover, .hl-bar, dialog')) return;
  if (e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  const paged = rp.view.mode === 'paged';
  const rtl = rp.book.dir === 'rtl';
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  let dir = 0;
  if (k === 'PageDown' || (k === ' ' && !e.shiftKey) || k === fwd) dir = 1;
  else if (k === 'PageUp' || (k === ' ' && e.shiftKey) || k === back) dir = -1;
  else if (k === 'ArrowDown' || k === 'ArrowUp') {
    if (paged) dir = k === 'ArrowDown' ? 1 : -1;
    else { e.preventDefault(); $('view').scrollBy({ top: k === 'ArrowDown' ? 80 : -80, behavior: 'smooth' }); return; }
  } else if (k === 'Home' || k === 'End') {
    e.preventDefault();
    hideChrome();
    rp.goToProgress(k === 'Home' ? 0 : 1);
    return;
  }
  if (!dir) return;
  e.preventDefault();
  rp.turn(dir);
});

// Page mode: a wheel or trackpad swipe turns the page. Attached in page mode only: a
// non-passive wheel listener makes every scroll-mode wheel event wait for the main thread.
let wheelSum = 0;
let wheelAt = 0;
function onPagedWheel(e) {
  if (rp.view?.mode !== 'paged') return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelAt < 350) return;
  wheelSum += e.deltaY + e.deltaX;
  if (Math.abs(wheelSum) < 40) return;
  wheelAt = now;
  rp.turn(Math.sign(wheelSum));
  wheelSum = 0;
}
function wheelFor(mode) {
  $('view')[mode === 'paged' ? 'addEventListener' : 'removeEventListener']('wheel', onPagedWheel, { passive: false });
}

// ---- drop anywhere; every rejected drop says why ------------------------------------------
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
function dragState(on) {
  document.body.classList.toggle('dragging', on);
  $('veil').hidden = !on || !$('library').hidden;
}
document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dragState(true); });
document.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dragState(false); } });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dragState(false);
  const files = e.dataTransfer?.files;
  if (!files || !files.length) { fail('no-file'); return; }
  if (!$('library').hidden) {
    await addFilesToLibrary(files);
  } else {
    for (const file of files) {
      if (file.name?.toLowerCase().endsWith(`.${EXTENSION}`)) { await openLibraryFile(file); continue; }
      await openFile(file);
    }
  }
});

/** A dropped library file is imported into the library, wherever it was dropped. */
async function openLibraryFile(file) {
  if ($('library').hidden) await showLibrary();
  await importFile(file);
}

// Internal book links (rewritten by the loader to data-rp-href).
document.addEventListener('click', (e) => {
  const a = e.composedPath().find((n) => n.dataset?.rpHref);
  if (!a || !rp.view) return;
  e.preventDefault();
  hideChrome();
  rp.view.goToHref(a.dataset.rpHref);
});
for (const type of ['pointerdown', 'scroll', 'wheel']) addEventListener(type, () => { rp.lastActive = Date.now(); }, { passive: true, capture: true });

// ---- active reading: stats per book (IndexedDB) and support milestones (5+ minutes a day) ----
// Counts only while a book is open, the tab visible and the reader active in the last 2 minutes.
const TICK = 15000;
async function readingTick() {
  if (!rp.view || document.hidden || Date.now() - (rp.lastActive ?? 0) > 2 * 60 * 1000) return;
  const { bookId } = rp;
  if (rp.kept !== false) { // a book not kept in the library (no room) gets no stats either
    try {
      const store = await storeReady;
      await store.putStats(addStatTime(await store.getStats(bookId), bookId, Date.now(), TICK));
    } catch { /* no stats this tick; reading goes on */ }
  }
  try {
    const { rpReadDay } = await chrome.storage.local.get('rpReadDay');
    const { state } = addReadingTime(rpReadDay, bookId, localDay(Date.now()), TICK);
    await chrome.storage.local.set({ rpReadDay: state });
  } catch { /* storage unavailable: no milestone, nothing breaks */ }
}
rp.readingTick = readingTick;
setInterval(readingTick, TICK);

// ---- start ------------------------------------------------------------------------------
async function route() {
  const src = location.search.match(/[?&]src=(.*)$/)?.[1];
  const id = new URLSearchParams(location.search).get('book');
  if (src) return openSrc(src);
  const remote = new URLSearchParams(location.search);
  if (remote.has('url')) { await showLibrary(); return openRemote(remote.get('url'), { openFile, denied: remote.has('denied') }); }
  if (id && id === rp.bookId && rp.view) { $('library').hidden = true; $('reading').hidden = false; return; }
  if (id) return openStored(id);
  return showLibrary();
}
addEventListener('popstate', route);

localizeDom();
initLibrary({ store: await storeReady, openBook: (id) => openStored(id, { push: true }), pickFile, addFiles: addFilesToLibrary });
initReading(rp, { store: await storeReady, onBack: backToLibrary });
initHighlights(rp, { store: await storeReady });
const veilIcon = $('veil-icon');
if (veilIcon) {
  const img = document.createElement('img');
  img.src = 'icons/libro.jpg';
  img.alt = '';
  img.style.width = '44px';
  img.style.height = '44px';
  img.style.borderRadius = '10px';
  img.style.objectFit = 'cover';
  veilIcon.append(img);
}
applyReadingTheme(await (await storeReady).getSetting('theme', null));
route();
