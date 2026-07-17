// Generates every icon the desktop app needs — no image dependencies.
// A tiny PNG encoder (zlib is built into Node) + the ICO container format,
// rendering the Switchyard mark (a rail line diverging at a switch) with
// per-pixel signed-distance functions.
//
// Outputs:
//   build/icon.png              512px, electron-builder converts for macOS
//   build/icon.ico              16/24/32/48/64/128/256 PNG-compressed entries
//   src/renderer/window.png     256px window icon (dev / Linux fallback)
//   src/renderer/tray.png       32px white-on-transparent tray mark
//   src/renderer/tray@2x.png    64px
// The src/renderer copies ride tsup's publicDir into dist/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** rgba: Buffer of size*size*4. Returns a complete PNG file buffer. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Modern ICO: PNG-compressed entries (supported since Vista). */
function encodeIco(pngsBySize) {
  const entries = [...pngsBySize].sort((a, b) => a[0] - b[0]);
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  const blobs = [];
  entries.forEach(([size, png], i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size; // 0 means 256
    header[e + 1] = size >= 256 ? 0 : size;
    header[e + 2] = 0; // palette
    header[e + 3] = 0; // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
    blobs.push(png);
  });
  return Buffer.concat([header, ...blobs]);
}

// ---- SDF rendering ----------------------------------------------------------

/** Distance from point to segment, all in unit coords. */
function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return Math.hypot(dx, dy);
}

function roundedRectDist(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const AMBER = [246, 168, 33];
const SKY = [56, 189, 248];
const WHITE = [244, 247, 252];

// The mark: a main line from the bottom that reaches a switch point and
// diverges — one route continues (amber), one branches off (sky).
const JUNCTION = [0.5, 0.55];
const SEGMENTS = [
  { a: [0.5, 0.85], b: JUNCTION, color: AMBER },
  { a: JUNCTION, b: [0.29, 0.21], color: AMBER },
  { a: JUNCTION, b: [0.71, 0.21], color: SKY },
];
const DOTS = [
  { c: [0.5, 0.85], r: 0.072, color: AMBER },
  { c: [0.29, 0.21], r: 0.072, color: AMBER },
  { c: [0.71, 0.21], r: 0.072, color: SKY },
  { c: JUNCTION, r: 0.05, color: WHITE },
];
const TRACK_HALFWIDTH = 0.05;

/** coverage in [0,1] for a signed distance (negative = inside). */
function cov(dist, aa) {
  return Math.max(0, Math.min(1, 0.5 - dist / aa));
}

function blend(dst, src, alpha) {
  dst[0] = src[0] * alpha + dst[0] * (1 - alpha);
  dst[1] = src[1] * alpha + dst[1] * (1 - alpha);
  dst[2] = src[2] * alpha + dst[2] * (1 - alpha);
  dst[3] = alpha + dst[3] * (1 - alpha);
}

/**
 * Full app icon: rounded-square dark backdrop + colored mark.
 * `scale` shrinks the artwork toward the center (tiny sizes need margins).
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // premultiplied-ish accumulation buffer [r,g,b,a] with rgb 0..255, a 0..1
      const px = [0, 0, 0, 0];

      const bgDist = roundedRectDist(u, v, 0.5, 0.5, 0.48, 0.48, 0.115);
      const bgCov = cov(bgDist, aa);
      if (bgCov > 0) {
        // vertical gradient with a faint top sheen
        const t = v;
        const bg = [
          26 + (12 - 26) * t,
          35 + (17 - 35) * t,
          56 + (30 - 56) * t,
        ];
        blend(px, bg, bgCov);
        // hairline inner border for definition on light backgrounds
        const borderCov = cov(Math.abs(bgDist + 0.012) - 0.006, aa) * 0.25;
        blend(px, [120, 140, 175], borderCov * bgCov);

        for (const s of SEGMENTS) {
          const d = segDist(u, v, s.a[0], s.a[1], s.b[0], s.b[1]) - TRACK_HALFWIDTH;
          blend(px, s.color, cov(d, aa) * bgCov);
        }
        for (const dot of DOTS) {
          const d = Math.hypot(u - dot.c[0], v - dot.c[1]) - dot.r;
          blend(px, dot.color, cov(d, aa) * bgCov);
        }
      }

      const o = (y * size + x) * 4;
      rgba[o] = Math.round(px[0]);
      rgba[o + 1] = Math.round(px[1]);
      rgba[o + 2] = Math.round(px[2]);
      rgba[o + 3] = Math.round(px[3] * 255);
    }
  }
  return rgba;
}

/** Tray mark: the rails alone, white on transparent (reads on dark taskbars). */
function renderTray(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size;
  const wide = TRACK_HALFWIDTH * 1.25; // beef up for 16-32px legibility
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let a = 0;
      for (const s of SEGMENTS) {
        const d = segDist(u, v, s.a[0], s.a[1], s.b[0], s.b[1]) - wide;
        a = Math.max(a, cov(d, aa));
      }
      for (const dot of DOTS) {
        const d = Math.hypot(u - dot.c[0], v - dot.c[1]) - dot.r * 1.15;
        a = Math.max(a, cov(d, aa));
      }
      const o = (y * size + x) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

// ---- outputs ----------------------------------------------------------------

const buildDir = join(root, "build");
const rendererDir = join(root, "src", "renderer");
mkdirSync(buildDir, { recursive: true });
mkdirSync(rendererDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map((s) => [s, encodePng(s, renderIcon(s))]);
writeFileSync(join(buildDir, "icon.ico"), encodeIco(icoPngs));
writeFileSync(join(buildDir, "icon.png"), encodePng(512, renderIcon(512)));
writeFileSync(join(rendererDir, "window.png"), encodePng(256, renderIcon(256)));
writeFileSync(join(rendererDir, "tray.png"), encodePng(32, renderTray(32)));
writeFileSync(join(rendererDir, "tray@2x.png"), encodePng(64, renderTray(64)));

console.log("icons written: build/icon.ico, build/icon.png, renderer tray/window PNGs");
