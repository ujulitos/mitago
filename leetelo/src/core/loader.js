// Turns one spine item into inert, self-contained DOM: book scripts, inline
// handlers, javascript: URLs and remote resources are removed; internal images
// and stylesheets become blob: URLs / constructable stylesheets. The extension
// page CSP (script-src 'self', img-src blob:) is the second, independent layer.
//
// build() is shared by load() (rendering) and blocks() (search), so element
// paths are identical in both: a search hit is a valid render position.

import { resolvePath, fragmentOf } from './epub.js';
import { blocksOf } from './search.js';

const RTL_LANG = /^(ar|arc|ckb|dv|fa|he|iw|ps|sd|syr|ug|ur|yi)(-|$)/i;

const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'style', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'template', 'portal', 'dialog']);
const URL_ATTRS = new Set(['src', 'href', 'poster', 'data', 'xlink:href', 'action', 'formaction', 'background', 'ping']);
const isRemote = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u.trim()) && !/^(?:blob:|#)/i.test(u.trim());
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export function createLoader(book) {
  const blobUrls = new Map(); // zip path -> Promise<blob: URL>
  const sheets = new Map(); // zip path -> Promise<CSSStyleSheet>
  const stats = { removedElements: 0, removedAttrs: 0, remoteUrls: 0 };
  // @font-face is ignored inside shadow roots, so faces go to one document-level sheet.
  const fontSheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, fontSheet];

  function blobUrl(path) {
    if (!blobUrls.has(path)) {
      blobUrls.set(path, (async () => {
        let type = book.manifestByPath?.get(path)?.type;
        if (!type) {
          const ext = path.split('.').pop()?.toLowerCase();
          const MIME = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
            gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
            avif: 'image/avif', jfif: 'image/jpeg'
          };
          type = MIME[ext] || '';
        }
        const raw = await book.zip.blob(path);
        return URL.createObjectURL(new Blob([raw], { type }));
      })());
    }
    return blobUrls.get(path);
  }

  async function inlineImports(text, basePath, depth = 0) {
    const jobs = [];
    text.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g, (m, q, u) => { jobs.push([m, u]); return m; });
    for (const [m, u] of jobs) {
      const p = resolvePath(basePath, u);
      const ok = depth < 3 && !isRemote(u) && book.zip.has(p);
      if (!ok) stats.remoteUrls += isRemote(u) ? 1 : 0;
      text = text.replace(m, ok ? await inlineImports(await book.zip.text(p), p, depth + 1) : '');
    }
    return text;
  }

  // Selectors for html/body/:root -> the section wrapper (no <html>/<body> in a shadow root).
  const faces = new Set();
  function rewriteRules(owner) {
    for (let i = owner.cssRules.length - 1; i >= 0; i--) {
      const rule = owner.cssRules[i];
      if (rule instanceof CSSFontFaceRule) {
        if (!faces.has(rule.cssText)) { faces.add(rule.cssText); fontSheet.insertRule(rule.cssText, fontSheet.cssRules.length); }
        owner.deleteRule(i);
        continue;
      }
      if (rule.selectorText) rule.selectorText = rule.selectorText.replace(/(^|[\s>+~,(])(html|body|:root)(?=$|[\s.#:[>+~,)])/gi, '$1.rp-body');
      // Book content must never cover the reader UI.
      if (rule.style && /fixed|sticky/.test(rule.style.position)) rule.style.position = 'static';
      if (rule.cssRules) rewriteRules(rule);
    }
  }

  // Book CSS: url() -> blob:, remote url() -> none, @import inlined (internal only).
  async function rewriteCss(text, basePath) {
    text = await inlineImports(text, basePath);
    const map = new Map();
    for (const [, , u] of text.matchAll(URL_RE)) {
      if (u.startsWith('data:') || map.has(u)) continue;
      if (isRemote(u)) { map.set(u, 'none'); stats.remoteUrls++; continue; }
      const p = resolvePath(basePath, u);
      map.set(u, book.zip.has(p) ? `url("${await blobUrl(p)}")` : 'none');
    }
    text = text.replace(URL_RE, (m, q, u) => map.get(u) ?? m);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    rewriteRules(sheet);
    return sheet;
  }

  function sheetFor(path) {
    if (!sheets.has(path)) sheets.set(path, book.zip.text(path).then((t) => rewriteCss(t, path)));
    return sheets.get(path);
  }

  /**
   * Parse and sanitize one section on the INERT parsed document (nothing in a
   * DOMParser document loads), then import it. Internal resources are parked in
   * data-rp-res as [[attr, zip path]] and become blob: URLs in load().
   * Shared by load() and blocks(), so paths are identical for render and search.
   */
  async function build(index) {
    const item = book.spine[index];
    const text = await book.zip.text(item.path);
    let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html');
    const css = [...doc.querySelectorAll('link[rel~="stylesheet"][href], style')]
      .map((el) => (el.localName === 'style' ? { text: el.textContent } : { href: el.getAttribute('href') }));
    const root = doc.documentElement;
    const body = doc.body ?? (root?.localName === 'html' ? null : root); // SVG spine items: keep the <svg>
    if (body) sanitizeTree(body, item.path);

    const wrap = document.createElement('div');
    wrap.className = 'rp-body';
    if (doc.body) for (const n of [...body.childNodes]) wrap.append(document.importNode(n, true));
    else if (body) wrap.append(document.importNode(body, true));
    for (const src of [root, doc.body]) {
      for (const a of src?.attributes ?? []) {
        if (a.name === 'class') wrap.className = `rp-body ${a.value}`;
        else if (a.name === 'id' || a.name === 'dir') wrap.setAttribute(a.name, a.value);
        else if (a.name === 'lang' || a.name === 'xml:lang') wrap.setAttribute('lang', a.value);
      }
    }
    // Book-level language and direction when the section itself does not say.
    if (!wrap.hasAttribute('lang') && book.language) wrap.setAttribute('lang', book.language);
    // Always set: otherwise the book would inherit the reader UI's direction (an English book
    // laid out right to left in an Arabic UI).
    if (!wrap.hasAttribute('dir')) wrap.setAttribute('dir', RTL_LANG.test(book.language ?? '') ? 'rtl' : 'ltr');
    return { item, wrap, css };
  }

  function sanitizeTree(body, base) {
    for (const el of [...body.querySelectorAll('*')]) {
      if (!body.contains(el)) continue; // inside an already dropped subtree
      if (DROP.has(el.localName)) { el.remove(); stats.removedElements++; continue; }
      if (el.style && /fixed|sticky/.test(el.style.position)) el.style.position = 'static';
      const res = [];
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const local = (attr.localName || '').toLowerCase();
        if (name.startsWith('on') || name === 'srcset') { el.removeAttribute(attr.name); stats.removedAttrs++; continue; }
        if (name === 'style' && /url\(/i.test(attr.value)) {
          el.setAttribute('style', attr.value.replace(/url\([^)]*\)/gi, 'none'));
          stats.remoteUrls++;
          continue;
        }
        const isUrlAttr = URL_ATTRS.has(name) || local === 'src' || local === 'href';
        if (!isUrlAttr) continue;
        const v = attr.value.trim();
        if (el.localName === 'a' && (name === 'href' || name === 'xlink:href' || local === 'href')) {
          if (/^(javascript|vbscript|data):/i.test(v)) { el.removeAttribute(attr.name); stats.removedAttrs++; }
          else if (v.startsWith('#')) { el.setAttribute('data-rp-href', base + v); el.setAttribute(attr.name, '#'); }
          else if (!isRemote(v)) {
            el.setAttribute('data-rp-href', resolvePath(base, v) + (fragmentOf(v) ? '#' + fragmentOf(v) : ''));
            el.setAttribute(attr.name, '#');
          } else { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
          continue;
        }
        if (/^data:image\//i.test(v)) continue;
        el.removeAttribute(attr.name);
        if (attr.namespaceURI) {
          try { el.removeAttributeNS(attr.namespaceURI, attr.localName); } catch {}
        }
        if (isRemote(v)) { stats.remoteUrls++; continue; }
        let p = resolvePath(base, v);
        if (!book.zip.has(p)) {
          const alt = v.replace(/^\/+/, '');
          if (book.zip.has(alt)) p = alt;
          else {
            const fname = v.split('/').pop()?.split('#')[0].split('?')[0];
            if (fname) {
              const match = [...book.zip.entries.keys()].find((k) => k.endsWith('/' + fname) || k === fname);
              if (match) p = match;
            }
          }
        }
        if (book.zip.has(p)) res.push([attr.name, p]);
      }
      if (res.length) el.setAttribute('data-rp-res', JSON.stringify(res));
    }
  }

  async function load(index) {
    const { item, wrap, css } = await build(index);
    const sheetJobs = [];
    for (const c of css) {
      if (c.text !== undefined) sheetJobs.push(rewriteCss(c.text, item.path));
      else if (!isRemote(c.href)) {
        const p = resolvePath(item.path, c.href);
        if (book.zip.has(p)) sheetJobs.push(sheetFor(p));
      }
    }
    const resJobs = [];
    const elementsWithRes = [...wrap.querySelectorAll('[data-rp-res]')];
    if (wrap.hasAttribute('data-rp-res')) elementsWithRes.push(wrap);
    for (const el of elementsWithRes) {
      for (const [name, p] of JSON.parse(el.getAttribute('data-rp-res'))) {
        resJobs.push(blobUrl(p).then((u) => {
          el.setAttribute(name, u);
          const isSvgImage = el.localName === 'image' || el.tagName.toLowerCase() === 'image';
          if (name === 'xlink:href' || name === 'href' || isSvgImage) {
            el.setAttribute('href', u);
            try {
              el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', u);
              el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', u);
            } catch {}
          }
          if (el.localName === 'img') el.setAttribute('src', u);
        }));
      }
      el.removeAttribute('data-rp-res');
    }
    await Promise.all(resJobs);
    return { wrap, sheets: await Promise.all(sheetJobs), lang: wrap.getAttribute('lang'), dir: wrap.getAttribute('dir') };
  }

  /** Searchable text blocks of a section, with render-identical paths. */
  async function blocks(index) {
    return blocksOf((await build(index)).wrap);
  }

  return {
    load, blocks, stats,
    revoke() {
      for (const p of blobUrls.values()) p.then((u) => URL.revokeObjectURL(u));
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== fontSheet);
    },
  };
}
