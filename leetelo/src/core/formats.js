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
