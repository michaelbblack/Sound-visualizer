/**
 * Minimal GIF89a decoder — no dependencies, DOM-free.
 * decodeGif(bytes) -> { width, height, frames: [{ rgba: Uint8ClampedArray, delay: ms }] }
 * Each frame's rgba is the fully composited image (disposal methods applied),
 * so frames can be blitted independently in any order — which is what lets the
 * visualizer scrub playback to the beat instead of playing linearly.
 */

export async function loadGif(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return decodeGif(new Uint8Array(await res.arrayBuffer()));
}

export function decodeGif(bytes) {
  let p = 0;
  const readU16 = () => bytes[p++] | (bytes[p++] << 8);

  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^GIF8[79]a$/.test(sig)) throw new Error('Not a GIF file');
  p = 6;

  const width = readU16();
  const height = readU16();
  const packed = bytes[p++];
  p += 2; // background color index + aspect ratio
  let gct = null;
  if (packed & 0x80) {
    const size = 3 * (2 << (packed & 7));
    gct = bytes.subarray(p, p + size);
    p += size;
  }

  const frames = [];
  let comp = new Uint8ClampedArray(width * height * 4); // running composition
  let gce = null; // graphic control extension for the next image

  while (p < bytes.length) {
    const block = bytes[p++];

    if (block === 0x3b) break; // trailer

    if (block === 0x21) { // extension
      const label = bytes[p++];
      if (label === 0xf9) { // graphic control
        p++; // block size (always 4)
        const flags = bytes[p];
        gce = {
          disposal: (flags >> 2) & 7,
          hasTransparency: !!(flags & 1),
          delay: (bytes[p + 1] | (bytes[p + 2] << 8)) * 10,
          transparentIndex: bytes[p + 3],
        };
        p += 4;
        p++; // block terminator
      } else {
        let s;
        while ((s = bytes[p++]) !== 0) p += s; // skip sub-blocks
      }
      continue;
    }

    if (block === 0x2c) { // image descriptor
      const left = readU16();
      const top = readU16();
      const fw = readU16();
      const fh = readU16();
      const iflags = bytes[p++];
      let ct = gct;
      if (iflags & 0x80) { // local color table
        const size = 3 * (2 << (iflags & 7));
        ct = bytes.subarray(p, p + size);
        p += size;
      }
      const interlaced = !!(iflags & 0x40);

      const minCodeSize = bytes[p++];
      let total = 0;
      const chunks = [];
      let s;
      while ((s = bytes[p++]) !== 0) {
        chunks.push(bytes.subarray(p, p + s));
        total += s;
        p += s;
      }
      const data = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        data.set(c, off);
        off += c.length;
      }

      const indices = lzwDecode(minCodeSize, data, fw * fh);
      const rowMap = interlaced ? interlaceRowMap(fh) : null;
      const prev = gce && gce.disposal === 3 ? comp.slice() : null;
      const tIdx = gce && gce.hasTransparency ? gce.transparentIndex : -1;

      for (let y = 0; y < fh; y++) {
        const destY = top + (rowMap ? rowMap[y] : y);
        if (destY >= height) continue;
        for (let x = 0; x < fw; x++) {
          const destX = left + x;
          if (destX >= width) continue;
          const idx = indices[y * fw + x];
          if (idx === tIdx) continue;
          const o = (destY * width + destX) * 4;
          const c = idx * 3;
          comp[o] = ct[c];
          comp[o + 1] = ct[c + 1];
          comp[o + 2] = ct[c + 2];
          comp[o + 3] = 255;
        }
      }

      let delay = gce ? gce.delay : 100;
      if (delay < 20) delay = 100; // browser-style clamp for 0-delay GIFs
      frames.push({ rgba: comp.slice(), delay });

      // Apply disposal for the NEXT frame
      if (gce) {
        if (gce.disposal === 2) {
          // restore to background = clear the frame's rect to transparent
          for (let y = top; y < Math.min(top + fh, height); y++) {
            comp.fill(0, (y * width + left) * 4, (y * width + Math.min(left + fw, width)) * 4);
          }
        } else if (gce.disposal === 3 && prev) {
          comp = prev;
        }
      }
      gce = null;
      continue;
    }

    break; // unknown block: stop parsing, keep what we have
  }

  if (!frames.length) throw new Error('GIF contained no frames');
  return { width, height, frames };
}

/** Stored-row -> display-row mapping for interlaced images. */
function interlaceRowMap(fh) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < fh; y += step) rows.push(y);
  }
  return rows;
}

function lzwDecode(minCodeSize, data, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];

  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    dict[clearCode] = [];
    dict[eoiCode] = null;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  let bitBuf = 0;
  let bits = 0;
  let outPos = 0;
  let prev = null;

  for (let i = 0; i < data.length && outPos < pixelCount; i++) {
    bitBuf |= data[i] << bits;
    bits += 8;

    while (bits >= codeSize && outPos < pixelCount) {
      const code = bitBuf & ((1 << codeSize) - 1);
      bitBuf >>>= codeSize;
      bits -= codeSize;

      if (code === clearCode) {
        resetDict();
        prev = null;
        continue;
      }
      if (code === eoiCode) return out;

      let entry;
      if (code < dict.length && dict[code]) {
        entry = dict[code];
      } else if (code === dict.length && prev) {
        entry = prev.concat(prev[0]); // the KwKwK case
      } else {
        return out; // corrupt stream: bail with what we decoded
      }

      for (let j = 0; j < entry.length && outPos < pixelCount; j++) {
        out[outPos++] = entry[j];
      }

      if (prev) {
        dict.push(prev.concat(entry[0]));
        // grow code size when the dictionary fills the current code space
        if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
  }
  return out;
}
