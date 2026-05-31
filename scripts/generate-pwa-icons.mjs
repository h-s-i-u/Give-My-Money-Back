// Generates simple on-brand PLACEHOLDER PWA icons (dark slate tile with a
// cyan→violet gradient and a "split" divider) so the app is installable
// immediately. Replace these with real branded art when ready.
//
// Run: node scripts/generate-pwa-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const png = (size, raw) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

function render(size, tileFrac) {
  const BG = [2, 6, 23];          // slate-950 #020617
  const CYAN = [34, 211, 238];    // #22d3ee
  const VIOLET = [139, 92, 246];  // #8b5cf6
  const WHITE = [248, 250, 252];

  const m = Math.round((size * (1 - tileFrac)) / 2);
  const x0 = m, y0 = m, x1 = size - m, y1 = size - m;
  const r = Math.round((x1 - x0) * 0.24);
  const barHalf = Math.max(1, Math.round(size * 0.022)); // central "split" divider
  const cxMid = size / 2;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    let off = y * (stride + 1);
    raw[off++] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      let col = BG;
      if (inRoundRect(x, y, x0, y0, x1, y1, r)) {
        const t = ((x - x0) + (y - y0)) / ((x1 - x0) + (y1 - y0));
        col = [lerp(CYAN[0], VIOLET[0], t), lerp(CYAN[1], VIOLET[1], t), lerp(CYAN[2], VIOLET[2], t)];
        // vertical divider in the middle suggests "splitting" the bill
        if (Math.abs(x - cxMid) <= barHalf && y > y0 + r * 0.5 && y < y1 - r * 0.5) col = WHITE;
      }
      raw[off++] = col[0];
      raw[off++] = col[1];
      raw[off++] = col[2];
    }
  }
  return png(size, raw);
}

const files = [
  ["pwa-192x192.png", 192, 0.74],
  ["pwa-512x512.png", 512, 0.74],
  ["maskable-512x512.png", 512, 0.6], // smaller tile keeps content in the maskable safe zone
  ["apple-touch-icon-180x180.png", 180, 0.78],
];
for (const [name, size, frac] of files) {
  writeFileSync(new URL(name, OUT), render(size, frac));
  console.log("wrote public/icons/" + name);
}
