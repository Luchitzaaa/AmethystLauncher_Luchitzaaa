'use strict';

// Minimal reader for Minecraft's NBT format (level.dat is gzipped, servers.dat is not).
// Read-only, and only what the launcher needs: world names and server lists. Longs become Numbers
// (precise enough for timestamps), arrays of numbers become plain arrays.

const zlib = require('node:zlib');

const MAX_DEPTH = 64;

function parse(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 64 * 1024 * 1024 });
  let p = 0;
  const need = (n) => {
    if (p + n > buf.length) throw new Error('Truncated NBT');
  };
  const u8 = () => (need(1), buf.readUInt8(p++));
  const i8 = () => (need(1), buf.readInt8(p++));
  const i16 = () => (need(2), (p += 2), buf.readInt16BE(p - 2));
  const u16 = () => (need(2), (p += 2), buf.readUInt16BE(p - 2));
  const i32 = () => (need(4), (p += 4), buf.readInt32BE(p - 4));
  const i64 = () => (need(8), (p += 8), Number(buf.readBigInt64BE(p - 8)));
  const f32 = () => (need(4), (p += 4), buf.readFloatBE(p - 4));
  const f64 = () => (need(8), (p += 8), buf.readDoubleBE(p - 8));
  const str = () => {
    const n = u16();
    need(n);
    p += n;
    return buf.toString('utf8', p - n, p);
  };
  const count = () => {
    const n = i32();
    if (n < 0 || n > buf.length) throw new Error('Bad NBT length');
    return n;
  };

  function payload(type, depth) {
    if (depth > MAX_DEPTH) throw new Error('NBT nested too deep');
    switch (type) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return f32();
      case 6: return f64();
      case 7: return Array.from({ length: count() }, i8);
      case 8: return str();
      case 9: {
        const inner = u8();
        return Array.from({ length: count() }, () => payload(inner, depth + 1));
      }
      case 10: {
        const out = {};
        for (;;) {
          const t = u8();
          if (t === 0) return out;
          out[str()] = payload(t, depth + 1);
        }
      }
      case 11: return Array.from({ length: count() }, i32);
      case 12: return Array.from({ length: count() }, i64);
      default: throw new Error(`Unknown NBT tag ${type}`);
    }
  }

  const rootType = u8();
  if (rootType !== 10) throw new Error('NBT root is not a compound');
  str(); // root name (usually empty)
  return payload(10, 0);
}

module.exports = { parse };
