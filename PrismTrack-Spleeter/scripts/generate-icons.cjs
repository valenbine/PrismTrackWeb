const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const sizes = [16, 24, 32, 48, 64, 128, 256];
const outputDir = path.join(__dirname, "..", "build", "icons");

fs.mkdirSync(outputDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPng(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const nx = x / (size - 1 || 1);
      const ny = y / (size - 1 || 1);
      const r = Math.round(34 + 25 * (1 - ny));
      const g = Math.round(197 + 30 * (1 - nx));
      const b = Math.round(94 + 161 * nx);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  const prism = [
    [0.2, 0.72],
    [0.44, 0.2],
    [0.56, 0.2],
    [0.32, 0.72],
  ];
  const beam = [
    [0.53, 0.2],
    [0.82, 0.2],
    [0.59, 0.72],
    [0.41, 0.72],
  ];

  function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0] * size;
      const yi = polygon[i][1] * size;
      const xj = polygon[j][0] * size;
      const yj = polygon[j][1] * size;
      const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = y * (stride + 1) + 1 + x * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      if (pointInPolygon(px, py, prism)) {
        raw[offset] = 8;
        raw[offset + 1] = 15;
        raw[offset + 2] = 28;
      }

      if (pointInPolygon(px, py, beam)) {
        raw[offset] = 212;
        raw[offset + 1] = 253;
        raw[offset + 2] = 230;
      }
    }
  }

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngs = sizes.map((size) => ({ size, buffer: createPng(size) }));

for (const { size, buffer } of pngs) {
  fs.writeFileSync(path.join(outputDir, `prismtrack-${size}.png`), buffer);
}

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const entries = [];
for (const { size, buffer } of pngs) {
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(buffer.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += buffer.length;
  entries.push(entry);
}

const ico = Buffer.concat([iconDir, ...entries, ...pngs.map((item) => item.buffer)]);
fs.writeFileSync(path.join(outputDir, "prismtrack.ico"), ico);

console.log(`Generated PrismTrack icons in ${outputDir}`);
