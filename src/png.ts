import type { QRCode } from './index.js'
import { parseHexColor } from './color.js'

export interface PNGOptions {
  /** Exact output width and height. Must be a whole-number multiple of the module grid. */
  size?: number
  dark?: string
  light?: string
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array, start: number, end: number): number {
  let crc = 0xFFFFFFFF
  for (let i = start; i < end; i++)
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let offset = 0; offset < data.length;) {
    const end = Math.min(offset + 5552, data.length)
    for (; offset < end; offset++) {
      a += data[offset]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Zlib with stored DEFLATE blocks: larger than compressed output, but allocation-light and very fast. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const output = new Uint8Array(2 + blocks * 5 + data.length + 4)
  output[0] = 0x78
  output[1] = 0x01
  let inputOffset = 0
  let outputOffset = 2

  do {
    const length = Math.min(65535, data.length - inputOffset)
    const final = inputOffset + length === data.length
    output[outputOffset++] = final ? 1 : 0
    output[outputOffset++] = length & 0xFF
    output[outputOffset++] = length >>> 8
    output[outputOffset++] = ~length & 0xFF
    output[outputOffset++] = (~length >>> 8) & 0xFF
    output.set(data.subarray(inputOffset, inputOffset + length), outputOffset)
    outputOffset += length
    inputOffset += length
  } while (inputOffset < data.length)

  const checksum = adler32(data)
  output[outputOffset++] = checksum >>> 24
  output[outputOffset++] = checksum >>> 16
  output[outputOffset++] = checksum >>> 8
  output[outputOffset] = checksum
  return output
}

function writeChunk(output: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  view.setUint32(offset, data.length)
  for (let i = 0; i < 4; i++) output[offset + 4 + i] = type.charCodeAt(i)
  output.set(data, offset + 8)
  view.setUint32(offset + 8 + data.length, crc32(output, offset + 4, offset + 8 + data.length))
  return offset + 12 + data.length
}

/** Render a two-color, 1-bit indexed PNG in one synchronous pass. */
export function renderPNG(code: QRCode, options: PNGOptions = {}): Uint8Array {
  const size = options.size ?? code.size * 8
  if (!Number.isSafeInteger(size) || size < code.size || size > 8192)
    throw new RangeError(`size must be an integer from ${code.size} to 8192`)
  if (size % code.size !== 0)
    throw new RangeError(`size must be a multiple of ${code.size} to preserve whole-pixel modules`)

  const scale = size / code.size
  const dark = parseHexColor(options.dark ?? '#000000', 'dark')
  const light = parseHexColor(options.light ?? '#ffffff', 'light')
  const bytesPerRow = Math.ceil(size / 8)
  const raw = new Uint8Array((bytesPerRow + 1) * size)
  const packed = new Uint8Array(bytesPerRow)
  let rawOffset = 0

  for (let moduleY = 0; moduleY < code.size; moduleY++) {
    packed.fill(0)
    const modules = code.matrix[moduleY]
    for (let moduleX = 0; moduleX < code.size; moduleX++) {
      if (!modules[moduleX]) continue
      const start = moduleX * scale
      for (let pixel = start; pixel < start + scale; pixel++)
        packed[pixel >>> 3] |= 0x80 >>> (pixel & 7)
    }
    for (let repeat = 0; repeat < scale; repeat++) {
      raw[rawOffset++] = 0
      raw.set(packed, rawOffset)
      rawOffset += bytesPerRow
    }
  }

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, size)
  header.setUint32(4, size)
  ihdr[8] = 1 // one bit per pixel
  ihdr[9] = 3 // indexed color

  const palette = Uint8Array.of(...light, ...dark)
  const compressed = zlibStore(raw)
  const output = new Uint8Array(8 + 25 + 18 + 12 + compressed.length + 12)
  output.set(SIGNATURE)
  let offset = 8
  offset = writeChunk(output, offset, 'IHDR', ihdr)
  offset = writeChunk(output, offset, 'PLTE', palette)
  offset = writeChunk(output, offset, 'IDAT', compressed)
  writeChunk(output, offset, 'IEND', new Uint8Array(0))
  return output
}

