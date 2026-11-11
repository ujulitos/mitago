// CBZ (a ZIP of page images) -> the same book object openBook() returns: one
// generated XHTML page per image, in natural order (page2 before page10). The
// images stay in the real zip; the pages are added on top of it (memZip).
// ComicInfo.xml gives the title, writer, language and manga reading direction.
// Generated names (rp-page/0001.xhtml) are saved in positions: never renumber.

import { memZip } from './zip.js';
import { parseXml } from './xml.js';

const IMAGE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
const typeOf = (path) => IMAGE[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()] ?? null;
// macOS resource forks and hidden files are not pages.
const junk = (path) => /(^|\/)(__MACOSX\/|\.)/.test(path);
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** PURE: zip entry names -> page images in reading order. */
export function comicPages(names) {
  return names.filter((n) => typeOf(n) && !junk(n)).sort((a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const src = (path) => '../' + path.split('/').map(encodeURIComponent).join('/');
const PAGE_CSS = 'body { margin: 0; } .page { margin: 0; text-align: center; } .page img { display: block; margin: 0 auto; }';
// Every page weighs the same in progress and placeholder heights (spine size).
const PAGE_SIZE = 2000;

/**
 * PURE apart from reading ComicInfo.xml: `zip` (openZip) -> book object, or null
 * when it holds no images. `pageLabel(n)` names ToC entries of folderless comics.
 */
export async function cbzBook(zip, name = '', { pageLabel = (n) => `Page ${n}` } = {}) {
  const images = comicPages([...zip.entries.keys()]);
  if (!images.length) return null;

  const infoName = [...zip.entries.keys()].find((n) => /(^|\/)comicinfo\.xml$/i.test(n) && !junk(n));
  const info = infoName ? parseXml(await zip.text(infoName)).children.find((c) => c.localName === 'comicinfo') : null;
  const field = (k) => (info?.children.find((c) => c.localName === k.toLowerCase())?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const series = [field('Series'), field('Number') && `#${field('Number')}`].filter(Boolean).join(' ');
  const title = field('Title') && series ? `${series}: ${field('Title')}` : field('Title') || series || name.replace(/\.(cbz|zip)$/i, '');

  const files = new Map();
  const spine = images.map((img, i) => {
    const path = `rp-page/${String(i + 1).padStart(4, '0')}.xhtml`;
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${i + 1}</title><style>${PAGE_CSS}</style></head>`
      + `<body><div class="page"><img src="${esc(src(img))}" alt="${i + 1}"/></div></body></html>`;
    files.set(path, { size: xhtml.length, type: 'application/xhtml+xml', text: xhtml });
    return { id: path, path, type: 'application/xhtml+xml', props: [], size: PAGE_SIZE, linear: true };
  });
  const spineIndex = new Map(spine.map((s, i) => [s.path, i]));

  // ToC: the folders when pages are grouped in two or more, else every Nth page.
  const folder = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  const toc = [];
  const folders = new Set(images.map(folder)).size > 1;
  if (folders) {
    images.forEach((img, i) => {
      if (i && folder(img) === folder(images[i - 1])) return;
      const label = folder(img).split('/').filter(Boolean).pop() ?? pageLabel(i + 1);
      toc.push({ label, href: spine[i].path, depth: 0 });
    });
  } else {
    const step = 10 * Math.ceil(images.length / 200);
    for (let i = 0; i < images.length; i += step) toc.push({ label: pageLabel(i + 1), href: spine[i].path, depth: 0 });
  }
  for (const t of toc) Object.assign(t, { path: t.href, frag: '', spine: spineIndex.get(t.href) });

  const manifest = new Map();
  for (const img of images) manifest.set(img, { id: img, path: img, type: typeOf(img), props: [] });
  for (const s of spine) manifest.set(s.path, { id: s.path, path: s.path, type: s.type, props: [] });
  return {
    // tocPages: the ToC is only page markers (no chapters), so the reader names pages instead.
    zip: memZip(files, zip), opfPath: '', spine, spineIndex, toc, tocSource: 'cbz', tocPages: !folders, missing: 0,
    manifest, manifestByPath: manifest,
    version: 'cbz', identifier: '',
    title, creator: field('Writer'), language: field('LanguageISO'),
    dir: /^yes.*right.*left$/i.test(field('Manga')) ? 'rtl' : null,
    cover: images[0], fixedLayout: false, vertical: false, obfuscatedFonts: [], format: 'cbz',
  };
}
