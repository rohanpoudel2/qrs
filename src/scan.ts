import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { convertIndexedToRgb, decode as decodePNG, hasPngSignature } from 'fast-png'
import { encode as encodeJPEG } from 'jpeg-js'
import {
  prepareZXingModule,
  readBarcodes,
  ZXING_WASM_VERSION,
} from 'zxing-wasm/reader'
import type { ReaderOptions } from 'zxing-wasm/reader'

export type ScanProfile = 'screen' | 'print'

export interface ScanOptions {
  profile?: ScanProfile
  /** Require every variant to decode to this exact value. */
  expected?: string
  /** Include nondeterministic millisecond measurements in the report. */
  timings?: boolean
}

export interface ScanTestResult {
  name: 'original' | 'resize' | 'blur' | 'compression' | 'lowContrast'
  passed: boolean
  decoded?: string
  durationMs?: number
}

export interface ScanReport {
  schemaVersion: 1
  method: 'scan-v1'
  decoder: string
  profile: ScanProfile
  parameters: {
    resize: number
    blurRadius: 1
    jpegQuality: number
    contrast: [dark: number, light: number]
  }
  ok: boolean
  score: number
  decoded?: string
  expected?: string
  tests: ScanTestResult[]
  durationMs?: number
  preparationMs?: number
}

interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
  colorSpace: 'srgb'
}

const PROFILE = {
  screen: { resize: 0.60, jpegQuality: 70, dark: 48, light: 208 },
  print: { resize: 0.45, jpegQuality: 55, dark: 72, light: 184 },
} as const

const FAST_READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
  isPure: true,
  binarizer: 'FixedThreshold' as const,
  textMode: 'Plain' as const,
}

const FALLBACK_READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
  isPure: false,
  binarizer: 'LocalAverage' as const,
  textMode: 'Plain' as const,
}

let scannerPromise: Promise<void> | undefined

async function initializeScanner(): Promise<void> {
  const wasmURL = new URL(import.meta.resolve('zxing-wasm/reader/zxing_reader.wasm'))
  const wasmBinary = await readFile(wasmURL)
  await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true })
}

function ensureScanner(): Promise<void> {
  scannerPromise ??= initializeScanner().catch((error) => {
    scannerPromise = undefined
    throw error
  })
  return scannerPromise
}

function validatePNG(bytes: Uint8Array): { width: number, height: number } {
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw new RangeError('PNG input exceeds the 32 MiB safety limit')
  if (bytes.byteLength < 24 || !hasPngSignature(bytes))
    throw new TypeError('scan-v1 currently accepts PNG files only')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000)
    throw new RangeError(`PNG dimensions ${width}x${height} exceed scanner safety limits`)
  return { width, height }
}

function toRaster(bytes: Uint8Array): Raster {
  const dimensions = validatePNG(bytes)
  const decoded = decodePNG(bytes, { checkCrc: true })
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height)
    throw new Error('PNG dimensions changed while decoding')

  const pixels = decoded.width * decoded.height
  const source = decoded.palette ? convertIndexedToRgb(decoded) : decoded.data
  const depth = decoded.palette ? 8 : decoded.depth
  const channels = decoded.palette ? source.length / pixels : decoded.channels
  if (!Number.isInteger(channels) || channels < 1 || channels > 4)
    throw new TypeError(`Unsupported PNG channel count: ${channels}`)

  const output = new Uint8ClampedArray(pixels * 4)
  const sample = (index: number) => depth === 16 ? source[index] >>> 8 : source[index]
  for (let pixel = 0; pixel < pixels; pixel++) {
    const sourceOffset = pixel * channels
    const outputOffset = pixel * 4
    const alpha = channels === 2 || channels === 4 ? sample(sourceOffset + channels - 1) : 255
    const red = sample(sourceOffset)
    const green = channels < 3 ? red : sample(sourceOffset + 1)
    const blue = channels < 3 ? red : sample(sourceOffset + 2)
    output[outputOffset] = (red * alpha + 255 * (255 - alpha) + 127) / 255
    output[outputOffset + 1] = (green * alpha + 255 * (255 - alpha) + 127) / 255
    output[outputOffset + 2] = (blue * alpha + 255 * (255 - alpha) + 127) / 255
    output[outputOffset + 3] = 255
  }
  return { ...dimensions, data: output, colorSpace: 'srgb' }
}

function grayscale(input: Raster): Raster {
  const data = new Uint8ClampedArray(input.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = (306 * input.data[offset]
      + 601 * input.data[offset + 1]
      + 117 * input.data[offset + 2]
      + 512) >>> 10
    data[offset] = data[offset + 1] = data[offset + 2] = value
    data[offset + 3] = 255
  }
  return { width: input.width, height: input.height, data, colorSpace: 'srgb' }
}

function resize(input: Raster, factor: number): Raster {
  const width = Math.max(32, Math.round(input.width * factor))
  const height = Math.max(32, Math.round(input.height * factor))
  const data = new Uint8ClampedArray(width * height * 4)
  const xScale = input.width / width
  const yScale = input.height / height

  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(0, Math.min(input.height - 1, (y + 0.5) * yScale - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(y0 + 1, input.height - 1)
    const fy = sourceY - y0
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(0, Math.min(input.width - 1, (x + 0.5) * xScale - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(x0 + 1, input.width - 1)
      const fx = sourceX - x0
      const top = input.data[(y0 * input.width + x0) * 4] * (1 - fx)
        + input.data[(y0 * input.width + x1) * 4] * fx
      const bottom = input.data[(y1 * input.width + x0) * 4] * (1 - fx)
        + input.data[(y1 * input.width + x1) * 4] * fx
      const value = top * (1 - fy) + bottom * fy
      const offset = (y * width + x) * 4
      data[offset] = data[offset + 1] = data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return { width, height, data, colorSpace: 'srgb' }
}

function blur(input: Raster): Raster {
  const pixels = input.width * input.height
  const horizontal = new Uint16Array(pixels)
  const data = new Uint8ClampedArray(pixels * 4)

  for (let y = 0; y < input.height; y++) {
    const row = y * input.width
    for (let x = 0; x < input.width; x++) {
      const left = input.data[(row + Math.max(0, x - 1)) * 4]
      const middle = input.data[(row + x) * 4]
      const right = input.data[(row + Math.min(input.width - 1, x + 1)) * 4]
      horizontal[row + x] = (left + middle + right + 1) / 3
    }
  }

  for (let y = 0; y < input.height; y++) {
    const top = Math.max(0, y - 1) * input.width
    const middle = y * input.width
    const bottom = Math.min(input.height - 1, y + 1) * input.width
    for (let x = 0; x < input.width; x++) {
      const value = (horizontal[top + x] + horizontal[middle + x] + horizontal[bottom + x] + 1) / 3
      const offset = (middle + x) * 4
      data[offset] = data[offset + 1] = data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return { width: input.width, height: input.height, data, colorSpace: 'srgb' }
}

function lowContrast(input: Raster, dark: number, light: number): Raster {
  const data = new Uint8ClampedArray(input.data.length)
  const range = light - dark
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = dark + input.data[offset] * range / 255
    data[offset] = data[offset + 1] = data[offset + 2] = value
    data[offset + 3] = 255
  }
  return { width: input.width, height: input.height, data, colorSpace: 'srgb' }
}

async function decodeOne(input: Uint8Array | Raster): Promise<string | undefined> {
  let results = await readBarcodes(input, FAST_READER_OPTIONS)
  let result = results.find(item => item.format === 'QRCode' && !item.error)
  if (!result) {
    results = await readBarcodes(input, FALLBACK_READER_OPTIONS)
    result = results.find(item => item.format === 'QRCode' && !item.error)
  }
  return result?.text
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Decode an exact PNG and deterministic degraded variants with an independent reader. */
export async function scanPNG(bytes: Uint8Array, options: ScanOptions = {}): Promise<ScanReport> {
  const profile = options.profile ?? 'screen'
  const configuration = PROFILE[profile]
  if (!configuration)
    throw new RangeError('profile must be screen or print')

  const started = performance.now()
  const preparationStarted = performance.now()
  const ready = ensureScanner()
  const raster = grayscale(toRaster(bytes))
  await ready
  const preparationMs = performance.now() - preparationStarted

  const cases: Array<[
    ScanTestResult['name'],
    () => Uint8Array | Raster,
  ]> = [
    ['original', () => bytes],
    ['resize', () => resize(raster, configuration.resize)],
    ['blur', () => blur(raster)],
    ['compression', () => encodeJPEG(raster, configuration.jpegQuality).data],
    ['lowContrast', () => lowContrast(raster, configuration.dark, configuration.light)],
  ]

  let reference = options.expected
  let originalDecoded: string | undefined
  const tests: ScanTestResult[] = []
  for (const [name, createInput] of cases) {
    const testStarted = performance.now()
    const decoded = await decodeOne(createInput())
    if (name === 'original') {
      originalDecoded = decoded
      reference ??= decoded
    }
    const passed = decoded !== undefined && reference !== undefined && decoded === reference
    tests.push({
      name,
      passed,
      ...(decoded === undefined ? {} : { decoded }),
      ...(options.timings ? { durationMs: rounded(performance.now() - testStarted) } : {}),
    })
  }

  const passed = tests.filter(test => test.passed).length
  const report: ScanReport = {
    schemaVersion: 1,
    method: 'scan-v1',
    decoder: `zxing-wasm/${ZXING_WASM_VERSION}`,
    profile,
    parameters: {
      resize: configuration.resize,
      blurRadius: 1,
      jpegQuality: configuration.jpegQuality,
      contrast: [configuration.dark, configuration.light],
    },
    ok: passed === tests.length,
    score: Math.round(passed / tests.length * 100),
    ...(originalDecoded === undefined ? {} : { decoded: originalDecoded }),
    ...(options.expected === undefined ? {} : { expected: options.expected }),
    tests,
  }
  if (options.timings) {
    report.preparationMs = rounded(preparationMs)
    report.durationMs = rounded(performance.now() - started)
  }
  return report
}
