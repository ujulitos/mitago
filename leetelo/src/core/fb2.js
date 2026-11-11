// FictionBook 2 (.fb2, or a ZIP holding one) -> the same book object openBook()
// returns, so the loader, renderer and search need no FB2 code. Each top-level
// <section> of the main <body> becomes one generated XHTML chapter; nested titled
// sections become ToC entries with fragments; every other <body> (notes) is a
// chapter of its own. <binary> images are decoded only when the page asks.
// PURE (no DOM): runs in node tests. Generated names (c0001.xhtml, img/1.jpg) are
// saved in positions and bookmarks: never renumber them.

import { BookError, memZip } from './zip.js';
import { parseXml } from './xml.js';

/** PURE: bytes -> text, honouring a BOM or the XML declaration (often windows-1251). */
export function decodeFb2(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = String.fromCharCode(...bytes.subarray(0, 256));
  const label = /^(?:\xef\xbb\xbf)?\s*<\?xml[^>]*?encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ?? 'utf-8';
  let dec;
  try { dec = new TextDecoder(label); } catch { dec = new TextDecoder('utf-8'); } // unknown label
  return dec.decode(bytes);
}

const CSS = `body { margin: 0; }
p { margin: 0; text-indent: 1.5em; }
h1, h2, h3, h4, h5, h6, .subtitle { text-align: center; text-indent: 0; margin: 1em 0 0.6em; }
.subtitle { font-weight: bold; }
.empty-line { height: 1em; }
.epigraph { margin: 1em 0 1em 30%; font-style: italic; }
.cite, .annotation { margin: 1em 5%; }
.text-author { text-align: right; font-style: italic; text-indent: 0; }
.poem { margin: 1em 0 1em 10%; }
.stanza { margin: 0.6em 0; }
.v, .date { text-indent: 0; }
.image, .cover { text-align: center; text-indent: 0; margin: 1em 0; }
.image img, .cover img { display: block; margin: 0 auto; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { border: 1px solid currentColor; padding: 0.2em 0.5em; text-indent: 0; }`;

// Characters XML 1.0 forbids would make the chapter fall back to HTML parsing.
const esc = (s) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const words = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const page = (title, body) => `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

const INLINE = { emphasis: 'em', strong: 'strong', strikethrough: 's', sub: 'sub', sup: 'sup', code: 'code', style: 'span' };
const PARA = { p: '', v: 'v', subtitle: 'subtitle', 'text-author': 'text-author', date: 'date' };
const BOX = { epigraph: 'blockquote', cite: 'blockquote', annotation: 'blockquote', poem: 'div', stanza: 'div' };
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

function base64(data) {
  try {
    const s = atob(data.replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch { return new Uint8Array(0); } // broken image data: an empty picture, never a failed chapter
}

const hrefOf = (el) => el.attr('l:href') ?? el.attr('href') ?? '';

/** PURE: FB2 text -> book object (same shape as openBook()). `name` titles an untitled book. */
export function fb2Book(text, name = '') {
  // <binary> is most of a big file: cut it out before parsing, keep the base64 for later.
  const images = new Map(); // binary id -> { path, type, data }
  let n = 0;
  text = text.replace(/<binary\b([^>]*)>([^<]*)<\/binary\s*>/gi, (m, attrs, data) => {
    const id = /(?:^|\s)id\s*=\s*["']([^"']*)["']/.exec(attrs)?.[1];
    const type = (/content-type\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '').toLowerCase();
    if (id && !images.has(id)) images.set(id, { path: `img/${++n}.${EXT[type] ?? 'bin'}`, type, data });
    return '';
  });
  const kid = (el, k) => el?.children.find((c) => c.localName === k) ?? null;
  const root = kid(parseXml(text), 'fictionbook');
  const bodies = root?.children.filter((c) => c.localName === 'body') ?? [];
  if (!bodies.length) throw new BookError('fb2-corrupt', 'This FB2 book has no readable text (no <body>).');

  const description = kid(root, 'description');
  const info = kid(description, 'title-info');
  const authors = (info?.children ?? []).filter((c) => c.localName === 'author').map((a) => {
    const part = (k) => words(a.children.find((c) => c.localName === k));
    return [part('first-name'), part('middle-name'), part('last-name')].filter(Boolean).join(' ') || part('nickname');
  }).filter(Boolean);
  const imageOf = (href) => (href.startsWith('#') ? images.get(href.slice(1)) : null);
  const coverEl = info?.first('coverpage')?.first('image');
  const cover = coverEl ? imageOf(hrefOf(coverEl)) : null;

  // Units: one per top-level section of the main body; leading title/epigraphs get their own.
  const main = bodies.find((b) => !b.attr('name')) ?? bodies[0];
  const units = [];
  let loose = null;
  for (const c of main.children) {
    if (c.localName === 'section') { units.push({ els: [c], section: c }); loose = null; }
    else if (loose) loose.els.push(c);
    else units.push(loose = { els: [c] });
  }
  for (const b of bodies) if (b !== main) units.push({ els: b.children, notes: b });
  if (!units.length) throw new BookError('fb2-corrupt', 'This FB2 book has no readable text (empty <body>).');

  // Pass 1: chapter names, and where every id lives (note links cross chapters).
  const where = new Map();
  let sid = 0;
  const walk = (el, path) => {
    if (el.localName === 'section' && !el.attr('id')) el.attrs.id = `rp-s${++sid}`;
    const id = el.attr('id');
    if (id && !where.has(id)) where.set(id, path);
    for (const k of el.children) walk(k, path);
  };
  units.forEach((u, i) => { u.path = `c${String(i + 1).padStart(4, '0')}.xhtml`; for (const el of u.els) walk(el, u.path); });

  // Pass 2: XHTML.
  const toc = [];
  let out;
  let cur;
  let inNotes = false; // note sections ("1", "2", ...) are not ToC entries
  const idAttr = (el) => (el.attr('id') ? ` id="${esc(el.attr('id'))}"` : '');
  const img = (el) => {
    const im = imageOf(hrefOf(el));
    return im ? `<img src="${im.path}" alt="${esc(el.attr('alt') ?? '')}"/>` : '';
  };
  const inline = (node) => {
    if (typeof node === 'string') { out.push(esc(node)); return; }
    const tag = INLINE[node.localName];
    if (node.localName === 'a') {
      const href = hrefOf(node);
      const at = href.startsWith('#') ? where.get(href.slice(1)) : null;
      const target = at ? (at === cur ? href : at + href) : /^https?:/i.test(href) ? href : '';
      const note = node.attr('type') === 'note';
      if (note) out.push('<sup>');
      out.push(target ? `<a href="${esc(target)}"${idAttr(node)}>` : `<span${idAttr(node)}>`);
      node.childNodes.forEach(inline);
      out.push(target ? '</a>' : '</span>');
      if (note) out.push('</sup>');
    } else if (node.localName === 'image') out.push(img(node));
    else if (tag) { out.push(`<${tag}${idAttr(node)}>`); node.childNodes.forEach(inline); out.push(`</${tag}>`); }
    else node.childNodes.forEach(inline);
  };
  const block = (node, depth) => {
    if (typeof node === 'string') { if (node.trim()) out.push(esc(node)); return; }
    const k = node.localName;
    if (k === 'section') {
      const label = words(node.children.find((c) => c.localName === 'title'));
      if (label && !inNotes) toc.push({ label, href: depth ? `${cur}#${node.attr('id')}` : cur, depth });
      out.push(`<section${idAttr(node)}>`);
      for (const c of node.childNodes) block(c, depth + 1);
      out.push('</section>');
    } else if (k === 'title') {
      // A poem's title is a subtitle, not the next heading level.
      const h = node.parentElement?.localName === 'poem' ? 'p' : `h${Math.min(6, depth + 1)}`;
      out.push(`<${h} class="${h === 'p' ? 'subtitle' : 'title'}"${idAttr(node)}>`);
      let first = true;
      for (const c of node.children) {
        if (!first) out.push('<br/>');
        first = false;
        if (c.localName !== 'empty-line') c.childNodes.forEach(inline);
      }
      out.push(`</${h}>`);
    } else if (k in PARA) {
      out.push(`<p${PARA[k] ? ` class="${PARA[k]}"` : ''}${idAttr(node)}>`);
      node.childNodes.forEach(inline);
      out.push('</p>');
    } else if (k === 'empty-line') out.push('<div class="empty-line"></div>');
    else if (k === 'image') out.push(`<div class="image"${idAttr(node)}>${img(node)}</div>`);
    else if (k in BOX) {
      out.push(`<${BOX[k]} class="${k}"${idAttr(node)}>`);
      for (const c of node.childNodes) block(c, depth);
      out.push(`</${BOX[k]}>`);
    } else if (k === 'table') {
      out.push(`<table${idAttr(node)}><tbody>`);
      for (const tr of node.children.filter((c) => c.localName === 'tr')) {
        out.push('<tr>');
        for (const td of tr.children) {
          const tag = td.localName === 'th' ? 'th' : 'td';
          out.push(`<${tag}>`); td.childNodes.forEach(inline); out.push(`</${tag}>`);
        }
        out.push('</tr>');
      }
      out.push('</tbody></table>');
    } else if (k in INLINE || k === 'a') { out.push('<p>'); inline(node); out.push('</p>'); }
    else for (const c of node.childNodes) block(c, depth);
  };

  const files = new Map();
  const spine = [];
  const add = (path, title, body) => {
    const xhtml = page(title, body);
    files.set(path, { size: xhtml.length, type: 'application/xhtml+xml', text: xhtml });
    spine.push({ id: path, path, type: 'application/xhtml+xml', props: [], size: xhtml.length, linear: true });
  };
  const bookTitle = words(info?.first('book-title')) || name.replace(/\.(fb2(\.zip)?|fbz|zip)$/i, '');
  if (cover) add('cover.xhtml', bookTitle, `<div class="cover"><img src="${cover.path}" alt=""/></div>`);
  for (const u of units) {
    out = [];
    cur = u.path;
    inNotes = !!u.notes;
    const label = words(kid(u.section ?? u.notes, 'title')) || (u.notes?.attr('name') ?? '');
    if (u.notes && label) toc.push({ label, href: cur, depth: 0 });
    for (const el of u.els) block(el, 0);
    add(u.path, label || bookTitle, out.join(''));
  }
  for (const im of images.values()) {
    files.set(im.path, { size: Math.floor(im.data.length * 0.75), type: im.type, blob: () => new Blob([base64(im.data)], { type: im.type }) });
  }

  const spineIndex = new Map(spine.map((s, i) => [s.path, i]));
  for (const t of toc) {
    const [path, frag = ''] = t.href.split('#');
    Object.assign(t, { path, frag, spine: spineIndex.get(path) ?? -1 });
  }
  const manifest = new Map([...files].map(([path, f]) => [path, { id: path, path, type: f.type, props: [] }]));
  return {
    zip: memZip(files), opfPath: '', spine, spineIndex, toc, tocSource: 'fb2', missing: 0,
    manifest, manifestByPath: manifest,
    version: 'fb2', identifier: words(kid(kid(description, 'document-info'), 'id')),
    title: bookTitle, creator: authors.join(', '), language: words(info?.first('lang')),
    description: kid(info, 'annotation')?.children?.length
      ? kid(info, 'annotation').children.map((c) => `<p>${words(c)}</p>`).join('')
      : words(kid(info, 'annotation')),
    dir: null, cover: cover?.path ?? null, fixedLayout: false, vertical: false, obfuscatedFonts: [], format: 'fb2',
  };
}

/** Open an .fb2 Blob (any encoding). Throws BookError 'fb2-corrupt'. */
export async function openFb2(blob, name = '') {
  return fb2Book(decodeFb2(new Uint8Array(await blob.arrayBuffer())), name);
}
