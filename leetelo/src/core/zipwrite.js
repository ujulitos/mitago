// ZIP writer, STORE only (books are already compressed). Builds the archive as
// a Blob of parts: book Blobs are referenced, never copied into one buffer.
// Writes ZIP64 records only where a size, offset or count needs them (`limit`
// is lowered by the unit tests to exercise that path). Read back by zip.js.

const FF32 = 0xffffffff;

let table;
/** CRC-32 of a Blob, streamed chunk by chunk. */
export async function crc32(blob) {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = FF32;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) crc = table[(crc ^ value[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ FF32) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/** entries: [{ name, data: Blob | string }] -> Blob (application/zip). */
export async function zipBlob(entries, { limit = FF32, date = new Date() } = {}) {
  const enc = new TextEncoder();
  const [time, day] = dosTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const nameBytes = enc.encode(name);
    const crc = await crc32(blob);
    const size = blob.size;
    const big = size >= limit;
    const farOff = offset >= limit;

    const local = new DataView(new ArrayBuffer(30 + nameBytes.length + (big ? 20 : 0)));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, big ? 45 : 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, big ? FF32 : size, true);
    local.setUint32(22, big ? FF32 : size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, big ? 20 : 0, true);
    new Uint8Array(local.buffer).set(nameBytes, 30);
    if (big) {
      const x = 30 + nameBytes.length;
      local.setUint16(x, 1, true);
      local.setUint16(x + 2, 16, true);
      local.setBigUint64(x + 4, BigInt(size), true);
      local.setBigUint64(x + 12, BigInt(size), true);
    }
    parts.push(local, blob);

    // Central record: the ZIP64 extra holds only the fields marked 0xFFFFFFFF, in order.
    const extra = [...(big ? [size, size] : []), ...(farOff ? [offset] : [])];
    const cen = new DataView(new ArrayBuffer(46 + nameBytes.length + (extra.length ? 4 + extra.length * 8 : 0)));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 45, true);
    cen.setUint16(6, extra.length ? 45 : 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, big ? FF32 : size, true);
    cen.setUint32(24, big ? FF32 : size, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, extra.length ? 4 + extra.length * 8 : 0, true);
    cen.setUint32(42, farOff ? FF32 : offset, true);
    new Uint8Array(cen.buffer).set(nameBytes, 46);
    if (extra.length) {
      const x = 46 + nameBytes.length;
      cen.setUint16(x, 1, true);
      cen.setUint16(x + 2, extra.length * 8, true);
      extra.forEach((v, i) => cen.setBigUint64(x + 4 + i * 8, BigInt(v), true));
    }
    central.push(cen);
    offset += local.byteLength + size;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((a, c) => a + c.byteLength, 0);
  const count = central.length;
  const z64 = count >= Math.min(0xffff, limit) || cdOffset >= limit || cdSize >= limit;
  const tail = [];
  if (z64) {
    const e64 = new DataView(new ArrayBuffer(56));
    e64.setUint32(0, 0x06064b50, true);
    e64.setBigUint64(4, 44n, true);
    e64.setUint16(12, 45, true);
    e64.setUint16(14, 45, true);
    e64.setBigUint64(24, BigInt(count), true);
    e64.setBigUint64(32, BigInt(count), true);
    e64.setBigUint64(40, BigInt(cdSize), true);
    e64.setBigUint64(48, BigInt(cdOffset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(cdOffset + cdSize), true);
    loc.setUint32(16, 1, true);
    tail.push(e64, loc);
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, z64 ? 0xffff : count, true);
  eocd.setUint16(10, z64 ? 0xffff : count, true);
  eocd.setUint32(12, z64 ? FF32 : cdSize, true);
  eocd.setUint32(16, z64 ? FF32 : cdOffset, true);
  return new Blob([...parts, ...central, ...tail, eocd], { type: 'application/zip' });
}
