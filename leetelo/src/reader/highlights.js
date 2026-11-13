// Highlights and notes in the reading view. Select text -> a small toolbar (four colours,
// a note; H highlights). Click a highlight -> recolour, edit its note, delete. The
// Highlights pane lists them in book order and exports Markdown / JSON (Blob + <a download>:
// no permission, no network).
//
// Painted with the CSS Custom Highlight API (::highlight(rp-hl-*) in render.js SECTION_CSS),
// so the chapter DOM, and every position path into it, never changes. start/end are
// position.js anchors: a highlight survives reflow, font, mode switch and reopening. A
// selection over two chapters is cut at the end of the first.

import { icon } from '../lib/icons.js';
import { t } from '../lib/i18n.js';
import { showToast } from '../lib/toast.js';
import { boundaryAt, pointOf } from '../core/anchor.js';
import { COLORS, exportName, snippet, sortHighlights, toJson, toMarkdown } from '../core/notes.js';
import { parse, progress as progressOf, serialize } from '../core/position.js';
import { $, el, labelled } from './dom.js';
import { percent, tocIndexAt } from './logic.js';

const NAMES = [...COLORS.map((c) => `rp-hl-${c}`), 'rp-hl-note'];

let rp;
let store;
let list = []; // this book's highlights in book order, plus s/e (parsed) and range (live, or null)
let lastColor = COLORS[0];
let editing = null; // the highlight the toolbar edits; null = a new selection
let pending = null; // the selection the toolbar was opened for (clicking it may clear the live one)
let anchorRects = null;

function chapterOf(spine) {
  const i = tocIndexAt(rp.book.toc, { spine });
  return rp.book.toc[i]?.label ?? t('section_n', spine + 1);
}

// ------------------------------------------------------------------------------ selection
/**
 * The selection's real range, across shadow roots. A mouse selection inside a chapter's shadow
 * root is retargeted by getRangeAt() (collapsed, on the host's parent: measured, Chrome 150);
 * getComposedRanges() (Chrome 137+) sees through, older Chrome has ShadowRoot.getSelection().
 */
function composedRange(sections) {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const shadows = sections.map(([, root]) => root.getRootNode());
  let r = null;
  try { r = sel.getComposedRanges({ shadowRoots: shadows })[0]; } catch {
    for (const sr of shadows) { const s = sr.getSelection?.(); if (s?.rangeCount && !s.isCollapsed) { r = s.getRangeAt(0); break; } }
  }
  r ??= sel.getRangeAt(0);
  return r.collapsed ? null : r;
}

/** The selection as a Range inside one laid-out chapter, or null. */
function selectedRange() {
  if (!rp?.view) return null;
  const sections = rp.view.sections();
  const r = composedRange(sections);
  if (!r) return null;
  const inside = (node) => sections.find(([, root]) => root.contains(node));
  const a = inside(r.startContainer);
  const b = inside(r.endContainer);
  const [spine, root] = a ?? b ?? [];
  if (!root) return null;
  const range = document.createRange();
  if (a) range.setStart(r.startContainer, r.startOffset); else range.setStart(root, 0);
  if (b?.[1] === root) range.setEnd(r.endContainer, r.endOffset); else range.setEnd(root, root.childNodes.length);
  return range.toString().trim() ? { spine, root, range } : null;
}

/** Share of the chapter's characters before a boundary (the position's frac: exact book order). */
function fracAt(root, node, offset) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length / Math.max(1, root.textContent.length);
}

/** Highlight the selection (or the one the toolbar is open for). Returns the new id, or null. */
export async function highlightSelection(color = lastColor) {
  const s = selectedRange() ?? pending;
  if (!s || !rp?.view) return null;
  const { spine, root, range } = s;
  const point = (node, offset) => ({ spine, ...pointOf(root, node, offset), frac: fracAt(root, node, offset) });
  const start = point(range.startContainer, range.startOffset);
  const end = point(range.endContainer, range.endOffset);
  lastColor = color;
  const id = await store.putHighlight({
    bookId: rp.bookId, start: serialize(start), end: serialize(end), text: range.toString().replace(/\s+/g, ' ').trim(),
    note: '', color, progress: progressOf(start, rp.book.spine.map((x) => x.size)),
  });
  getSelection().removeAllRanges();
  pending = null;
  await refresh();
  return id;
}

// ------------------------------------------------------------------------------- painting
function rangeOf(root, h) {
  const r = document.createRange();
  r.setStart(...boundaryAt(root, h.s));
  r.setEnd(...boundaryAt(root, h.e));
  return r.collapsed ? null : r;
}

/** (Re)build every highlight in the chapters laid out now. Cheap: called on each section load. */
export function paint() {
  if (!globalThis.CSS?.highlights) return;
  const sets = new Map(NAMES.map((n) => [n, new Highlight()]));
  const roots = new Map(rp?.view?.sections() ?? []);
  for (const h of list) {
    const root = roots.get(h.s.spine);
    h.range = root ? rangeOf(root, h) : null;
    if (!h.range) continue;
    (sets.get(`rp-hl-${h.color}`) ?? sets.get(NAMES[0])).add(h.range);
    if (h.note) sets.get('rp-hl-note').add(h.range);
  }
  for (const [n, hl] of sets) CSS.highlights.set(n, hl);
}

/** The book closed: nothing painted, nothing listed. */
export function clearHighlights() {
  list = [];
  closeHighlightBar(false);
  if (globalThis.CSS?.highlights) for (const n of NAMES) CSS.highlights.delete(n);
}

/** Reload this book's highlights from the store, repaint, re-list. */
export async function refresh() {
  const bookId = rp.bookId;
  const all = await store.listHighlights(bookId);
  if (bookId !== rp.bookId) return list;
  list = sortHighlights(all).map((h) => ({ ...h, s: parse(h.start), e: parse(h.end) })).filter((h) => h.s && h.e);
  if (editing) editing = list.find((h) => h.id === editing.id) ?? null;
  paint();
  renderList();
  return list;
}

async function save(h, patch) {
  const { s, e, range, ...rec } = h;
  await store.putHighlight({ ...rec, ...patch });
  await refresh();
}

// -------------------------------------------------------------------------------- toolbar
const visibleRects = (range) => [...range.getClientRects()].filter((r) => r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);

/** Above the first line of the text, else below its last line; inside the window. */
function place() {
  const bar = $('hl-bar');
  if (!anchorRects?.length) return;
  const first = anchorRects[0];
  const last = anchorRects[anchorRects.length - 1];
  const w = bar.offsetWidth;
  const h = bar.offsetHeight;
  const top = first.top - h - 10 >= 8 ? first.top - h - 10 : Math.min(innerHeight - h - 8, last.bottom + 10);
  const left = Math.min(Math.max(8, first.left + first.width / 2 - w / 2), innerWidth - w - 8);
  bar.style.top = `${Math.round(top)}px`;
  bar.style.left = `${Math.round(left)}px`;
}

function showBar(rects, h) {
  editing = h;
  anchorRects = rects;
  const bar = $('hl-bar');
  for (const b of bar.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(!!h && b.dataset.color === h.color));
  $('hl-delete').hidden = !h;
  $('hl-note-form').hidden = true;
  $('hl-note-btn').setAttribute('aria-expanded', 'false');
  bar.hidden = false;
  place();
}

/** Close the toolbar; true if it was open (Esc). Focus goes back to the text if it was in it. */
export function closeHighlightBar(restore = true) {
  const bar = $('hl-bar');
  if (!bar || bar.hidden) return false;
  const had = bar.contains(document.activeElement);
  bar.hidden = true;
  editing = null;
  pending = null;
  if (restore && had) $('view').focus({ preventScroll: true });
  return true;
}

/** The text moved under the toolbar (scroll, page turn): it no longer points at anything. */
export function onTextMoved() {
  if (!$('hl-bar').hidden && !$('hl-bar').contains(document.activeElement)) closeHighlightBar(false);
}

function onSelectionEnd() {
  const s = selectedRange();
  if (!s) return;
  pending = s;
  showBar(visibleRects(s.range), null);
}

function hitAt(x, y) {
  for (const h of [...list].reverse()) {
    if (!h.range?.startContainer.isConnected) continue;
    const rects = visibleRects(h.range);
    if (rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return { h, rects };
  }
  return null;
}

async function pickColor(color) {
  if (!editing) {
    await highlightSelection(color);
    closeHighlightBar();
    return;
  }
  lastColor = color;
  await save(editing, { color });
  for (const b of $('hl-bar').querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
}

async function openNote() {
  if (!editing) {
    const id = await highlightSelection();
    const h = list.find((x) => x.id === id);
    if (!h) return;
    showBar(anchorRects, h);
  }
  $('hl-note').value = editing.note ?? '';
  $('hl-note-form').hidden = false;
  $('hl-note-btn').setAttribute('aria-expanded', 'true');
  place();
  $('hl-note').focus();
}

async function saveNote() {
  if (!editing) return;
  await save(editing, { note: $('hl-note').value.trim() });
  closeHighlightBar();
}

async function remove(h) {
  await store.deleteHighlight(h.id);
  await refresh();
}

function formatNote(raw) {
  const note = raw?.trim();
  if (!note) return '';
  return /^nota:\s*/i.test(note) ? note : `Nota: ${note}`;
}

function formatHighlightCopy(h) {
  const title = (rp.book?.title || t('untitled')).trim();
  const creator = (rp.book?.creator || '').trim();
  const header = creator ? `${title} - ${creator}` : title;
  return [header, h.text?.trim(), formatNote(h.note)].filter(Boolean).join('\n\n');
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback below */ }
  const ta = el('textarea', { value: text });
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// ------------------------------------------------------------------------------------ pane
function renderList() {
  $('hl-empty').hidden = list.length > 0;
  $('hl-export-md').disabled = $('hl-export-json').disabled = !list.length;
  $('hl-list').replaceChildren(...list.map((h) => {
    const noteText = formatNote(h.note);
    const jump = el('button', { type: 'button', class: 'jump', dataset: { color: h.color } },
      el('small', { textContent: `${chapterOf(h.s.spine)} · ${t('percent', percent(h.progress ?? 0))}` }),
      el('span', { class: 'quote', textContent: snippet(h.text, 180) }),
      noteText ? el('span', { class: 'note', textContent: snippet(noteText, 240) }) : null);
    jump.addEventListener('click', () => rp.view.goTo(h.s));
    const copyBtn = labelled(el('button', { type: 'button', class: 'icon-btn hl-copy' }, icon('copy', 15)), t('hl_copy'));
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(formatHighlightCopy(h));
      if (!ok) { showToast({ level: 'warn', text: t('copy_failed') }); return; }
      copyBtn.replaceChildren(icon('check', 15));
      copyBtn.classList.add('copied');
      showToast({ level: 'ok', text: t('hl_copied') });
      setTimeout(() => {
        copyBtn.replaceChildren(icon('copy', 15));
        copyBtn.classList.remove('copied');
      }, 1500);
    });
    // Keyboard twin of clicking the highlight in the text: go there, open its note.
    const edit = labelled(el('button', { type: 'button', class: 'icon-btn hl-edit' }, icon('note', 15)), t('hl_edit_note'));
    edit.addEventListener('click', async () => {
      await rp.view.goTo(h.s);
      const live = list.find((x) => x.id === h.id);
      if (!live?.range) return;
      showBar(visibleRects(live.range), live);
      openNote();
    });
    const del = labelled(el('button', { type: 'button', class: 'icon-btn hl-del' }, icon('trash', 15)), t('hl_delete'));
    del.addEventListener('click', async () => {
      const li = del.closest('li');
      const i = Math.max(0, [...$('hl-list').children].indexOf(li) - (li.nextElementSibling ? 0 : 1));
      await remove(h);
      ($('hl-list').children[i]?.querySelector('.jump') ?? $('hl-export-md')).focus();
    });
    return el('li', {}, jump, copyBtn, edit, del);
  }));
}

/** Markdown or JSON of this book's highlights; also downloads it unless { download: false }. */
export async function exportHighlights(kind, { download = true } = {}) {
  await refresh();
  const book = { id: rp.bookId, title: rp.book.title || t('untitled'), creator: rp.book.creator, language: rp.book.language };
  const md = kind === 'md';
  const text = md ? toMarkdown(book, list, { chapterOf }) : toJson(book, list, { chapterOf });
  if (download) {
    const url = URL.createObjectURL(new Blob([text], { type: md ? 'text/markdown' : 'application/json' }));
    const a = el('a', { href: url, download: exportName(book.title, md ? 'md' : 'json') });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return text;
}

/** Highlights of the book just opened (after setupBook). */
export const setupHighlights = refresh;
export const highlights = () => list.map(({ s, e, range, ...h }) => h);

export function initHighlights(state, deps) {
  rp = state;
  store = deps.store;
  const bar = $('hl-bar');
  $('hl-colors').replaceChildren(...COLORS.map((c) => {
    const b = labelled(el('button', { type: 'button', class: 'hl-swatch', dataset: { color: c }, 'aria-pressed': 'false' }), t(`hl_color_${c}`));
    b.addEventListener('click', () => pickColor(c));
    return b;
  }));
  $('hl-note-btn').replaceChildren(icon('note', 16), el('span', { textContent: t('hl_note') }));
  $('hl-delete').replaceChildren(icon('trash', 16));
  labelled($('hl-delete'), t('hl_delete'));
  $('hl-export-md').replaceChildren(icon('download', 15), el('span', { textContent: t('hl_export_md') }));
  $('hl-export-json').replaceChildren(icon('download', 15), el('span', { textContent: t('hl_export_json') }));

  $('hl-note-btn').addEventListener('click', () => ($('hl-note-form').hidden ? openNote() : closeHighlightBar()));
  $('hl-delete').addEventListener('click', async () => { if (editing) await remove(editing); closeHighlightBar(); $('view').focus({ preventScroll: true }); });
  $('hl-note-form').addEventListener('submit', (e) => { e.preventDefault(); saveNote(); });
  $('hl-note-cancel').addEventListener('click', () => closeHighlightBar());
  $('hl-note').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); } });
  $('hl-export-md').addEventListener('click', () => exportHighlights('md'));
  $('hl-export-json').addEventListener('click', () => exportHighlights('json'));

  // Clicking the toolbar must not clear the selection it acts on (the note field may take focus).
  bar.addEventListener('pointerdown', (e) => { if (!e.target.closest('textarea')) e.preventDefault(); });
  document.addEventListener('pointerdown', (e) => { if (!bar.contains(e.target)) closeHighlightBar(false); });
  const view = $('view');
  view.addEventListener('pointerup', (e) => { if (e.button === 0) setTimeout(onSelectionEnd); });
  view.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') onSelectionEnd(); });
  view.addEventListener('scroll', onTextMoved, { passive: true });
  view.addEventListener('click', (e) => {
    if (!rp.view || composedRange(rp.view.sections()) || e.composedPath().some((n) => n.dataset?.rpHref)) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) showBar(hit.rects, hit.h);
  });
  addEventListener('resize', () => { if (!bar.hidden) closeHighlightBar(false); });
}
