import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export function ensureDir(dirPath) {
  return fs.mkdir(dirPath, { recursive: true });
}

export async function atomicWriteFile(filePath, content) {
  await ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const file = await fs.open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.chmod(temp, 0o644);
    await fs.rename(temp, filePath);
  } catch (error) {
    await removeFile(temp).catch(cleanupError => console.warn(cleanupError));
    throw error;
  }
}

export function atomicWriteJson(filePath, data) {
  return atomicWriteFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

export async function readJsonStrict(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function readJsonSafe(filePath, fallback) {
  try {
    return await readJsonStrict(filePath, fallback);
  } catch (error) {
    console.warn(`Cannot read ${filePath}:`, error.message);
    return { error, value: fallback };
  }
}

export async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function readDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function createKeyedLock() {
  const pending = new Map();
  async function withLock(key, asyncFn) {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(asyncFn);
    pending.set(key, next);
    try {
      return await next;
    } finally {
      if (pending.get(key) === next) pending.delete(key);
    }
  }
  return Object.assign(withLock, { withLock });
}

export function safeJoin(baseDir, ...segments) {
  const resolved = path.resolve(baseDir, ...segments);
  const relative = path.relative(baseDir, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Path must stay inside its base directory');
  }
  return resolved;
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const imageMimes = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function dimensions(width, height) {
  return width > 0 && height > 0 && width <= 16384 && height <= 16384;
}

function pngSize(buffer) {
  if (buffer.length < 45 || buffer.readUInt32BE(8) !== 13 || buffer.toString('latin1', 12, 16) !== 'IHDR') return;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const color = buffer[25];
  const channels = [1, 0, 3, 1, 2, 0, 4][color];
  if (!dimensions(width, height) || !channels || ![1, 2, 4, 8, 16].includes(depth) ||
      (depth < 8 && color !== 0 && color !== 3) || (depth === 16 && color === 3) ||
      buffer[26] !== 0 || buffer[27] !== 0 || buffer[28] > 1) return;
  const data = [];
  for (let offset = 33; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const next = offset + 12 + size;
    if (next > buffer.length) return;
    if (type === 'IDAT' && size) data.push(buffer.subarray(offset + 8, offset + 8 + size));
    if (type === 'IEND' && size === 0 && next === buffer.length && data.length) {
      // Inspect the zlib stream without inflating a potentially huge pixel buffer.
      const compressed = Buffer.concat(data);
      if (compressed.length < 8 || (compressed[0] & 15) !== 8 ||
          (compressed[0] >> 4) > 7 || (compressed[1] & 32) || compressed.readUInt16BE() % 31 !== 0) return;
      // For small images verify the exact scanline size, including Adam7 passes.
      const passes = buffer[28] ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
        [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
      const expected = passes.reduce((sum, [x, y, dx, dy]) => {
        const cols = Math.ceil((width - x) / dx);
        const rows = Math.ceil((height - y) / dy);
        return cols > 0 && rows > 0 ? sum + rows * (1 + Math.ceil(cols * depth * channels / 8)) : sum;
      }, 0);
      // shortcut: large PNGs get container validation, use streaming inflate for full scanline validation.
      if (expected <= (16 << 20) && inflateSync(compressed, { maxOutputLength: expected }).length !== expected) return;
      return [width, height];
    }
    offset = next;
  }
}

function jpegSize(buffer) {
  let size;
  let scanning = false;
  let hasScanData = false;
  for (let offset = 2; offset < buffer.length;) {
    const byte = buffer[offset++];
    if (byte !== 0xff) {
      if (!scanning) return;
      if (byte) hasScanData = true;
      continue;
    }
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (scanning && marker === 0) {
      hasScanData = true;
      continue;
    }
    if (scanning && marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9) return hasScanData && size;
    scanning = false;
    if (offset + 2 > buffer.length) return;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11 || length !== 8 + 3 * buffer[offset + 7]) return;
      size = [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
      if (!dimensions(...size)) return;
    }
    if (marker === 0xda) {
      if (!size || length < 8 || length !== 6 + 2 * buffer[offset + 2]) return;
      scanning = true;
    }
    offset += length;
  }
}

function gifSize(buffer) {
  if (buffer.length < 14) return;
  let offset = 13 + (buffer[10] & 128 ? 3 << ((buffer[10] & 7) + 1) : 0);
  let hasImage = false;
  while (offset < buffer.length) {
    const block = buffer[offset++];
    if (block === 0x3b) return hasImage && [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
    if (block === 0x21) {
      offset++;
    } else if (block === 0x2c && offset + 9 < buffer.length) {
      if (!dimensions(buffer.readUInt16LE(offset + 4), buffer.readUInt16LE(offset + 6))) return;
      const flags = buffer[offset + 8];
      offset += 9 + (flags & 128 ? 3 << ((flags & 7) + 1) : 0);
      const codeSize = buffer[offset++];
      if (codeSize < 2 || codeSize > 8 || !buffer[offset] ||
          !(buffer.subarray(offset + 1, offset + 1 + buffer[offset]).some(Boolean))) return;
      hasImage = true;
    } else {
      return;
    }
    while (offset < buffer.length && buffer[offset]) offset += 1 + buffer[offset];
    offset++;
  }
}

function webpFrame(type, data) {
  if (type === 'VP8 ' && data.length > 10 && !(data[0] & 1) &&
      data.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a])) &&
      (data.readUIntLE(0, 3) >> 5) > 0 && (data.readUIntLE(0, 3) >> 5) <= data.length - 10) {
    return [data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff];
  }
  if (type === 'VP8L' && data.length > 5 && data[0] === 0x2f && data.subarray(5).some(Boolean)) {
    const bits = data.readUInt32LE(1);
    if (bits >>> 29 === 0) return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
}

function webpSize(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(4) !== buffer.length - 8) return;
  let canvas;
  let frame;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    offset = start + size + (size % 2);
    if (offset > buffer.length) return;
    const data = buffer.subarray(start, start + size);
    if (type === 'VP8X') {
      if (size !== 10) return;
      canvas = [data.readUIntLE(4, 3) + 1, data.readUIntLE(7, 3) + 1];
    } else if (type === 'ANMF' && size > 24) {
      for (let pos = 16; pos + 8 <= data.length;) {
        const subSize = data.readUInt32LE(pos + 4);
        const end = pos + 8 + subSize;
        if (end > data.length) return;
        frame = webpFrame(data.toString('latin1', pos, pos + 4), data.subarray(pos + 8, end)) || frame;
        pos = end + (subSize % 2);
      }
    } else {
      frame = webpFrame(type, data) || frame;
    }
  }
  if (offset === buffer.length && frame && dimensions(...frame)) return canvas || frame;
}

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const jpegSignature = Buffer.from('ffd8ff', 'hex');

export function validateImageBuffer(buffer) {
  try {
    let ext;
    let size;
    if (Buffer.isBuffer(buffer)) {
      if (buffer.subarray(0, 8).equals(pngSignature)) {
        ext = 'png';
        size = pngSize(buffer);
      } else if (buffer.subarray(0, 3).equals(jpegSignature)) {
        ext = 'jpg';
        size = jpegSize(buffer);
      } else if (/^GIF8[79]a$/.test(buffer.toString('latin1', 0, 6))) {
        ext = 'gif';
        size = gifSize(buffer);
      } else if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
        ext = 'webp';
        size = webpSize(buffer);
      }
    }
    if (size && dimensions(...size)) return { ok: true, ext, mime: imageMimes[ext], width: size[0], height: size[1] };
  } catch (error) {
    if (!(error instanceof RangeError) && !error.code) throw error;
  }
  return { ok: false, error: 'Invalid or unsupported image' };
}
