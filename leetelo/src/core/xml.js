// Tiny tolerant XML parser for package documents (container.xml, OPF, nav,
// NCX). PURE: no DOM, so the EPUB parser runs unchanged in node tests.
// Elements expose the subset of the DOM the parsers use: localName (prefix
// stripped, lower-cased), children, parentElement, textContent, attr().
// Not a validating parser: mismatched close tags pop to the nearest match.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] !== '#') return ENT[e] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}

class XmlElement {
  constructor(name, attrs, parent) {
    this.name = name;
    this.localName = name.slice(name.indexOf(':') + 1).toLowerCase();
    this.attrs = attrs;
    this.parentElement = parent;
    this.childNodes = []; // XmlElement | string
    this.children = [];
  }
  /** Attribute by exact name, or by local name across any prefix (`epub:type` via 'type' is NOT matched; pass 'epub:type'). */
  attr(name) {
    if (name in this.attrs) return this.attrs[name];
    if (name.includes(':')) {
      const local = name.slice(name.indexOf(':') + 1);
      for (const k in this.attrs) if (k.includes(':') && k.slice(k.indexOf(':') + 1) === local) return this.attrs[k];
    }
    return null;
  }
  get textContent() {
    let s = '';
    for (const n of this.childNodes) s += typeof n === 'string' ? n : n.textContent;
    return s;
  }
  get innerHTML() {
    let s = '';
    for (const n of this.childNodes) {
      if (typeof n === 'string') {
        s += n;
      } else {
        const attrs = Object.entries(n.attrs || {}).map(([k, v]) => ` ${k}="${v}"`).join('');
        s += `<${n.name}${attrs}>${n.innerHTML}</${n.name}>`;
      }
    }
    return s;
  }
  /** All descendants with this local name (case-insensitive), document order. */
  all(local) {
    local = local.toLowerCase();
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (c.localName === local) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  first(local) { return this.all(local)[0] ?? null; }
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi;
const ATTR = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source']);

/**
 * Parse text into a synthetic document element whose children are the root(s).
 * `html: true` treats HTML void elements (<br>, <img>…) as self-closing; never
 * for package documents, where <meta> and <link> carry content.
 */
export function parseXml(text, { html = false } = {}) {
  const doc = new XmlElement('#document', {}, null);
  const stack = [doc];
  let cur = doc;
  let last = 0;
  const pushText = (t) => { if (t) cur.childNodes.push(t); };
  for (const m of text.matchAll(TOKEN)) {
    pushText(decodeEntities(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[1] !== undefined) pushText(m[1]);
    else if (m[2]) {
      const name = m[2].toLowerCase();
      const at = stack.findLastIndex((el) => el.name.toLowerCase() === name);
      if (at > 0) { stack.length = at; cur = stack[at - 1]; }
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      const el = new XmlElement(m[3], attrs, cur === doc ? null : cur);
      cur.childNodes.push(el);
      cur.children.push(el);
      if (!m[5] && !(html && VOID.has(el.localName))) stack.push(cur = el);
    }
  }
  pushText(decodeEntities(text.slice(last)));
  return doc;
}
