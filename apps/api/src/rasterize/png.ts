import { inflateSync } from "node:zlib";

export type Pixels = {
  width: number;
  height: number;
  /** RGBA, row by row from the top-left. */
  data: Uint8Array;
};

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. */
export function decodePng(bytes: Uint8Array): Pixels {
  if (!SIGNATURE.every((value, i) => bytes[i] === value)) {
    throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (
        depth !== 8 ||
        interlace !== 0 ||
        (colorType !== 2 && colorType !== 6)
      ) {
        throw new Error(`unsupported PNG: ${depth} ${colorType} ${interlace}`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      parts.push(body);
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const predictor = [
        0,
        left,
        up,
        (left + up) >> 1,
        paeth(left, up, upLeft),
      ][filter]!;
      row[i] = (line[i]! + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        data[(y * width + x) * 4 + c] =
          c < channels ? row[x * channels + c]! : 255;
      }
    }
    previous = row;
  }
  return { width, height, data };
}

/** The pixel at (x, y) as `#RRGGBB`. */
export function colorAt(pixels: Pixels, x: number, y: number): string {
  const at = (y * pixels.width + x) * 4;
  return `#${[...pixels.data.subarray(at, at + 3)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** The positions of every pixel that is not `#FFFFFF`, as `x,y`. */
export function nonWhite(pixels: Pixels): string[] {
  const found: string[] = [];
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (colorAt(pixels, x, y) !== "#FFFFFF") found.push(`${x},${y}`);
    }
  }
  return found;
}
