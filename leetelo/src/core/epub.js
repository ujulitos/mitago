// EPUB package parsing: container.xml -> OPF (metadata, manifest, spine) ->
// nav (EPUB 3) or NCX (EPUB 2). DRM and fixed-layout detection. Uses the pure
// XML parser, so it runs in node tests as well as in the reader page.

import { openZip, memZip, BookError } from './zip.js';
import { parseXml } from './xml.js';

export { BookError };

/** Resolve `href` relative to the directory of `base` (both zip paths). Drops the fragment. */
export function resolvePath(base, href) {
  let clean = href.split('#')[0].split('?')[0];
  try { clean = decodeURIComponent(clean); } catch { /* keep raw on malformed % */ }
  const parts = clean.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Fragment of an href ('' if none), decoded. */
export function fragmentOf(href) {
  const i = href.indexOf('#');
  if (i < 0) return '';
  try { return decodeURIComponent(href.slice(i + 1)); } catch { return href.slice(i + 1); }
}

// Font obfuscation (IDPF, Adobe) is not DRM; any other algorithm is.
const FONT_OBFUSCATION = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/;
const DRM_SCHEMES = [
  ['META-INF/rights.xml', 'Adobe ADEPT'],
  ['META-INF/license.lcpl', 'Readium LCP'],
  ['META-INF/sinf.xml', 'Apple FairPlay'],
];

/**
 * PURE. `encryptionXml`: text or null; `present(path)`: does the zip have it.
 * Returns { drm: null | scheme, obfuscated: [zip paths of obfuscated fonts] }.
 */
export function detectDrm(encryptionXml, present) {
  const scheme = DRM_SCHEMES.find(([p]) => present(p))?.[1] ?? null;
  if (!encryptionXml) return { drm: null, obfuscated: [] };
  const enc = parseXml(encryptionXml);
  const obfuscated = [];
  let other = false;
  for (const data of enc.all('EncryptedData')) {
    const alg = data.first('EncryptionMethod')?.attr('Algorithm') ?? '';
    const uri = data.first('CipherReference')?.attr('URI') ?? '';
    if (FONT_OBFUSCATION.test(alg)) obfuscated.push(resolvePath('', uri));
    else other = true;
  }
  return { drm: other ? scheme ?? 'unknown' : null, obfuscated };
}

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** PURE: OPF text -> package model (paths resolved against opfPath). */
export function parseOpf(opfText, opfPath) {
  const doc = parseXml(opfText);
  const pkg = doc.first('package');
  if (!pkg) throw new BookError('corrupt', 'The package document is not valid.');
  const metadata = pkg.first('metadata');
  const metas = metadata ? metadata.all('meta') : [];
  const metaProp = (prop) => text(metas.find((m) => m.attr('property') === prop));
  const metaName = (name) => metas.find((m) => m.attr('name') === name)?.attr('content') ?? '';
  const uidId = pkg.attr('unique-identifier');
  const ids = metadata ? metadata.all('identifier') : [];

  const manifest = new Map();
  for (const it of pkg.first('manifest')?.all('item') ?? []) {
    const href = it.attr('href');
    if (!it.attr('id') || !href) continue;
    manifest.set(it.attr('id'), {
      id: it.attr('id'),
      path: resolvePath(opfPath, href),
      type: (it.attr('media-type') ?? '').toLowerCase(),
      props: (it.attr('properties') ?? '').split(/\s+/).filter(Boolean),
    });
  }
  const spineEl = pkg.first('spine');
  const itemrefs = (spineEl?.all('itemref') ?? []).map((r) => ({
    idref: r.attr('idref'),
    linear: r.attr('linear') !== 'no',
    props: (r.attr('properties') ?? '').split(/\s+/).filter(Boolean),
  }));
  const coverId = metaName('cover');
  const cover = [...manifest.values()].find((m) => m.props.includes('cover-image')) ?? manifest.get(coverId) ?? null;
  const layout = metaProp('rendition:layout');
  const descEl = metadata?.first('description');
  const descriptionHtml = descEl ? (descEl.children.length > 0 ? descEl.innerHTML : descEl.textContent).trim() : '';
  return {
    version: pkg.attr('version') ?? '',
    identifier: text(ids.find((i) => i.attr('id') === uidId) ?? ids[0]),
    title: text(metadata?.first('title')),
    creator: (metadata?.all('creator') ?? []).map(text).filter(Boolean).join(', '),
    language: text(metadata?.first('language')),
    description: descriptionHtml,
    dir: spineEl?.attr('page-progression-direction') ?? null,
    manifest,
    itemrefs,
    tocId: spineEl?.attr('toc') ?? null,
    cover: cover?.path ?? null,
    writingMode: metaName('primary-writing-mode'),
    fixedLayout: layout === 'pre-paginated' || (itemrefs.length > 0 && itemrefs.every((r) => r.props.includes('rendition:layout-pre-paginated'))),
  };
}

const VERTICAL_RE = /writing-mode\s*:\s*vertical/i;

/** PURE: EPUB 3 navigation document -> flat ToC [{label, href, depth}] (href resolved). */
export function parseNav(navText, navPath) {
  const doc = parseXml(navText, { html: true });
  const navs = doc.all('nav');
  const nav = navs.find((n) => (n.attr('epub:type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const out = [];
  const walk = (ol, depth) => {
    for (const li of ol.children.filter((c) => c.localName === 'li')) {
      const head = li.children.find((c) => c.localName === 'a' || c.localName === 'span');
      const href = head?.localName === 'a' ? head.attr('href') ?? '' : '';
      const label = text(head);
      if (label) out.push({ label, href: href ? resolveHref(navPath, href) : '', depth });
      const sub = li.children.find((c) => c.localName === 'ol' || c.localName === 'ul');
      if (sub) walk(sub, depth + 1);
    }
  };
  const top = nav?.children.find((c) => c.localName === 'ol' || c.localName === 'ul');
  if (top) walk(top, 0);
  return out;
}

/** PURE: EPUB 2 NCX -> flat ToC [{label, href, depth}]. */
export function parseNcx(ncxText, ncxPath) {
  const doc = parseXml(ncxText);
  const out = [];
  const walk = (parent, depth) => {
    for (const np of parent.children.filter((c) => c.localName === 'navpoint')) {
      const src = np.children.find((c) => c.localName === 'content')?.attr('src') ?? '';
      const label = text(np.children.find((c) => c.localName === 'navlabel'));
      if (label) out.push({ label, href: src ? resolveHref(ncxPath, src) : '', depth });
      walk(np, depth + 1);
    }
  };
  const map = doc.first('navMap');
  if (map) walk(map, 0);
  return out;
}

function resolveHref(base, href) {
  const frag = href.includes('#') ? '#' + href.split('#')[1] : '';
  return resolvePath(base, href) + frag;
}

/**
 * Open an EPUB Blob/File. Throws BookError with a stable `code`:
 * pdf, acsm, mobi, not-zip, corrupt, not-epub, drm (detail = scheme), encrypted.
 * `opened`: the blob's zip when the caller already read its directory (formats.js).
 */
export async function openBook(blob, opened = null) {
  const zip = opened ?? await openZip(blob);
  if (!zip.has('META-INF/container.xml')) throw new BookError('not-epub', 'This ZIP is not an EPUB (no META-INF/container.xml).');
  const encryption = zip.has('META-INF/encryption.xml') ? await zip.text('META-INF/encryption.xml') : null;
  const { drm, obfuscated } = detectDrm(encryption, zip.has);
  if (drm) throw new BookError('drm', `This book is DRM-protected (${drm}) and cannot be opened.`, drm);

  const container = parseXml(await zip.text('META-INF/container.xml'));
  const opfPath = container.first('rootfile')?.attr('full-path');
  if (!opfPath || !zip.has(opfPath)) throw new BookError('not-epub', 'The EPUB has no package document.');
  const opf = parseOpf(await zip.text(opfPath), opfPath);

  let fixedLayout = opf.fixedLayout;
  const apple = 'META-INF/com.apple.ibooks.display-options.xml';
  if (!fixedLayout && zip.has(apple)) {
    fixedLayout = parseXml(await zip.text(apple)).all('option').some((o) => o.attr('name') === 'fixed-layout' && text(o) === 'true');
  }

  // Vertical writing (vertical-rl/lr): declared in the OPF (EPUB 2/Kindle) or in the book's CSS.
  let vertical = /^vertical/i.test(opf.writingMode ?? '');
  for (const it of opf.manifest.values()) {
    if (vertical) break;
    const e = it.type === 'text/css' && zip.entry(it.path);
    if (e && e.size < 512 * 1024) vertical = VERTICAL_RE.test(await zip.text(e.name));
  }

  let missing = 0;
  const spine = [];
  for (const ref of opf.itemrefs) {
    const it = opf.manifest.get(ref.idref);
    if (!it) continue;
    const entry = zip.entry(it.path);
    if (!entry) { missing++; continue; }
    spine.push({ ...it, path: entry.name, size: entry.size, linear: ref.linear });
  }
  if (!spine.length) throw new BookError('not-epub', 'The EPUB has no readable chapters.');

  // If the book declares a cover image, ensure there is an internal cover in the spine.
  let bookZip = zip;
  const items = [...opf.manifest.values()];
  if (opf.cover && zip.has(opf.cover)) {
    const coverName = opf.cover.split('/').pop()?.toLowerCase();
    let hasCover = spine.some((s, idx) => {
      if (idx > 1) return false;
      const id = (s.id || '').toLowerCase();
      const path = (s.path || '').toLowerCase();
      return (
        s.path === opf.cover ||
        s.props?.includes('cover') ||
        id.includes('cover') ||
        id.includes('titlepage') ||
        path.includes('cover') ||
        path.includes('titlepage')
      );
    });
    if (!hasCover && spine.length > 0) {
      try {
        const firstText = await zip.text(spine[0].path);
        if (coverName && firstText.toLowerCase().includes(coverName)) {
          hasCover = true;
        }
      } catch {}
    }
    if (!hasCover) {
      const coverPath = '__rp_cover__.xhtml';
      const coverHtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Cover</title>
  <style type="text/css">
    html, body { margin: 0; padding: 0; text-align: center; }
    .rp-cover-wrap { display: flex; align-items: center; justify-content: center; margin: 0; padding: 0; }
    .rp-cover-img { display: block; max-width: 100%; max-height: 95vh; margin: auto; object-fit: contain; }
  </style>
</head>
<body>
  <div class="rp-cover-wrap">
    <img class="rp-cover-img" src="${opf.cover}" alt="Cover" />
  </div>
</body>
</html>`;
      const coverItem = {
        id: '__rp_cover__',
        path: coverPath,
        type: 'application/xhtml+xml',
        props: ['cover'],
        size: coverHtml.length,
        linear: true,
      };
      spine.unshift(coverItem);
      opf.manifest.set('__rp_cover__', coverItem);
      items.unshift(coverItem);
      bookZip = memZip(new Map([[coverPath, { size: coverHtml.length, type: 'application/xhtml+xml', text: coverHtml }]]), zip);
    }
  }

  const spineIndex = new Map(spine.map((s, i) => [s.path, i]));

  // Table of contents: EPUB 3 nav first, NCX fallback.
  const navItem = items.find((m) => m.props.includes('nav'));
  const ncxItem = opf.manifest.get(opf.tocId) ?? items.find((m) => m.type === 'application/x-dtbncx+xml');
  let toc = [];
  let tocSource = 'none';
  if (navItem && bookZip.has(navItem.path)) {
    toc = parseNav(await bookZip.text(navItem.path), navItem.path);
    if (toc.length) tocSource = 'nav';
  }
  if (!toc.length && ncxItem && bookZip.has(ncxItem.path)) {
    toc = parseNcx(await bookZip.text(ncxItem.path), ncxItem.path);
    if (toc.length) tocSource = 'ncx';
  }
  const real = (p) => bookZip.entry(p)?.name ?? p;
  for (const t of toc) {
    t.path = real(t.href.split('#')[0]);
    t.frag = fragmentOf(t.href);
    t.spine = spineIndex.get(t.path) ?? -1;
  }

  return {
    zip: bookZip, opfPath, spine, spineIndex, toc, tocSource, missing,
    manifest: opf.manifest,
    manifestByPath: new Map(items.map((m) => [m.path, m])),
    version: opf.version, identifier: opf.identifier,
    title: opf.title, creator: opf.creator, language: opf.language,
    description: opf.description,
    dir: opf.dir, cover: opf.cover, fixedLayout, vertical, obfuscatedFonts: obfuscated,
  };
}
