// One floating message at a time, for the popup and the settings page.
// Short line + colour (green done, orange note, red problem), a bar showing
// how long it stays, paused while hovered or focused. Longer explanations sit
// behind "Details" so nothing is hidden, only folded.

import { icon } from './icons.js';
import { t } from './i18n.js';

const DURATION = { ok: 2600, warn: 5000, error: 6500 };

let box;
let timer = null;
let remaining = 0;
let started = 0;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function container() {
  if (!box) {
    box = el('div', { id: 'toast', className: 'toast', hidden: true });
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.addEventListener('mouseenter', pause);
    box.addEventListener('mouseleave', resume);
    box.addEventListener('focusin', pause);
    box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) resume(); });
    document.body.append(box);
  }
  return box;
}

function pause() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  remaining -= performance.now() - started;
  box.classList.add('paused');
}

function resume() {
  if (timer !== null || box.hidden || box.classList.contains('expanded')) return;
  box.classList.remove('paused');
  started = performance.now();
  timer = setTimeout(hideToast, Math.max(400, remaining));
}

export function hideToast() {
  clearTimeout(timer);
  timer = null;
  if (box) box.hidden = true;
}

/**
 * level: 'ok' | 'warn' | 'error'; text: one short line;
 * details: longer explanations (strings), shown on demand.
 */
export function showToast({ level = 'ok', text, details = [] }) {
  const node = container();
  clearTimeout(timer);
  timer = null;
  remaining = DURATION[level] ?? DURATION.ok;
  node.className = `toast ${level}`;
  node.style.setProperty('--duration', `${remaining}ms`);

  const close = el('button', { type: 'button', className: 'toast-btn', title: t('dismiss') }, icon('close', 14));
  close.setAttribute('aria-label', t('dismiss'));
  close.addEventListener('click', hideToast);
  const line = el('div', { className: 'toast-line' },
    icon(level === 'ok' ? 'check' : 'alert', 16), el('span', { className: 'toast-text', textContent: text }));
  const extra = details.filter((d) => d && d !== text);
  if (extra.length) {
    const more = el('button', { type: 'button', className: 'toast-more', textContent: t('details') });
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = !node.classList.contains('expanded');
      node.classList.toggle('expanded', open);
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? t('less') : t('details');
      if (open) pause();
      else resume();
    });
    line.append(more);
  }
  line.append(close);
  const parts = [line];
  if (extra.length) parts.push(el('ul', { className: 'toast-details' }, ...extra.map((d) => el('li', { textContent: d }))));
  parts.push(el('span', { className: 'toast-bar' }));
  node.replaceChildren(...parts); // never pass null: replaceChildren would print it
  node.hidden = false;
  // Restart the bar animation for back-to-back messages.
  const bar = node.querySelector('.toast-bar');
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
  started = performance.now();
  timer = setTimeout(hideToast, remaining);
}
