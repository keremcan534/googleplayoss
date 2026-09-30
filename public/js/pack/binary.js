/*
 * Bağımlılıksız ikili yardımcılar: CRC32, ZIP yazma/okuma, 24-bit PNG kodlayıcı.
 *
 * ZIP: dosyalar "store" (sıkıştırmasız) yazılır — görseller zaten sıkıştırılmış, metinler küçük.
 * Okurken store ve deflate desteklenir (deflate için DecompressionStream('deflate-raw')).
 * PNG: Play tanıtım görseli ve ekran görüntüleri alfa kanalı kabul etmez; canvas.toBlob('image/png')
 * her zaman 32-bit RGBA üretir. Bu yüzden RGB (renk tipi 2, 8 bit) PNG'yi kendimiz kodlarız.
 */

/* ---------------- CRC32 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const toBytes = (d) => (typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

/* ---------------- ZIP ---------------- */

function dosTime(date) {
  const d = date || new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, day: day & 0xffff };
}

/**
 * @param {Array<{path:string, data:string|Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function zipStore(files, date = new Date()) {
  const { time, day } = dosTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path.replace(/^\/+/, ''));
    const data = toBytes(f.data);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 adlar
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, data);
    centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array|ArrayBuffer} buf
 * @returns {Promise<Array<{path:string, data:Uint8Array}>>}
 */
export async function unzip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli bir ZIP dosyası değil.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP merkez dizini bozuk.');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const loff = v.getUint32(p + 42, true);
    const path = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (path.endsWith('/')) continue;
    const lnl = v.getUint16(loff + 26, true);
    const lxl = v.getUint16(loff + 28, true);
    const start = loff + 30 + lnl + lxl;
    const raw = b.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`Desteklenmeyen ZIP sıkıştırması (${method}): ${path}`);
    if (crc32(data) !== crc) throw new Error(`CRC hatası: ${path}`);
    out.push({ path, data });
  }
  return out;
}

/* ---------------- PNG ---------------- */

async function zlibDeflate(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const t = enc.encode(type);
  out.set(t, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * RGBA piksellerinden (ImageData.data) alfasız 24-bit PNG.
 * Yarı saydam pikseller `bg` rengine karşı birleştirilir.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @returns {Promise<Uint8Array>}
 */
export async function encodePngRgb(rgba, width, height, bg = [255, 255, 255]) {
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 1; // Sub filtresi: fotoğrafik içerikte düz satırdan belirgin küçük
    let pr = 0; let pg = 0; let pb = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const r = a === 1 ? rgba[i] : Math.round(rgba[i] * a + bg[0] * (1 - a));
      const g = a === 1 ? rgba[i + 1] : Math.round(rgba[i + 1] * a + bg[1] * (1 - a));
      const b = a === 1 ? rgba[i + 2] : Math.round(rgba[i + 2] * a + bg[2] * (1 - a));
      const o = row + 1 + x * 3;
      raw[o] = (r - pr) & 0xff;
      raw[o + 1] = (g - pg) & 0xff;
      raw[o + 2] = (b - pb) & 0xff;
      pr = r; pg = g; pb = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await zlibDeflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

/**
 * Görsel başlığından boyut ve alfa bilgisi (PNG ve JPEG).
 * @returns {{type:'image/png'|'image/jpeg'|null, width:number, height:number, alpha:boolean|null, bitDepth?:number, colorType?:number}}
 */
export function imageInfo(bytes) {
  const b = toBytes(bytes);
  if (b.length > 24 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const colorType = b[25];
    let alpha = colorType === 4 || colorType === 6;
    if (!alpha) {
      // tRNS parçası da saydamlık ekler
      let p = 8;
      while (p + 8 < b.length) {
        const len = v.getUint32(p);
        const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (type === 'tRNS') { alpha = true; break; }
        if (type === 'IDAT' || type === 'IEND') break;
        p += 12 + len;
      }
    }
    return { type: 'image/png', width: v.getUint32(16), height: v.getUint32(20), alpha, bitDepth: b[24], colorType };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      const len = (b[p + 2] << 8) | b[p + 3];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { type: 'image/jpeg', height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8], alpha: false };
      }
      p += 2 + len;
    }
    return { type: 'image/jpeg', width: 0, height: 0, alpha: false };
  }
  return { type: null, width: 0, height: 0, alpha: null };
}

/**
 * Play görsel şartlarına göre denetim.
 * @param {'icon'|'featureGraphic'|'screenshot'} kind
 * @returns {Array<{level:'error'|'warn', msg:string}>}
 */
export function validateImage(kind, info, size) {
  const out = [];
  const err = (msg) => out.push({ level: 'error', msg });
  const warn = (msg) => out.push({ level: 'warn', msg });
  if (!info.type) { err('PNG ya da JPEG değil.'); return out; }
  if (kind === 'icon') {
    if (info.type !== 'image/png') err('İkon PNG olmalı.');
    if (info.width !== 512 || info.height !== 512) err(`İkon 512×512 olmalı (bu ${info.width}×${info.height}).`);
    if (size > 1024 * 1024) err(`İkon en fazla 1 MB olabilir (${Math.round(size / 1024)} KB).`);
  } else if (kind === 'featureGraphic') {
    if (info.width !== 1024 || info.height !== 500) err(`Tanıtım görseli 1024×500 olmalı (bu ${info.width}×${info.height}).`);
    if (info.alpha) err('Tanıtım görselinde alfa (saydamlık) olamaz: JPEG ya da 24-bit PNG kullan.');
    if (size > 15 * 1024 * 1024) err('Tanıtım görseli en fazla 15 MB olabilir.');
  } else if (kind === 'screenshot') {
    const lo = Math.min(info.width, info.height);
    const hi = Math.max(info.width, info.height);
    if (lo < 320) err(`Kısa kenar en az 320 px olmalı (${lo}).`);
    if (hi > 3840) err(`Uzun kenar en fazla 3840 px olabilir (${hi}).`);
    if (hi > 2 * lo) err('En-boy oranı 2:1\'i aşamaz.');
    if (info.alpha) err('Ekran görüntüsünde alfa (saydamlık) olamaz.');
    if (lo < 1080) warn('Öne çıkarılma için en az 1080 px önerilir.');
    if (size > 8 * 1024 * 1024) err('Ekran görüntüsü en fazla 8 MB olabilir.');
  }
  return out;
}
