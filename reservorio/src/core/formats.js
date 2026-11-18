// One entry point for every format the reader opens. The bytes decide (a .cbr that
// is really a ZIP opens; an .epub that is really a PDF says so); the file name only
// picks the error message for a damaged file. All formats return the openBook() shape.

import { openZip, sniff, BookError } from './zip.js';
import { openBook } from './epub.js';
import { openFb2 } from './fb2.js';
import { cbzBook } from './cbz.js';

/** 'epub', 'fb2', 'fbz' (.fb2.zip too), 'cbz' ... from a file name, lower-case ('' if none). */
export function extOf(name = '') {
  if (/\.fb2\.zip$/i.test(name)) return 'fbz';
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

const junk = (path) => /(^|\/)(__MACOSX\/|\.)/.test(path);

/**
 * Open a Blob/File as EPUB, FB2 (plain or zipped) or CBZ. Throws BookError with the
 * openBook() codes plus: cbr, cb7 (RAR/7-Zip comics), fb2-corrupt, cbz-corrupt, cbz-empty.
 * `opts.pageLabel(n)`: ToC label of comic page n.
 */
export async function openAny(blob, name = '', opts = {}) {
  const ext = extOf(name);
  const kind = await sniff(blob);
  if (kind === 'rar') throw new BookError('cbr', 'RAR comics (.cbr) are not supported; convert to .cbz.');
  if (kind === '7z') throw new BookError('cb7', '7-Zip comics (.cb7) are not supported; convert to .cbz.');
  if (kind === 'fb2' || (kind === 'unknown' && ext === 'fb2')) return openFb2(blob, name);
  if (kind !== 'zip') return openBook(blob); // names pdf, acsm, mobi, not-zip

  let zip;
  try { zip = await openZip(blob); } catch (e) {
    const code = { cbz: 'cbz-corrupt', fbz: 'fb2-corrupt' }[ext];
    if (e.code === 'corrupt' && code) throw new BookError(code, e.message);
    throw e;
  }
  if (zip.has('META-INF/container.xml')) return openBook(blob, zip);
  const names = [...zip.entries.keys()].filter((n) => !junk(n));
  const fb2 = names.find((n) => /\.fb2$/i.test(n));
  if (fb2) {
    try { return await openFb2(await zip.blob(fb2), name); } catch (e) {
      if (e.code === 'corrupt' || e.code === 'missing') throw new BookError('fb2-corrupt', e.message);
      throw e;
    }
  }
  // A broken EPUB (it has a package or XHTML) stays "not an EPUB", not a picture book.
  const epubish = zip.has('mimetype') || names.some((n) => /\.(opf|x?html?)$/i.test(n));
  const comic = epubish ? null : await cbzBook(zip, name, opts);
  if (comic) return comic;
  throw new BookError(ext === 'cbz' ? 'cbz-empty' : 'not-epub', 'This ZIP holds no book and no comic pages.');
}

const CHARS_PER_PAGE = 1650;
export const STATS_VERSION = 2;

function countChapters(book) {
  const toc = Array.isArray(book.toc) ? book.toc : [];
  if (book.format === 'cbz') {
    return !book.tocPages && toc.length ? toc.length : 1;
  }
  if (toc.length && !book.tocPages) {
    const d0 = toc.filter((e) => (e.depth ?? 0) === 0).length;
    const d1 = toc.filter((e) => e.depth === 1).length;
    // Books wrapped in a single title node or a few Parts keep actual chapters at depth 1.
    if (d0 <= 3 && d1 >= 4) return d1;
    return d0 || toc.length;
  }
  const linear = (book.spine || []).filter((s) => s.linear !== false && s.path !== '__rp_cover__');
  return linear.length || (book.spine?.length ?? 0);
}

function visibleTextStats(html) {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const fragment = bodyMatch ? bodyMatch[1] : html;
  const cleaned = fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const hasMedia = /<(img|image|svg)\b/i.test(cleaned);
  const text = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { chars: text.length, hasMedia };
}

/**
 * Analyze and cache per-spine readable character counts and content weights on
 * `book` so pagination and progress never depend on raw HTML/XML tag bloat.
 */
export async function ensureSpineMetrics(book) {
  const spine = book?.spine || [];
  if (!spine.length) return [];
  if (book._spineMetrics?.length === spine.length) return book._spineMetrics;

  let metrics;
  if (book.format === 'cbz' || book.fixedLayout) {
    metrics = spine.map(() => ({ chars: 0, imageOnly: true, weight: 1 }));
  } else {
    const chunks = await Promise.all(spine.map((s) => book.zip?.text?.(s.path).catch(() => '') ?? ''));
    metrics = chunks.map((html, i) => {
      if (!html) {
        const fallback = Math.max(60, Math.round((spine[i]?.size ?? 1200) * 0.62));
        return { chars: fallback, imageOnly: false, weight: fallback };
      }
      const { chars, hasMedia } = visibleTextStats(html);
      const imageOnly = chars < 300 && hasMedia;
      return { chars, imageOnly, weight: imageOnly ? CHARS_PER_PAGE : Math.max(chars, 60) };
    });
  }
  book._spineMetrics = metrics;
  book._spineWeights = metrics.map((m) => m.weight);
  return metrics;
}

/**
 * Compute accurate chapter count (from ToC structure) and page count (exact for
 * fixed-layout/CBZ, visible-text + image-page estimate for reflowable books).
 */
export async function extractBookStats(book) {
  const chapterCount = countChapters(book);
  const spine = book.spine || [];
  if (!spine.length) {
    return { chapterCount, pageCount: 0, pageCountExact: false, metaVersion: STATS_VERSION };
  }
  const metrics = await ensureSpineMetrics(book);
  if (book.format === 'cbz' || book.fixedLayout) {
    return { chapterCount, pageCount: spine.length, pageCountExact: true, metaVersion: STATS_VERSION };
  }

  let totalChars = 0;
  let imagePages = 0;
  for (const m of metrics) {
    if (m.imageOnly) imagePages += 1;
    else totalChars += m.chars;
  }
  const textPages = totalChars > 0 ? Math.max(Math.round(totalChars / CHARS_PER_PAGE), 1) : 0;
  return {
    chapterCount,
    pageCount: Math.max(textPages + imagePages, 1),
    pageCountExact: false,
    metaVersion: STATS_VERSION,
  };
}
