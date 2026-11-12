// Open an .epub from the web. The "Open in Readpane" link menu (sw.js) opens the
// reader at ?url=<link>. Readpane reads that one site only once the user allows
// it (an optional host permission, asked per site with a button here, or by the
// service worker at click time); the book is then downloaded once, checked and
// handed to openFile like a dropped file. This is the only network read: book
// content still never reaches the network (CSP: only connect-src allows http:).
// The helpers above openRemote() are PURE and unit-tested in node.

import { t, uiLanguage } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { sniff } from '../core/zip.js';
import { $, el, formatSize } from './dom.js';

/** Bigger downloads stop with "too-big": the book is held in memory, like a picked file. */
export const MAX_BYTES = 500 * 1024 * 1024;
const BOOK_NAME = /\.(epub|fb2|fbz|cbz)$/i;


/** Kept as a name for the service worker and tests. */
export const say = t;

/** The permission pattern for a link's site ("https://example.com/*", any port), else null. */
export function originPattern(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.hostname}/*` : null;
  } catch { return null; }
}

/** The file's name: Content-Disposition filename (RFC 6266/5987), else the last path segment. */
export function fileNameFor(url, disposition = '') {
  const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition ?? '');
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition ?? '');
  let name = '';
  try { name = star ? decodeURIComponent(star[1].trim()) : (plain?.[1] ?? plain?.[2] ?? '').trim(); } catch { /* bad escape */ }
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''); } catch { /* bad escape */ }
  }
  return name.replace(/[\\/]/g, '_') || 'book.epub';
}

/** A ZIP is opened as an EPUB whatever the URL said (Gutenberg "11.epub3.images", "dl"); .cbz/.fb2.zip keep their name. */
export function finalName(name, kind) {
  return kind === 'zip' && !/\.(epub|fbz|cbz|zip)$/i.test(name) ? `${name}.epub` : name;
}

/**
 * What the response headers already tell: null = read the bytes (they name pdf, mobi,
 * not-zip... via openFile), else an error code. application/epub+zip, octet-stream and
 * a Content-Disposition `name` *.epub pass; a web page (sign-in wall, landing page)
 * does not, even at a URL ending in .epub.
 */
export function responseProblem({ status, type = '', name = '' }) {
  if (status < 200 || status > 299) return 'download-failed';
  if (/^\s*(text\/html|application\/xhtml\+xml)/i.test(type) && !BOOK_NAME.test(name)) return 'web-page';
  return null;
}

const problem = (code) => Object.assign(new Error(code), { code });

/** Read a Response into a Blob, failing with "too-big" past `max` bytes (declared or actual). */
export async function readCapped(res, { max = MAX_BYTES, onProgress } = {}) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > max) throw problem('too-big');
  if (!res.body) return new Blob([]);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > max) { reader.cancel().catch(() => {}); throw problem('too-big'); }
    parts.push(value);
    onProgress?.(got, total);
  }
  return new Blob(parts);
}

// ---- page ------------------------------------------------------------------------------
/** The card at the top of the library: ask, progress, or a named problem. */
function card({ code, level = 'info', title, next = '', action, onAction, progress = false }) {
  $('remote')?.remove();
  const box = el('div', { id: 'remote', class: level === 'error' ? 'notice' : 'notice info', role: level === 'error' ? 'alert' : 'status', dataset: { code } },
    el('span', { class: 'notice-icon', 'aria-hidden': 'true' }, icon(level === 'error' ? 'alert' : 'download', 20)),
    el('div', { class: 'notice-text' },
      el('p', { class: 'notice-title', textContent: title }),
      next && el('p', { class: 'notice-next', textContent: next }),
      progress && el('progress', { id: 'remote-progress', style: 'width: 100%; margin-top: 8px' }),
      action && el('p', { style: 'margin: 10px 0 0' }, el('button', { id: 'remote-allow', class: 'primary', type: 'button', textContent: action, onclick: onAction }))));
  $('notice').before(box);
  return box;
}

async function download(url, host, openFile) {
  card({ code: 'loading', title: say('remote_loading', host), progress: true });
  const fail = (code) => card({ code, level: 'error', title: say(`err_${code.replace(/-/g, '_')}`, host), next: say(`err_${code.replace(/-/g, '_')}_next`) });
  let res;
  // Follows redirects. Cookies for this site go with it (a host permission makes the
  // request same-site), as when the link is clicked: sign-in-only downloads work.
  try { res = await fetch(url); } catch { return fail('download-failed'); }
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = fileNameFor(res.url || url, disposition);
  const bad = responseProblem({ status: res.status, type: res.headers.get('content-type') ?? '', name: /filename/i.test(disposition) ? name : '' });
  if (bad) { res.body?.cancel().catch(() => {}); return fail(bad); }
  let blob;
  try {
    blob = await readCapped(res, {
      onProgress: (got, total) => {
        const bar = $('remote-progress');
        if (bar && total) Object.assign(bar, { max: total, value: got });
        if (bar) bar.title = formatSize(got, uiLanguage());
      },
    });
  } catch (e) { return fail(e.code === 'too-big' ? 'too-big' : 'download-failed'); }
  const kind = await sniff(blob);
  $('remote')?.remove();
  openFile(new File([blob], finalName(name, kind), { type: kind === 'zip' ? 'application/epub+zip' : blob.type }));
}

/** ?url=<link>: ask for the site if needed, then download and open. `denied`: the click-time ask was refused. */
export async function openRemote(url, { openFile, denied = false }) {
  const origins = [originPattern(url)].filter(Boolean);
  if (!origins.length) return card({ code: 'not-web', level: 'error', title: say('err_not_web'), next: say('err_not_web_next') });
  const host = new URL(url).host;
  if (await chrome.permissions.contains({ origins })) return download(url, host, openFile);
  const ask = (refused) => card({
    code: refused ? 'denied' : 'ask',
    level: refused ? 'error' : 'info',
    title: say(refused ? 'remote_denied' : 'remote_ask', host),
    next: say(refused ? 'remote_denied_next' : 'remote_ask_next'),
    action: say('remote_allow'),
    onAction: async () => {
      const ok = await chrome.permissions.request({ origins }).catch(() => false);
      if (ok) download(url, host, openFile); else ask(true);
    },
  });
  ask(denied);
}
