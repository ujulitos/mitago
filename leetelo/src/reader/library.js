// The library: the reader's home. First run = one big drop zone; afterwards a
// shelf of books (cover, title, author, % read). Failed opens are explained
// here, in place.

import '../lib/chrome-shim.js';
import { icon, logo } from '../lib/icons.js';
import { t, tn, uiLanguage } from '../lib/i18n.js';
import { showToast } from '../lib/toast.js';
import { $, el, formatSize, hideLoadingOverlay, labelled, setLoadingOverlayText, showLoadingOverlay } from './dom.js';
import { ERROR_FALLBACK, errorCode, localDay, percent } from './logic.js';
import { hoursMinutes, libraryStats } from './stats.js';
import { EXTENSION } from './libfile.js';
import { importLibrary } from './libio.js';
import { openAny } from '../core/formats.js';

const local = {
  get: async (key, fallback) => { try { return (await chrome.storage.local.get(key))[key] ?? fallback; } catch { return fallback; } },
  set: (key, value) => chrome.storage.local.set({ [key]: value }).catch(() => {}),
};

var ctx = null; // { store, openBook(id), pickFile() }
let urls = [];
let currentMetaBookId = null;
let currentMetaTrigger = null;

const selectedBookIds = new Set();
let selectionMode = false;
let allTodosBooks = [];
let currentCategories = {};
let activeLongPressCancel = null;

async function deleteBookRecord(book, categories, persistCategories = true) {
  await ctx.store.deleteBook(book.id);
  if (book.fileName && navigator.onLine !== false) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    try {
      await fetch(`/api/libros?name=${encodeURIComponent(book.fileName)}`, { method: 'DELETE', signal: ac.signal });
    } catch {} finally {
      clearTimeout(timer);
    }
  }
  if (categories && categories[book.id]) {
    delete categories[book.id];
    if (persistCategories) await ctx.store.setSetting('book_categories', categories);
  }
}

function closeBatchConfirm() {
  const main = $('batch-bar-main');
  const confirm = $('batch-confirm');
  if (confirm) confirm.hidden = true;
  if (main) main.hidden = false;
}

function syncBatchSelectionUI() {
  const libraryEl = $('library');
  const todosEl = $('todos');
  const bar = $('batch-bar');
  if (libraryEl) libraryEl.classList.toggle('is-selecting', selectionMode);
  if (todosEl) todosEl.classList.toggle('is-selecting', selectionMode);

  if (todosEl) {
    const items = todosEl.querySelectorAll('.books-all > .book');
    for (const li of items) {
      const id = li.dataset.id;
      const isSelected = selectionMode && selectedBookIds.has(id);
      li.classList.toggle('selected', isSelected);
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  if (!bar) return;
  bar.hidden = !selectionMode;
  if (!selectionMode) {
    closeBatchConfirm();
    return;
  }

  closeBatchConfirm();
  const count = selectedBookIds.size;
  const countEl = $('batch-count');
  if (countEl) countEl.textContent = tn('selected', count);

  const selectAllBtn = $('batch-select-all');
  if (selectAllBtn) {
    const allSelected = allTodosBooks.length > 0 && allTodosBooks.every((b) => selectedBookIds.has(b.id));
    selectAllBtn.textContent = allSelected ? t('deselect_all') : t('select_all');
    selectAllBtn.disabled = allTodosBooks.length === 0;
  }

  const delBtn = $('batch-delete');
  if (delBtn) {
    delBtn.disabled = count === 0;
    delBtn.textContent = count > 0 ? `${t('delete')} (${count})` : t('delete');
  }
}

function enterSelectionMode(bookId) {
  const todosEl = $('todos');
  if (todosEl) {
    for (const box of todosEl.querySelectorAll('.confirm')) box.remove();
  }
  selectionMode = true;
  if (bookId) selectedBookIds.add(bookId);
  try { navigator.vibrate?.(15); } catch {}
  syncBatchSelectionUI();
}

export function exitSelectionMode() {
  if (!selectionMode && !selectedBookIds.size) return;
  selectionMode = false;
  selectedBookIds.clear();
  syncBatchSelectionUI();
}

function toggleBookSelection(bookId) {
  if (!selectionMode) return;
  if (selectedBookIds.has(bookId)) selectedBookIds.delete(bookId);
  else selectedBookIds.add(bookId);
  if (selectedBookIds.size === 0) {
    exitSelectionMode();
    return;
  }
  syncBatchSelectionUI();
}

function openBatchConfirm() {
  const count = selectedBookIds.size;
  if (!count) return;
  const selected = allTodosBooks.filter((b) => selectedBookIds.has(b.id));
  const totalBytes = selected.reduce((sum, b) => sum + (b.size ?? 0), 0);
  const confirm = $('batch-confirm');
  const main = $('batch-bar-main');
  const text = $('batch-confirm-text');
  if (!confirm || !main || !text) return;
  text.textContent = `${tn('delete_selected_q', count)} · ${t('frees', formatSize(totalBytes, uiLanguage()))}`;
  main.hidden = true;
  confirm.hidden = false;
  $('batch-confirm-keep')?.focus();
}

async function executeBatchDelete() {
  const ids = [...selectedBookIds];
  if (!ids.length) return;
  const yesBtn = $('batch-confirm-yes');
  if (yesBtn) yesBtn.disabled = true;
  showLoadingOverlay(ids.length > 1 ? t('deleting_progress', 1, ids.length) : t('deleting_books'));
  await new Promise((r) => requestAnimationFrame(() => r()));
  try {
    const byId = new Map(allTodosBooks.map((b) => [b.id, b]));
    let deletedCount = 0;
    let categoriesChanged = false;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (ids.length > 1) {
        setLoadingOverlayText(t('deleting_progress', i + 1, ids.length));
      }
      const book = byId.get(id);
      if (!book) continue;
      if (currentCategories && currentCategories[id]) categoriesChanged = true;
      await deleteBookRecord(book, currentCategories, false);
      if (currentMetaBookId === id) closeMetadataModal();
      deletedCount++;
    }
    if (categoriesChanged) {
      await ctx.store.setSetting('book_categories', currentCategories);
    }
    exitSelectionMode();
    await renderLibrary();
    if (deletedCount > 0) {
      showToast({ text: tn('deleted_batch', deletedCount) });
    }
    $('lib-menu-btn')?.focus();
  } finally {
    hideLoadingOverlay();
    if (yesBtn) yesBtn.disabled = false;
  }
}

export function closeMetadataModal() {
  const modal = $('meta-modal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
  if (currentMetaTrigger) {
    currentMetaTrigger.classList.remove('active');
    currentMetaTrigger.setAttribute('aria-pressed', 'false');
    currentMetaTrigger.focus();
  }
  currentMetaBookId = null;
  currentMetaTrigger = null;
}

function renderHtmlSynopsis(container, html) {
  if (!html || !html.trim()) {
    container.textContent = t('no_synopsis');
    return;
  }
  // Si no tiene etiquetas HTML, separamos párrafos por saltos de línea
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    const paras = html.split(/\n\s*\n/).filter(Boolean);
    if (paras.length > 1) {
      container.replaceChildren(...paras.map((p) => el('p', { textContent: p.trim() })));
      return;
    }
  }
  // Parser HTML con sanitización de etiquetas no seguras
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  for (const dangerous of doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, button, input')) {
    dangerous.remove();
  }
  for (const elNode of doc.querySelectorAll('*')) {
    for (const attr of [...elNode.attributes]) {
      if (/^on/i.test(attr.name) || (/^(src|href)$/i.test(attr.name) && /^javascript:/i.test(attr.value))) {
        elNode.removeAttribute(attr.name);
      }
    }
  }
  container.replaceChildren(...doc.body.childNodes);
}

export function openMetadataModal(book, pos, stat, triggerBtn) {
  currentMetaBookId = book.id;
  currentMetaTrigger = triggerBtn;
  if (triggerBtn) {
    triggerBtn.classList.add('active');
    triggerBtn.setAttribute('aria-pressed', 'true');
  }

  document.body.style.overflow = 'hidden';

  const modalHeading = $('meta-modal-heading');
  if (modalHeading) modalHeading.textContent = t('synopsis_title');

  const body = $('meta-modal-body');
  if (!body) return;

  // Cover column (sin botón de abrir)
  const coverWrap = el('div', { class: 'modal-cover-wrap' }, coverOf(book));
  const coverCol = el('div', { class: 'modal-cover-col' }, coverWrap);

  // Info & metadata column (solo formato, tamaño, capítulos y páginas)
  const title = el('h4', { class: 'modal-title', textContent: book.title || t('untitled') });
  const author = el('p', { class: 'modal-author', textContent: book.creator || '—' });

  const format = (book.fileName || '').split('.').pop().toUpperCase() || 'EPUB';
  const size = book.size ? formatSize(book.size, uiLanguage()) : '—';
  const chapters = book.spineLength ? String(book.spineLength) : (book.spine?.length ? String(book.spine.length) : '—');
  const pages = book.pages
    ? String(book.pages)
    : (book.format === 'cbz' || (book.fileName || '').toLowerCase().endsWith('.cbz')
      ? String(book.spineLength || chapters)
      : (book.size ? `~${Math.max(Math.round(book.size / 2200), book.spineLength || 1)}` : '—'));

  const row = (label, val) => [
    el('dt', { textContent: label }),
    el('dd', { textContent: val })
  ];

  const grid = el('dl', { class: 'modal-meta-grid' },
    ...row(t('meta_format'), format),
    ...row(t('meta_size'), size),
    ...row(t('meta_chapters'), chapters),
    ...row(t('meta_pages'), pages)
  );

  // Sinopsis en formato HTML
  const synopsisHead = el('h5', { class: 'modal-synopsis-head', textContent: t('synopsis') });
  const synopsisText = el('div', { class: 'modal-synopsis-text' });
  const synopsisSection = el('div', { class: 'modal-synopsis-section' }, synopsisHead, synopsisText);

  if (book.description) {
    renderHtmlSynopsis(synopsisText, book.description);
  } else {
    synopsisText.textContent = t('loading_synopsis');
    if (ctx?.store?.getBook) {
      ctx.store.getBook(book.id).then(async (data) => {
        if (data?.meta?.description) {
          book.description = data.meta.description;
          if (currentMetaBookId === book.id) renderHtmlSynopsis(synopsisText, book.description);
          return;
        }
        if (data?.blob) {
          try {
            const opened = await openAny(data.blob, book.fileName);
            const desc = (opened?.description || '').trim();
            if (desc) {
              book.description = desc;
              if (currentMetaBookId === book.id) renderHtmlSynopsis(synopsisText, desc);
              try {
                await ctx.store.putBook(data.blob, { ...data.meta, description: desc });
              } catch {}
              return;
            }
          } catch (e) {
            console.warn('Error reading book synopsis:', e);
          }
        }
        if (currentMetaBookId === book.id) {
          synopsisText.textContent = t('no_synopsis');
        }
      }).catch(() => {
        if (currentMetaBookId === book.id) {
          synopsisText.textContent = t('no_synopsis');
        }
      });
    } else {
      synopsisText.textContent = t('no_synopsis');
    }
  }

  const infoCol = el('div', { class: 'modal-info-col' }, title, author, grid, synopsisSection);

  body.replaceChildren(coverCol, infoCol);

  const modal = $('meta-modal');
  if (modal) modal.hidden = false;
  $('meta-modal-close')?.focus();
}

// ---- the drawing in the drop zone: cover art from icons/libro.jpg --------
function dropArt() {
  const img = document.createElement('img');
  img.src = 'icons/libro.jpg';
  img.alt = '';
  img.className = 'drop-art-img';
  return img;
}

// ---- notices: every failed open says what happened and what to do next -------------
export function showNotice(code, { name = '', level = 'error' } = {}) {
  const notice = $('notice');
  notice.className = `notice ${level}`;
  $('notice-icon').replaceChildren(icon(level === 'error' ? 'alert' : 'info', 20));
  [$('notice-title').textContent, $('notice-next').textContent] = problemText(code, name);
  notice.hidden = false;
  notice.dataset.code = code;
}
export function hideNotice() { $('notice').hidden = true; }

/** The two lines for a code, for toasts in the reading view. */
export function problemText(code, name = '') {
  const key = `err_${code.replace(/-/g, '_')}`;
  if (t(key) !== key) return [t(key, name), t(`${key}_next`, name)];
  return ERROR_FALLBACK[code] ? problemText(ERROR_FALLBACK[code], name) : [t('err_unexpected'), t('err_unexpected_next')];
}

// ---- shelf -----------------------------------------------------------------------
const healingIds = new Set();
async function healBookCover(book) {
  if (!book?.id || healingIds.has(book.id) || !ctx?.store) return;
  healingIds.add(book.id);
  try {
    const rec = await ctx.store.getBook(book.id);
    if (!rec?.blob) return;
    const parsed = await openAny(rec.blob, rec.meta?.fileName || book.fileName);
    if (!parsed?.cover) return;
    const bmp = await createImageBitmap(await parsed.zip.blob(parsed.cover));
    const w = Math.min(320, bmp.width);
    const h = Math.round((bmp.height / bmp.width) * w);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (!dataUrl) return;
    await ctx.store.putBook(rec.blob, { ...rec.meta, cover: dataUrl, preserveOpenedAt: true });
    for (const img of document.querySelectorAll(`[data-id="${CSS.escape(book.id)}"] .cover-btn img`)) {
      img.src = dataUrl;
    }
  } catch { /* ignore */ } finally {
    healingIds.delete(book.id);
  }
}

function coverOf(book) {
  if (typeof book.cover === 'string' && book.cover.startsWith('data:')) {
    return el('img', { src: book.cover, alt: '', decoding: 'async' });
  }
  if (book.cover instanceof Blob && book.cover.size > 0) {
    const url = URL.createObjectURL(book.cover);
    urls.push(url);
    const img = el('img', { src: url, alt: '', decoding: 'async' });
    img.addEventListener('error', () => {
      img.src = 'icons/libro.jpg';
      healBookCover(book);
    }, { once: true });
    healBookCover(book);
    return img;
  }
  const img = el('img', { src: 'icons/libro.jpg', alt: book.title || '', decoding: 'async' });
  healBookCover(book);
  return img;
}

function readLabel(pos) {
  if (!pos) return t('not_started');
  const p = percent(pos.progress ?? 0);
  return p >= 100 ? t('finished') : t('percent', p);
}

/** "3 h 12 min" / "12 min" (null under a minute). */
function duration(ms, zero = false) {
  const { h, m } = hoursMinutes(ms);
  if (!h && !m && !zero) return null;
  return h ? t('time_hm', h, m) : t('time_m', m);
}

export function resolveCategory(bookId, pos, categories) {
  const manual = categories?.[bookId];
  if (manual === 'none') return 'all_books';
  if (manual === 'reading') return 'reading';
  if (manual === 'to_read') return 'to_read';
  if (manual === 'read') return 'read';

  if (pos && percent(pos.progress ?? 0) >= 100) {
    return 'read';
  }
  if (pos && (pos.progress ?? 0) > 0) {
    return 'reading';
  }
  return 'all_books';
}

function bookItem(book, pos, stat, category, categories) {
  const title = book.title || t('untitled');
  const label = readLabel(pos);
  const isAllBooks = category === 'all_books';
  const selectBadge = isAllBooks
    ? el('span', { class: 'select-check', 'aria-hidden': 'true' }, icon('check', 14))
    : null;
  const coverChildren = selectBadge ? [coverOf(book), selectBadge] : [coverOf(book)];
  const cover = el('button', {
    type: 'button',
    class: 'cover-btn',
    'aria-label': pos ? t('continue_book', title, label) : t('open_named', title)
  }, ...coverChildren);

  let suppressClickUntil = 0;
  cover.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isAllBooks && selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      toggleBookSelection(book.id);
      return;
    }
    ctx.openBook(book.id);
  });

  const pct = pos ? percent(pos.progress ?? 0) : 0;
  const hasProg = pct > 0;
  const isDone = pct >= 100;

  const format = (book.fileName || '').split('.').pop().toUpperCase() || 'EPUB';

  const formatSizeEl = el('span', { class: 'format-size' },
    format ? el('span', { class: 'fmt-txt', textContent: format }) : null,
    pct > 0 ? el('span', { class: 'meta-pct', textContent: `${pct}%` }) : null
  );

  const meta = el('div', { class: 'meta' },
    el('span', { class: 'title', textContent: title }),
    el('span', { class: 'author', textContent: book.creator || '\u00A0' }),
    formatSizeEl
  );

  const readLine = el('div', {
    class: `read-line${hasProg ? ' has-progress' : ''}${isDone ? ' is-complete' : ''}`,
    'aria-hidden': 'true'
  }, el('span', { style: `width:${pct}%` }));

  // Botones de acción: Leyendo, Por leer, Leído, Sinopsis, Eliminar
  const effectiveCat = resolveCategory(book.id, pos, categories);
  const isMeta = currentMetaBookId === book.id;
  const isReading = !isMeta && effectiveCat === 'reading';
  const isToRead = !isMeta && effectiveCat === 'to_read';
  const isRead = !isMeta && effectiveCat === 'read';

  const btnReading = labelled(el('button', {
    type: 'button',
    class: `book-action-btn btn-reading${isReading ? ' active' : ''}`,
    'aria-pressed': String(isReading),
  }, icon('book', 18)), t('btn_reading'));

  btnReading.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnReading.blur();
    closeMetadataModal();
    if (effectiveCat === 'reading') {
      categories[book.id] = 'none';
    } else {
      categories[book.id] = 'reading';
    }
    await ctx.store.setSetting('book_categories', categories);
    await renderLibrary();
  });

  const btnToRead = labelled(el('button', {
    type: 'button',
    class: `book-action-btn btn-to-read${isToRead ? ' active' : ''}`,
    'aria-pressed': String(isToRead),
  }, icon('clock', 18)), t('btn_to_read'));

  btnToRead.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnToRead.blur();
    closeMetadataModal();
    if (effectiveCat === 'to_read') {
      categories[book.id] = 'none';
    } else {
      categories[book.id] = 'to_read';
    }
    await ctx.store.setSetting('book_categories', categories);
    await renderLibrary();
  });

  const btnRead = labelled(el('button', {
    type: 'button',
    class: `book-action-btn btn-read${isRead ? ' active' : ''}`,
    'aria-pressed': String(isRead),
  }, icon('checkDouble', 18)), t('btn_read'));

  btnRead.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnRead.blur();
    closeMetadataModal();
    if (effectiveCat === 'read') {
      categories[book.id] = 'none';
    } else {
      categories[book.id] = 'read';
    }
    await ctx.store.setSetting('book_categories', categories);
    await renderLibrary();
  });

  const btnMeta = labelled(el('button', {
    type: 'button',
    class: `book-action-btn btn-meta${isMeta ? ' active' : ''}`,
    'aria-pressed': String(isMeta),
  }, icon('books', 18)), t('btn_synopsis'));

  btnMeta.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentMetaBookId === book.id) {
      closeMetadataModal();
    } else {
      if (currentMetaBookId) closeMetadataModal();
      openMetadataModal(book, pos, stat, btnMeta);
    }
  });

  const actionBtns = [btnReading, btnToRead, btnRead, btnMeta];
  let btnDel = null;
  if (category === 'all_books') {
    btnDel = labelled(el('button', {
      type: 'button',
      class: 'book-action-btn btn-delete',
    }, icon('trash', 18)), t('delete'));
    actionBtns.push(btnDel);
  }

  const actions = el('div', { class: 'book-actions' }, ...actionBtns);

  const li = el('li', { class: 'book', dataset: { id: book.id } },
    cover,
    meta,
    readLine,
    actions
  );

  if (btnDel) {
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(li, book, btnDel, categories);
    });
  }

  if (isAllBooks) {
    let lpTimer = 0;
    let startX = 0;
    let startY = 0;
    let lastPointerType = '';
    const cancelLongPress = () => {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = 0;
      }
      if (activeLongPressCancel === cancelLongPress) activeLongPressCancel = null;
    };

    li.addEventListener('pointerdown', (e) => {
      lastPointerType = e.pointerType || '';
      suppressClickUntil = 0;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.confirm')) return;
      if (!selectionMode && e.target.closest('.book-actions')) return;
      if (selectionMode) return;
      cancelLongPress();
      startX = e.clientX;
      startY = e.clientY;
      activeLongPressCancel = cancelLongPress;
      lpTimer = setTimeout(() => {
        lpTimer = 0;
        if (activeLongPressCancel === cancelLongPress) activeLongPressCancel = null;
        suppressClickUntil = Date.now() + 800;
        enterSelectionMode(book.id);
      }, 450);
    });

    li.addEventListener('pointermove', (e) => {
      if (!lpTimer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
        cancelLongPress();
      }
    });

    li.addEventListener('pointerup', cancelLongPress);
    li.addEventListener('pointercancel', cancelLongPress);

    li.addEventListener('contextmenu', (e) => {
      if (lastPointerType !== 'mouse' || selectionMode || Date.now() < suppressClickUntil) {
        e.preventDefault();
      }
    });

    li.addEventListener('click', (e) => {
      if (!selectionMode) return;
      if (e.target.closest('.cover-btn') || e.target.closest('.confirm')) return;
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggleBookSelection(book.id);
    });
  }

  return li;
}

/** Inline confirm on the cover itself; Keep is focused (the safe choice). */
function confirmDelete(li, book, del, categories) {
  li.querySelector('.confirm')?.remove();
  const keep = el('button', { type: 'button', class: 'no', textContent: t('keep') });
  const yes = el('button', { type: 'button', class: 'yes', textContent: t('delete') });
  const box = el('div', { class: 'confirm', role: 'group', 'aria-label': t('delete_named', book.title || t('untitled')) },
    el('p', { textContent: t('delete_q') }),
    el('p', { class: 'frees', textContent: t('frees', formatSize(book.size ?? 0, uiLanguage())) }),
    yes, keep);
  const close = () => { box.remove(); del.focus(); };
  keep.addEventListener('click', close);
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  yes.addEventListener('click', async () => {
    await deleteBookRecord(book, categories, true);
    selectedBookIds.delete(book.id);
    const next = li.nextElementSibling ?? li.previousElementSibling;
    await renderLibrary();
    const target = next && document.querySelector(`[data-id="${CSS.escape(next.dataset.id)}"] .cover-btn`);
    if (target) target.focus();
    else $('lib-menu-btn')?.focus();
  });
  li.append(box);
  keep.focus();
}

async function renderStorage() {
  const storageEl = $('storage');
  if (!storageEl) return;
  try {
    const { usage } = await navigator.storage.estimate();
    storageEl.textContent = formatSize(usage ?? 0, uiLanguage());
  } catch { storageEl.textContent = '—'; }
}

// ---- reading stats (inside hamburger menu drawer) ----------------------
function renderStats(stats, positions) {
  const s = libraryStats(stats, positions, localDay(Date.now()));
  const statsEl = $('stats');
  if (statsEl) statsEl.hidden = false;
  const item = (label, value) => el('div', {}, el('dt', { textContent: label }), el('dd', { textContent: value }));
  $('stats-list')?.replaceChildren(
    item(t('stats_total'), duration(s.total, true)),
    item(t('stats_week'), duration(s.week, true)),
    item(t('stats_streak'), tn('days_count', s.streak)),
    item(t('stats_finished'), String(s.finished)));
}

// ---- export / import helper ---------------------------------------------
async function busy(fn) {
  return fn();
}

/** Merge a .readpane file into the library; says what came in, or why nothing did. */
export async function importFile(file) {
  const lang = uiLanguage();
  let estimate = null;
  try { estimate = await navigator.storage.estimate(); } catch { /* unknown: the writes still catch quota */ }
  await busy(async () => {
    try {
      const r = await importLibrary(ctx.store, file, estimate);
      window.__rp.imported = r;
      await renderLibrary();
      const details = [
        r.bookmarks && tn('import_bookmarks', r.bookmarks),
        r.highlights && tn('import_highlights', r.highlights),
        r.kept && tn('import_kept', r.kept),
      ].filter(Boolean);
      showToast({ text: tn('import_books', r.books), details });
    } catch (e) {
      const code = e.code === 'no-room' || e.code === 'newer' ? e.code : errorCode(e) === 'quota' ? 'quota' : 'not-library';
      window.__rp.imported = { error: code };
      if (code === 'quota') await renderLibrary(); // the books written before the disk filled up are in
      const text = {
        'no-room': t('import_no_room', formatSize(e.need ?? 0, lang), formatSize(e.free ?? 0, lang)),
        newer: t('import_newer'),
        quota: t('import_quota'),
        'not-library': t('import_bad', file.name ?? ''),
      }[code];
      showToast({ level: 'error', text, details: [t(code === 'not-library' || code === 'newer' ? 'import_bad_next' : 'import_no_room_next')] });
    }
  });
}

// ---- quiet cards ---------------------------------------------------------------------
async function renderTier2() {
  let allowed = true;
  try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch { /* not in an extension page */ }
  const dismissed = await local.get('rpTier2Dismissed', false);
  $('tier2').hidden = allowed || dismissed;
  if ($('tier2').hidden) return;
  const link = `chrome://extensions/?id=${chrome.runtime.id}`;
  $('tier2-link').textContent = link;
  $('tier2-body').textContent = t('tier2_body', t('tier2_toggle'));
}

const WHATS_NEW = '1.1'; // set by the service worker on an update from an older version
async function renderWhatsNew() {
  $('whats-new').hidden = (await local.get('rpWhatsNew', null)) !== WHATS_NEW;
}
function closeWhatsNew() {
  local.set('rpWhatsNew', `seen-${WHATS_NEW}`);
  $('whats-new').hidden = true;
}

// ---- render ----------------------------------------------------------------------------
let syncDone = false;
async function syncFromLibros(store) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const current = await store.listBooks();
    const alreadySynced = await store.getSetting('libros_synced', false);
    if (current.length > 0 || alreadySynced) {
      if (!alreadySynced && current.length > 0) {
        await store.setSetting('libros_synced', true);
      }
      return false;
    }
  } catch {
    return false;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    let res = await fetch('/api/libros', { signal: ac.signal });
    if (!res.ok) res = await fetch('/api/books', { signal: ac.signal });
    if (!res.ok) return false;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return false;

    const current = await store.listBooks();
    if (current.length > 0) {
      await store.setSetting('libros_synced', true);
      return false;
    }
    const currentFiles = new Set(current.map((b) => (b.fileName || '').toLowerCase()));
    let anyAdded = false;

    for (const item of list) {
      if (currentFiles.has((item.name || '').toLowerCase())) continue;
      try {
        const fileRes = await fetch(item.url || `/libros/${encodeURIComponent(item.name)}`);
        if (!fileRes.ok) continue;
        const blob = await fileRes.blob();
        const file = new File([blob], item.name, { type: blob.type });
        if (window.__rp?.importBookOnly) {
          const ok = await window.__rp.importBookOnly(file);
          if (ok) anyAdded = true;
        }
      } catch (e) {
        console.warn('Error syncing book from /libros:', item.name, e);
      }
    }
    await store.setSetting('libros_synced', true);
    return anyAdded;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let currentSortBy = 'date';
let currentSortDir = 'desc';
let sortLoaded = false;

const normSearch = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function sortAllBooks(list, sortBy, sortDir) {
  const lang = uiLanguage();
  const dir = sortDir === 'asc' ? 1 : -1;
  const cmpStr = (a, b) => a.localeCompare(b, lang, { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => {
    const titleA = a.title || t('untitled');
    const titleB = b.title || t('untitled');
    if (sortBy === 'title') {
      const c = cmpStr(titleA, titleB) * dir;
      return c !== 0 ? c : ((b.addedAt ?? 0) - (a.addedAt ?? 0));
    }
    if (sortBy === 'author') {
      const authA = (a.creator || '').trim();
      const authB = (b.creator || '').trim();
      if (!authA && authB) return 1;
      if (authA && !authB) return -1;
      const c = cmpStr(authA, authB) * dir;
      return c !== 0 ? c : cmpStr(titleA, titleB);
    }
    // 'date' (fecha de importación)
    const dateA = a.addedAt ?? 0;
    const dateB = b.addedAt ?? 0;
    if (dateA !== dateB) return (dateA - dateB) * dir;
    return cmpStr(titleA, titleB);
  });
}

let renderSeq = 0;

export async function renderLibrary() {
  const { store } = ctx;
  const seq = ++renderSeq;
  if (!syncDone) {
    syncDone = true;
    const added = await syncFromLibros(store);
    if (added) {
      return renderLibrary();
    }
  }
  if (seq !== renderSeq) return;
  if (!sortLoaded) {
    sortLoaded = true;
    const savedSort = await store.getSetting('books_sort', null);
    if (savedSort && savedSort.sortBy) {
      currentSortBy = savedSort.sortBy;
      currentSortDir = savedSort.sortDir || (currentSortBy === 'date' ? 'desc' : 'asc');
    }
  }
  const [books, positions, stats, categories] = await Promise.all([
    store.listBooks(),
    store.listPositions(),
    store.listStats(),
    store.getSetting('book_categories', {})
  ]);
  if (seq !== renderSeq) return;
  const oldUrls = urls;
  urls = [];
  const byId = new Map(positions.map((p) => [p.bookId, p]));
  const statOf = new Map(stats.map((s) => [s.bookId, s]));
  const has = books.length > 0;
  $('first-run').hidden = has;
  $('shelf').hidden = !has;
  if ($('open-top')) $('open-top').hidden = !has;
  if ($('shelf-search-wrap')) $('shelf-search-wrap').hidden = !has;
  $('shelf-count').textContent = has ? tn('books_count', books.length) : '';

  const shelfSections = $('shelf-sections');

  if (!has) {
    allTodosBooks = [];
    currentCategories = {};
    exitSelectionMode();
    if (shelfSections) shelfSections.replaceChildren();
    for (const u of oldUrls) URL.revokeObjectURL(u);
    renderStats(stats, positions);
    const infoBooksEl = $('lib-info-books');
    if (infoBooksEl) infoBooksEl.textContent = tn('books_count', 0);
    await Promise.all([renderStorage(), renderWhatsNew(), renderTier2()]);
    window.__rp.libraryReady = true;
    requestAnimationFrame(updateLibScrollbar);
    return;
  }

  const rawQuery = ($('shelf-search')?.value || '').trim();
  const q = normSearch(rawQuery);
  const clearBtn = $('shelf-search-clear');
  if (clearBtn) clearBtn.hidden = !rawQuery;

  const filteredBooks = q
    ? books.filter((b) => normSearch(b.title || t('untitled')).includes(q) || normSearch(b.creator || '').includes(q))
    : books;

  // Organizar libros en las categorías:
  // 1. Leyendo ahora
  // 2. Por leer
  // 3. Leídos
  // 4. Todos (todos los libros, aunque estén en otra categoría)
  const groups = {
    reading: [],
    to_read: [],
    read: [],
    all_books: sortAllBooks(filteredBooks, currentSortBy, currentSortDir)
  };
  allTodosBooks = groups.all_books;
  currentCategories = categories || {};
  const visibleIds = new Set(allTodosBooks.map((b) => b.id));
  for (const id of [...selectedBookIds]) {
    if (!visibleIds.has(id)) selectedBookIds.delete(id);
  }
  if (selectionMode && !selectedBookIds.size) selectionMode = false;

  for (const b of filteredBooks) {
    const cat = resolveCategory(b.id, byId.get(b.id), categories);
    if (cat === 'reading' || cat === 'to_read' || cat === 'read') {
      groups[cat].push(b);
    }
  }

  const CAT_CONFIG = [
    { id: 'reading', label: t('cat_reading'), icon: 'book', emptyKey: 'empty_reading' },
    { id: 'to_read', label: t('cat_to_read'), icon: 'clock', emptyKey: 'empty_to_read' },
    { id: 'read', label: t('cat_read'), icon: 'checkDouble', emptyKey: 'empty_read' },
    { id: 'all_books', label: t('cat_all_books'), icon: 'books', emptyKey: 'empty_all_books' },
  ];

  function buildSortControls() {
    const sortOptions = [
      { id: 'title', label: t('sort_title'), defaultDir: 'asc' },
      { id: 'author', label: t('sort_author'), defaultDir: 'asc' },
      { id: 'date', label: t('sort_date'), defaultDir: 'desc' },
    ];
    return el('div', { class: 'shelf-sort-bar', role: 'group', 'aria-label': t('sort_by') },
      el('span', { class: 'shelf-sort-label', textContent: t('sort_by') }),
      ...sortOptions.map((opt) => {
        const isActive = currentSortBy === opt.id;
        const arrow = isActive ? (currentSortDir === 'asc' ? ' ↑' : ' ↓') : '';
        const btn = el('button', {
          type: 'button',
          class: `shelf-sort-btn${isActive ? ' active' : ''}`,
          'aria-pressed': String(isActive),
          textContent: `${opt.label}${arrow}`
        });
        btn.addEventListener('click', async () => {
          if (currentSortBy === opt.id) {
            currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortBy = opt.id;
            currentSortDir = opt.defaultDir;
          }
          await store.setSetting('books_sort', { sortBy: currentSortBy, sortDir: currentSortDir });
          await renderLibrary();
        });
        return btn;
      })
    );
  }

  function renderSections() {
    if (!shelfSections) return;
    if (q && filteredBooks.length === 0) {
      shelfSections.replaceChildren(
        el('div', { class: 'shelf-cat-empty' },
          el('p', { class: 'empty-text', textContent: t('no_results', rawQuery) })
        )
      );
      return;
    }

    const sectionElements = [];

    for (const cat of CAT_CONFIG) {
      const catBooks = groups[cat.id];
      if (cat.id !== 'all_books' && !catBooks.length) {
        continue;
      }

      const isAllBooks = cat.id === 'all_books';
      const isRow = !isAllBooks;

      let content;
      let rowNav = null;

      if (catBooks.length > 0) {
        content = el('ul', { class: isRow ? 'books books-row' : 'books books-all' },
          ...catBooks.map((b) => bookItem(b, byId.get(b.id), statOf.get(b.id), cat.id, categories))
        );
        if (isRow) {
          const btnPrev = el('button', {
            type: 'button',
            class: 'icon-btn row-scroll-btn prev',
            'aria-label': t('previous_page'),
            title: t('previous_page')
          }, icon('prev', 16));
          const btnNext = el('button', {
            type: 'button',
            class: 'icon-btn row-scroll-btn next',
            'aria-label': t('next_page'),
            title: t('next_page')
          }, icon('next', 16));

          const updateRowNav = () => {
            const maxScroll = content.scrollWidth - content.clientWidth;
            const canScroll = maxScroll > 4;
            rowNav.hidden = !canScroll;
            if (canScroll) {
              btnPrev.disabled = content.scrollLeft <= 2;
              btnNext.disabled = content.scrollLeft >= maxScroll - 2;
            }
          };

          btnPrev.addEventListener('click', () => {
            content.scrollBy({ left: -Math.max(260, Math.round(content.clientWidth * 0.7)), behavior: 'smooth' });
          });
          btnNext.addEventListener('click', () => {
            content.scrollBy({ left: Math.max(260, Math.round(content.clientWidth * 0.7)), behavior: 'smooth' });
          });
          content.addEventListener('scroll', updateRowNav, { passive: true });
          requestAnimationFrame(updateRowNav);

          rowNav = el('div', { class: 'row-scroll-nav', hidden: true }, btnPrev, btnNext);
        }
      } else {
        content = el('div', { class: 'shelf-cat-empty' },
          el('p', { class: 'empty-text', textContent: t(cat.emptyKey) })
        );
      }

      const headRight = isAllBooks ? buildSortControls() : rowNav;

      const head = el('div', { class: 'shelf-section-head' },
        el('h3', { class: 'shelf-section-title' },
          el('span', { class: 'shelf-section-icon' }, icon(cat.icon, 17)),
          el('span', { textContent: cat.label }),
          el('span', { class: 'shelf-section-count', textContent: String(catBooks.length) })
        ),
        headRight
      );

      const sectionAttrs = {
        class: `shelf-section${isAllBooks ? ' shelf-section-all' : ' shelf-section-row'}`,
        dataset: { cat: cat.id }
      };
      if (isAllBooks) sectionAttrs.id = 'todos';

      sectionElements.push(el('div', sectionAttrs, head, content));
    }

    shelfSections.replaceChildren(...sectionElements);
  }

  renderSections();
  syncBatchSelectionUI();
  for (const u of oldUrls) URL.revokeObjectURL(u);
  renderStats(stats, positions);
  const infoBooksEl = $('lib-info-books');
  if (infoBooksEl) infoBooksEl.textContent = tn('books_count', books.length);
  await Promise.all([renderStorage(), renderWhatsNew(), renderTier2()]);
  window.__rp.libraryReady = true;
  requestAnimationFrame(updateLibScrollbar);
}

let drawerCloseTimer = 0;

export function closeLibraryDrawer(immediate = false) {
  const drawer = $('lib-drawer');
  const menuBtn = $('lib-menu-btn');
  if (!drawer || drawer.hidden) return;
  clearTimeout(drawerCloseTimer);
  const dd = $('lib-theme-dropdown');
  const toggle = $('lib-theme-toggle');
  if (dd) dd.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  drawer.classList.remove('open');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  if (immediate) {
    drawer.hidden = true;
    return;
  }
  const panel = drawer.querySelector('.lib-drawer-panel');
  const finish = () => {
    clearTimeout(drawerCloseTimer);
    if (!drawer.classList.contains('open')) drawer.hidden = true;
  };
  panel?.addEventListener('transitionend', finish, { once: true });
  drawerCloseTimer = setTimeout(finish, 260);
}

function openLibraryDrawer() {
  const drawer = $('lib-drawer');
  const menuBtn = $('lib-menu-btn');
  if (!drawer) return;
  clearTimeout(drawerCloseTimer);
  const dd = $('lib-theme-dropdown');
  const toggle = $('lib-theme-toggle');
  if (dd) dd.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  renderStorage();
  drawer.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add('open')));
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  $('lib-drawer-close')?.focus();
}

function updateLibScrollbar() {
  const sb = $('lib-scrollbar');
  const track = $('lib-scrollbar-track');
  const thumb = $('lib-scrollbar-thumb');
  const libEl = $('library');
  if (!sb || !track || !thumb || !libEl || libEl.hidden) {
    if (sb) sb.hidden = true;
    return;
  }
  const head = libEl.querySelector('.lib-head');
  if (head) {
    const h = Math.round(head.getBoundingClientRect().height);
    if (h > 0) sb.style.setProperty('--lib-head-h', `${h}px`);
  }
  const doc = document.scrollingElement || document.documentElement;
  const viewH = window.innerHeight || doc.clientHeight;
  const scrollH = doc.scrollHeight;
  const maxScroll = Math.max(0, scrollH - viewH);
  if (maxScroll <= 16) {
    sb.hidden = true;
    return;
  }
  sb.hidden = false;
  const trackH = track.clientHeight;
  if (trackH <= 0) return;
  const ratio = viewH / scrollH;
  const thumbH = Math.max(30, Math.min(Math.round(trackH * 0.65), Math.round(trackH * ratio)));
  const maxThumbTop = Math.max(1, trackH - thumbH);
  const currentScroll = window.scrollY || doc.scrollTop || 0;
  const progress = Math.max(0, Math.min(1, currentScroll / maxScroll));
  const thumbTop = progress * maxThumbTop;
  thumb.style.height = `${thumbH}px`;
  thumb.style.transform = `translate3d(0, ${thumbTop.toFixed(2)}px, 0)`;
}

function initLibScrollbar() {
  const sb = $('lib-scrollbar');
  const track = $('lib-scrollbar-track');
  const thumb = $('lib-scrollbar-thumb');
  if (!sb || !track || !thumb) return;

  let dragging = false;
  let dragMode = null; // 'touch' | 'pointer'
  let activePointerId = null;
  let activeTouchId = null;
  let grabOffset = 0;
  let dragMetrics = null;
  let pendingClientY = null;
  let rafId = 0;

  const findTouchById = (touchList, targetId) => {
    if (!touchList || targetId === null) return null;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === targetId) return touchList[i];
    }
    return null;
  };

  const applyScrollClientY = (clientY) => {
    const doc = document.scrollingElement || document.documentElement;
    const m = dragMetrics;
    const trackTop = m ? m.trackTop : track.getBoundingClientRect().top;
    const travel = m ? m.travel : Math.max(1, track.clientHeight - (thumb.offsetHeight || 30));
    const maxScroll = m ? m.maxScroll : Math.max(0, doc.scrollHeight - (window.innerHeight || doc.clientHeight));
    if (maxScroll <= 0) return;
    const thumbTop = Math.max(0, Math.min(travel, clientY - trackTop - grabOffset));
    const frac = thumbTop / travel;
    const targetTop = frac * maxScroll;
    thumb.style.transform = `translate3d(0, ${thumbTop.toFixed(2)}px, 0)`;
    doc.scrollTop = targetTop;
    try {
      window.scrollTo({ top: targetTop, behavior: 'instant' });
    } catch {
      window.scrollTo(0, targetTop);
    }
  };

  const flushScheduledMove = () => {
    rafId = 0;
    if (!dragging || pendingClientY === null) return;
    const y = pendingClientY;
    pendingClientY = null;
    applyScrollClientY(y);
  };

  const scheduleMove = (clientY) => {
    pendingClientY = clientY;
    if (!rafId) {
      rafId = requestAnimationFrame(flushScheduledMove);
    }
  };

  const beginDrag = (clientY, mode, { pointerId = null, touchId = null } = {}) => {
    const doc = document.scrollingElement || document.documentElement;
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const thumbH = thumbRect.height || thumb.offsetHeight || 30;
    const viewH = window.innerHeight || doc.clientHeight;
    const maxScroll = Math.max(0, doc.scrollHeight - viewH);
    if (maxScroll <= 0 || trackRect.height <= 0) return;

    dragging = true;
    dragMode = mode;
    activePointerId = pointerId;
    activeTouchId = touchId;
    dragMetrics = {
      trackTop: trackRect.top,
      travel: Math.max(1, trackRect.height - thumbH),
      maxScroll
    };

    sb.classList.add('dragging');
    document.body?.classList.add('lib-scroll-dragging');

    if (clientY >= thumbRect.top - 16 && clientY <= thumbRect.bottom + 16) {
      grabOffset = Math.max(0, Math.min(thumbH, clientY - thumbRect.top));
    } else {
      grabOffset = thumbH / 2;
      applyScrollClientY(clientY);
    }
  };

  const finishDrag = () => {
    if (!dragging) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (pendingClientY !== null) {
      applyScrollClientY(pendingClientY);
      pendingClientY = null;
    }
    dragging = false;
    dragMode = null;
    activeTouchId = null;
    dragMetrics = null;
    if (activePointerId !== null) {
      try { sb.releasePointerCapture?.(activePointerId); } catch {}
      activePointerId = null;
    }
    sb.classList.remove('dragging');
    document.body?.classList.remove('lib-scroll-dragging');
    requestAnimationFrame(updateLibScrollbar);
  };

  const onTouchMove = (e) => {
    if (!dragging || dragMode !== 'touch') return;
    const touch = findTouchById(e.changedTouches, activeTouchId) || findTouchById(e.touches, activeTouchId);
    if (!touch) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    scheduleMove(touch.clientY);
  };

  const onTouchEnd = (e) => {
    if (dragMode !== 'touch') return;
    if (activeTouchId !== null && !findTouchById(e.changedTouches, activeTouchId)) return;
    finishDrag();
  };

  // Native touch listeners with passive:false prevent iOS Safari / Android Chrome from stealing the vertical drag
  sb.addEventListener('touchstart', (e) => {
    const touch = e.changedTouches?.[0] || e.touches?.[0];
    if (!touch) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    beginDrag(touch.clientY, 'touch', { touchId: touch.identifier });
  }, { passive: false });

  sb.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  sb.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  sb.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

  // Pointer events for mouse / stylus / hybrid browsers
  sb.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || dragging) return;
    e.preventDefault();
    sb.setPointerCapture?.(e.pointerId);
    beginDrag(e.clientY, 'pointer', { pointerId: e.pointerId });
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging || dragMode !== 'pointer' || e.pointerId !== activePointerId) return;
    e.preventDefault();
    scheduleMove(e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    if (dragMode === 'pointer' && e.pointerId === activePointerId) finishDrag();
  });

  window.addEventListener('pointercancel', (e) => {
    if (dragMode === 'pointer' && e.pointerId === activePointerId) finishDrag();
  });

  window.addEventListener('scroll', () => {
    if (activeLongPressCancel) activeLongPressCancel();
    if (!dragging) requestAnimationFrame(updateLibScrollbar);
  }, { passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(updateLibScrollbar), { passive: true });
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!dragging) requestAnimationFrame(updateLibScrollbar);
    });
    const libMain = document.querySelector('#library .lib-main');
    if (libMain) ro.observe(libMain);
  }
}

export function initLibrary(c) {
  ctx = c;
  window.addEventListener('rp-book-saved', () => { syncDone = false; renderLibrary(); });
  window.addEventListener('rp-reload-library', () => { syncDone = false; renderLibrary(); });
  const brand = $('brand'); if (brand) brand.prepend(logo(28));
  const appVerEl = $('app-version'); if (appVerEl && window.APP_VERSION) appVerEl.textContent = window.APP_VERSION;
  const dropArtEl = $('drop-art'); if (dropArtEl) dropArtEl.append(dropArt());

  const searchIconEl = $('shelf-search-icon');
  if (searchIconEl) searchIconEl.replaceChildren(icon('search', 16));
  const searchInput = $('shelf-search');
  const searchClear = $('shelf-search-clear');
  if (searchClear) {
    searchClear.replaceChildren(icon('close', 14));
    searchClear.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      renderLibrary();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderLibrary();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        e.stopPropagation();
        searchInput.value = '';
        renderLibrary();
      }
    });
  }
  const firstRun = $('first-run');
  if (firstRun) {
    firstRun.tabIndex = 0;
    firstRun.style.cursor = 'pointer';
    firstRun.addEventListener('click', () => ctx.pickFile());
    firstRun.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.pickFile();
      }
    });
  }
  const noticeClose = $('notice-close'); if (noticeClose) { noticeClose.append(icon('close', 16)); noticeClose.addEventListener('click', hideNotice); }
  const tier2Icon = $('tier2-icon'); if (tier2Icon) tier2Icon.append(icon('file', 18));
  const tier2Close = $('tier2-close'); if (tier2Close) { tier2Close.append(icon('close', 14)); tier2Close.addEventListener('click', () => { local.set('rpTier2Dismissed', true); const tier2 = $('tier2'); if (tier2) tier2.hidden = true; }); }
  const wnIcon = $('wn-icon'); if (wnIcon) wnIcon.append(icon('sparkle', 18));
  const wnClose = $('wn-close'); if (wnClose) { wnClose.append(icon('close', 14)); wnClose.addEventListener('click', closeWhatsNew); }
  const wnOk = $('wn-ok'); if (wnOk) wnOk.addEventListener('click', closeWhatsNew);
  const tier2Copy = $('tier2-copy'); if (tier2Copy) { tier2Copy.prepend(icon('copy', 14)); tier2Copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('tier2-link').textContent);
      showToast({ text: t('link_copied') });
    } catch {
      getSelection().selectAllChildren($('tier2-link'));
      showToast({ level: 'warn', text: t('copy_failed') });
    }
  }); }
  const menuBtn = $('lib-menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => openLibraryDrawer());
  }
  const drawerClose = $('lib-drawer-close');
  if (drawerClose) {
    drawerClose.addEventListener('click', () => closeLibraryDrawer());
  }
  const drawerBackdrop = $('lib-drawer-backdrop');
  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', () => closeLibraryDrawer());
  }
  const drawerAddIcon = $('lib-drawer-add-icon');
  if (drawerAddIcon) drawerAddIcon.replaceChildren(icon('plus', 18));
  const drawerAdd = $('lib-drawer-add');
  if (drawerAdd) {
    drawerAdd.addEventListener('click', () => {
      closeLibraryDrawer(true);
      ctx.pickFile();
    });
    drawerAdd.addEventListener('dragenter', (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      drawerAdd.classList.add('drag-over');
    });
    drawerAdd.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      drawerAdd.classList.add('drag-over');
    });
    drawerAdd.addEventListener('dragleave', (e) => {
      if (!drawerAdd.contains(e.relatedTarget)) drawerAdd.classList.remove('drag-over');
    });
    drawerAdd.addEventListener('drop', async (e) => {
      e.preventDefault();
      drawerAdd.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length && ctx.addFiles) {
        closeLibraryDrawer();
        await ctx.addFiles(files);
      }
    });
  }
  initLibScrollbar();

  // Batch selection bar listeners
  const batchCancel = $('batch-cancel');
  if (batchCancel) {
    batchCancel.replaceChildren(icon('close', 16));
    batchCancel.addEventListener('click', () => exitSelectionMode());
  }
  const batchSelectAll = $('batch-select-all');
  if (batchSelectAll) {
    batchSelectAll.addEventListener('click', () => {
      if (!allTodosBooks.length) return;
      const allSelected = allTodosBooks.every((b) => selectedBookIds.has(b.id));
      if (allSelected) {
        selectedBookIds.clear();
        syncBatchSelectionUI();
      } else {
        for (const b of allTodosBooks) selectedBookIds.add(b.id);
        syncBatchSelectionUI();
      }
    });
  }
  const batchDelete = $('batch-delete');
  if (batchDelete) {
    batchDelete.addEventListener('click', openBatchConfirm);
  }
  const batchConfirmKeep = $('batch-confirm-keep');
  if (batchConfirmKeep) {
    batchConfirmKeep.addEventListener('click', () => {
      closeBatchConfirm();
      $('batch-delete')?.focus();
    });
  }
  const batchConfirmYes = $('batch-confirm-yes');
  if (batchConfirmYes) {
    batchConfirmYes.addEventListener('click', executeBatchDelete);
  }

  // Metadata modal dismiss listeners
  const metaModalClose = $('meta-modal-close');
  if (metaModalClose) {
    metaModalClose.replaceChildren(icon('close', 16));
    metaModalClose.addEventListener('click', closeMetadataModal);
  }
  const metaModalBackdrop = $('meta-modal-backdrop');
  if (metaModalBackdrop) {
    metaModalBackdrop.addEventListener('click', closeMetadataModal);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('lib-drawer') && !$('lib-drawer').hidden) {
      e.stopPropagation();
      closeLibraryDrawer();
      $('lib-menu-btn')?.focus();
      return;
    }
    if (e.key === 'Escape' && $('meta-modal') && !$('meta-modal').hidden) {
      e.stopPropagation();
      closeMetadataModal();
      return;
    }
    if (e.key === 'Escape' && selectionMode) {
      const confirm = $('batch-confirm');
      if (confirm && !confirm.hidden) {
        e.stopPropagation();
        closeBatchConfirm();
        $('batch-delete')?.focus();
        return;
      }
      e.stopPropagation();
      exitSelectionMode();
    }
  });
}
