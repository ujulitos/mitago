// ZIP reader over a Blob: reads only the central directory up front, then
// inflates single entries on demand with DecompressionStream. Never loads the
// whole archive into memory. Handles ZIP64 and data-descriptor entries (sizes
// always come from the central directory). Works in browsers and node 20+.

export class BookError extends Error {
  /** `code` is stable and drives the user-facing message; `detail` names specifics (DRM scheme, entry). */
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const FF32 = 0xffffffff;

async function view(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}
const u64 = (dv, at) => Number(dv.getBigUint64(at, true));

/** Sniff the first bytes so a wrong file gets a specific message. */
export async function sniff(blob) {
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const ascii = String.fromCharCode(...head.subarray(0, 1024));
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (ascii.startsWith('Rar!\x1a\x07')) return 'rar';
  if (ascii.startsWith('7z\xbc\xaf\x27\x1c')) return '7z';
  if (/<FictionBook\b/.test(ascii)) return 'fb2';
  if (/<fulfillmentToken\b/.test(ascii)) return 'acsm';
  if (ascii.slice(60, 68) === 'BOOKMOBI') return 'mobi';
  return 'unknown';
}

const MESSAGES = {
  pdf: 'This is a PDF, not an EPUB.',
  acsm: 'This is an Adobe .acsm download ticket, not a book. It needs Adobe Digital Editions, which adds DRM.',
  mobi: 'This is a Kindle/MOBI book, not an EPUB.',
  unknown: 'Not an EPUB (not a ZIP archive).',
  rar: 'This is a RAR archive (.cbr), not a ZIP.',
  '7z': 'This is a 7-Zip archive (.cb7), not a ZIP.',
  fb2: 'This is an FB2 book, not a ZIP.',
};

export async function openZip(blob) {
  const kind = await sniff(blob);
  if (kind !== 'zip') throw new BookError({ unknown: 'not-zip', rar: 'cbr', '7z': 'cb7' }[kind] ?? kind, MESSAGES[kind]);

  // EOCD is in the last 22 bytes + up to 64 KiB of comment.
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await view(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new BookError('corrupt', 'The file is damaged or incomplete (no ZIP directory).');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === FF32 || cdOffset === FF32) {
    // ZIP64: the locator sits right before the EOCD and points at the EOCD64 record.
    const locAt = tailStart + eocd - 20;
    const loc = locAt >= 0 ? await view(blob, locAt, locAt + 20) : null;
    if (!loc || loc.getUint32(0, true) !== EOCD64_LOC_SIG) throw new BookError('corrupt', 'The file is damaged (ZIP64 directory missing).');
    const at = u64(loc, 8);
    const e64 = await view(blob, at, at + 56);
    if (e64.byteLength < 56 || e64.getUint32(0, true) !== EOCD64_SIG) throw new BookError('corrupt', 'The file is damaged (ZIP64 directory unreadable).');
    count = u64(e64, 32);
    cdSize = u64(e64, 40);
    cdOffset = u64(e64, 48);
  }
  if (cdOffset + cdSize > blob.size) throw new BookError('corrupt', 'The file is damaged or incomplete.');

  const cd = await view(blob, cdOffset, cdOffset + cdSize);
  const entries = new Map();
  const lower = new Map(); // lower-cased name -> real name (books with wrong-case hrefs)
  const dec = new TextDecoder();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CEN_SIG) throw new BookError('corrupt', 'The ZIP directory is damaged.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra field (0x0001): only the fields that are 0xFFFFFFFF, in this order.
    for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end;) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 1) {
        let f = x + 4;
        if (size === FF32) { size = u64(cd, f); f += 8; }
        if (compSize === FF32) { compSize = u64(cd, f); f += 8; }
        if (localOffset === FF32) { localOffset = u64(cd, f); }
      }
      x += 4 + len;
    }
    entries.set(name, { name, method, compSize, size, localOffset, encrypted: !!(flags & 1) });
    lower.set(name.toLowerCase(), name);
    p += 46 + nameLen + extraLen + commentLen;
  }

  const find = (name) => entries.get(name) ?? entries.get(lower.get(name.toLowerCase()));

  async function blobOf(name) {
    const e = find(name);
    if (!e) throw new BookError('missing', `Missing file in book: ${name}`, name);
    if (e.encrypted) throw new BookError('encrypted', 'This book is password-protected.', name);
    const lh = await view(blob, e.localOffset, e.localOffset + 30);
    if (lh.byteLength < 30 || lh.getUint32(0, true) !== LOC_SIG) throw new BookError('corrupt', `Damaged entry: ${name}`, name);
    // Local name/extra lengths may differ from the central ones; sizes may be 0
    // here (data descriptor) or 0xFFFFFFFF (ZIP64), so they are never read.
    const start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + e.compSize > blob.size) throw new BookError('corrupt', `Truncated entry: ${name}`, name);
    const raw = blob.slice(start, start + e.compSize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new BookError('method', `Unsupported compression in ${name}`, name);
    return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  }

  return {
    entries,
    has: (name) => !!find(name),
    entry: find,
    blob: blobOf,
    async text(name) { return (await blobOf(name)).text(); },
  };
}

/**
 * An in-memory "zip" with the same surface as openZip()'s (entries, has, entry,
 * blob, text), for books built from other formats. `files`: Map name ->
 * { size, type, text?: string, blob?: () => Blob|Promise<Blob> }. Names not in
 * `files` fall through to `base` (a real zip), so a CBZ keeps its images in place.
 */
export function memZip(files, base = null) {
  const entries = new Map(base?.entries);
  for (const [name, f] of files) entries.set(name, { name, method: 0, compSize: f.size, size: f.size, encrypted: false });
  const find = (name) => (files.has(name) ? entries.get(name) : base?.entry(name));
  async function blobOf(name) {
    const f = files.get(name);
    if (f) return f.text !== undefined ? new Blob([f.text], { type: f.type }) : f.blob();
    if (base) return base.blob(name);
    throw new BookError('missing', `Missing file in book: ${name}`, name);
  }
  return {
    entries,
    has: (name) => !!find(name),
    entry: find,
    blob: blobOf,
    async text(name) { return files.get(name)?.text ?? (await blobOf(name)).text(); },
  };
}
