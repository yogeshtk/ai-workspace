// Generates the PNG app icons (192/512) with no image dependencies:
// shapes are rasterised with 4x4 supersampling and written with node:zlib.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x0b, 0x12, 0x20];
const FG = [0xff, 0xd4, 0x00];

function roundRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || y < ry || x > rx + rw || y > ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const LEGS = [[196, 354], [150, 420], [186, 420], [214, 380], [298, 380], [326, 420], [362, 420], [316, 354]];
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Same design as icon.svg, in a 512 coordinate space.
function colourAt(x, y) {
  const body = roundRect(x, y, 146, 104, 220, 250, 48);
  const window = roundRect(x, y, 178, 146, 156, 86, 14);
  const lights = circle(x, y, 196, 296, 20) || circle(x, y, 316, 296, 20);
  const legs = inPolygon(x, y, LEGS);
  if (body && !window && !lights) return FG;
  if (legs) return FG;
  return BG;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const s = 512 / size;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const c = colourAt((px + (sx + 0.5) / 4) * s, (py + (sy + 0.5) / 4) * s);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / 16; raw[o + 1] = g / 16; raw[o + 2] = b / 16;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

for (const size of [192, 512]) writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size));
console.log('Wrote public/icons/icon-192.png and icon-512.png');
