import encodeQR from 'qr'
import type { QrOpts } from 'qr'
import { parseHexColor } from './color.js'
import { describeSingle, encodeOptimized, mightReduceVersion, shouldOptimize, singleFits } from './segments.js'
import type { SegmentMetadata } from './segments.js'

export type { SegmentMetadata, SegmentMode } from './segments.js'

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'
export type QRData = string | Uint8Array

export interface QROptions {
  /** Error correction. M is the safe default. */
  ecc?: ErrorCorrectionLevel
  /** Quiet zone in modules. Four is the QR Code standard. */
  border?: number
  /** Force a QR version from 1 to 40. */
  version?: number
  /** Force a mask from 0 to 7. */
  mask?: number
  /** Optimize for the smallest version (default), the shortest bitstream, or disable segmentation. */
  optimize?: 'size' | 'bits' | false
}

export interface QRCode {
  readonly matrix: ReadonlyArray<ReadonlyArray<boolean>>
  readonly version: number
  readonly ecc: ErrorCorrectionLevel
  readonly border: number
  readonly symbolSize: number
  readonly size: number
  readonly segments: ReadonlyArray<SegmentMetadata>
  readonly dataBits: number
  readonly savedBits: number
}

export interface SVGOptions {
  /** Output width and height in pixels. Defaults to eight pixels per module. */
  size?: number
  dark?: string
  light?: string
  title?: string
}

export type AuditSeverity = 'warning' | 'error'

export interface AuditIssue {
  code: string
  severity: AuditSeverity
  message: string
  suggestion: string
}

export interface AuditOptions {
  /** Intended raster or screen size in pixels. */
  size?: number
  dark?: string
  light?: string
}

export interface AuditReport {
  schemaVersion: 1
  method: 'static-v1'
  ok: boolean
  score: number
  issues: AuditIssue[]
  facts: {
    version: number
    ecc: ErrorCorrectionLevel
    border: number
    symbolModules: number
    totalModules: number
    targetSize: number
    modulePixels: number
    contrast: number
  }
}

const ECC: Record<ErrorCorrectionLevel, NonNullable<QrOpts['ecc']>> = {
  L: 'low',
  M: 'medium',
  Q: 'quartile',
  H: 'high',
}

function integer(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function stripEngineBorder(matrix: boolean[][]): boolean[][] {
  return matrix.slice(1, -1).map(row => row.slice(1, -1))
}

function addBorder(matrix: boolean[][], border: number): boolean[][] {
  if (border === 0)
    return matrix

  const size = matrix.length + border * 2
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      y >= border
      && y < size - border
      && x >= border
      && x < size - border
        ? matrix[y - border][x - border]
        : false,
    ),
  )
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
    || (ArrayBuffer.isView(value)
      && value.constructor.name === 'Uint8Array'
      && 'BYTES_PER_ELEMENT' in value
      && value.BYTES_PER_ELEMENT === 1)
}

/** Encode text or bytes once and reuse the result across renderers and audits. */
export function createQR(data: QRData, options: QROptions = {}): QRCode {
  const ecc = options.ecc ?? 'M'
  if (!(ecc in ECC))
    throw new RangeError(`ecc must be one of L, M, Q, H`)

  const border = integer('border', options.border ?? 4, 0, 64)
  const version = options.version === undefined
    ? undefined
    : integer('version', options.version, 1, 40)
  const mask = options.mask === undefined
    ? undefined
    : integer('mask', options.mask, 0, 7)
  const optimize = options.optimize ?? 'size'
  if (optimize !== 'size' && optimize !== 'bits' && optimize !== false)
    throw new RangeError('optimize must be size, bits, or false')

  const text = typeof data === 'string' ? data : ''
  const bytes = typeof data === 'string' ? undefined : data
  if (bytes !== undefined && !isBytes(bytes))
    throw new TypeError('data must be a string or Uint8Array')

  let symbol: boolean[][]
  let detectedVersion: number
  let segments: SegmentMetadata[]
  let dataBits: number
  let savedBits: number
  if (bytes === undefined) {
    const optimizable = optimize !== false && shouldOptimize(text)
    const forceOptimized = optimizable
      && (optimize === 'bits' || !singleFits(text, ECC[ecc], version))
    if (forceOptimized) {
      const optimized = encodeOptimized(text, ECC[ecc], version, mask)
      symbol = optimized.matrix
      detectedVersion = optimized.version
      segments = optimized.segments
      dataBits = optimized.dataBits
      savedBits = optimized.savedBits
    }
    else {
      const encoded = encodeQR(text, 'raw', {
        ecc: ECC[ecc],
        border: 1,
        scale: 1,
        version,
        mask,
      })
      symbol = stripEngineBorder(encoded)
      detectedVersion = (symbol.length - 17) / 4
      const described = describeSingle(text, detectedVersion)
      dataBits = described.bits
      segments = [described.segment]
      savedBits = 0

      if (optimizable && version === undefined && mightReduceVersion(text, ECC[ecc], detectedVersion)) {
        const optimized = encodeOptimized(text, ECC[ecc], version, mask)
        if (optimize === 'bits' || optimized.version < detectedVersion) {
          symbol = optimized.matrix
          detectedVersion = optimized.version
          segments = optimized.segments
          dataBits = optimized.dataBits
          savedBits = optimized.savedBits
        }
      }
    }
  }
  else {
    const engineOptions: QrOpts = {
      ecc: ECC[ecc],
      border: 1,
      scale: 1,
      version,
      mask,
      encoding: 'byte',
      textEncoder: () => bytes,
    }
    const encoded = encodeQR(text, 'raw', engineOptions)
    symbol = stripEngineBorder(encoded)
    detectedVersion = (symbol.length - 17) / 4
    const lengthBits = detectedVersion < 10 ? 8 : 16
    dataBits = 4 + lengthBits + bytes.length * 8
    segments = [{ mode: 'byte', characters: 0, bytes: bytes.length, bits: dataBits }]
    savedBits = 0
  }
  if (!Number.isInteger(detectedVersion) || detectedVersion < 1 || detectedVersion > 40)
    throw new Error(`Encoder returned an invalid ${symbol.length}x${symbol.length} symbol`)

  const matrix = addBorder(symbol, border)
  return {
    matrix,
    version: detectedVersion,
    ecc,
    border,
    symbolSize: symbol.length,
    size: matrix.length,
    segments,
    dataBits,
    savedBits,
  }
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Run deterministic checks that do not claim to be a real scanner test. */
export function auditQR(code: QRCode, options: AuditOptions = {}): AuditReport {
  const targetSize = options.size ?? code.size * 8
  if (!Number.isFinite(targetSize) || targetSize <= 0)
    throw new RangeError('size must be a positive number')

  const dark = options.dark ?? '#000000'
  const light = options.light ?? '#ffffff'
  const darkLuminance = luminance(parseHexColor(dark, 'dark'))
  const lightLuminance = luminance(parseHexColor(light, 'light'))
  const contrastRatio = (Math.max(darkLuminance, lightLuminance) + 0.05)
    / (Math.min(darkLuminance, lightLuminance) + 0.05)
  const modulePixels = targetSize / code.size
  const issues: AuditIssue[] = []
  let score = 100

  if (code.border < 4) {
    score -= 40
    issues.push({
      code: 'QUIET_ZONE_TOO_SMALL',
      severity: 'error',
      message: `Quiet zone is ${code.border} modules; QR Code requires four.`,
      suggestion: 'Set border to at least 4.',
    })
  }

  if (code.ecc === 'L') {
    score -= 10
    issues.push({
      code: 'LOW_ERROR_CORRECTION',
      severity: 'warning',
      message: 'Error correction L leaves little recovery headroom.',
      suggestion: 'Use M for ordinary codes and H when artwork obscures modules.',
    })
  }

  if (modulePixels < 2) {
    score -= 35
    issues.push({
      code: 'MODULES_TOO_SMALL',
      severity: 'error',
      message: `Modules are only ${modulePixels.toFixed(2)} pixels at the target size.`,
      suggestion: `Increase the target size to at least ${code.size * 2}px.`,
    })
  }
  else if (modulePixels < 4) {
    score -= 10
    issues.push({
      code: 'MODULES_SMALL',
      severity: 'warning',
      message: `Modules are ${modulePixels.toFixed(2)} pixels at the target size.`,
      suggestion: `Prefer at least ${code.size * 4}px for screen and raster output.`,
    })
  }

  if (!Number.isInteger(modulePixels)) {
    score -= 5
    issues.push({
      code: 'FRACTIONAL_MODULE_SIZE',
      severity: 'warning',
      message: 'The target size produces fractional module boundaries.',
      suggestion: `Use a multiple of ${code.size}px to avoid raster antialiasing.`,
    })
  }

  if (darkLuminance >= lightLuminance) {
    score -= 40
    issues.push({
      code: 'POLARITY_INVERTED',
      severity: 'error',
      message: 'The configured dark modules are not darker than the background.',
      suggestion: 'Use dark modules on a lighter background for broad scanner compatibility.',
    })
  }

  if (contrastRatio < 3) {
    score -= 40
    issues.push({
      code: 'CONTRAST_TOO_LOW',
      severity: 'error',
      message: `Foreground/background contrast is only ${contrastRatio.toFixed(2)}:1.`,
      suggestion: 'Use a much darker foreground and lighter background.',
    })
  }
  else if (contrastRatio < 4.5) {
    score -= 10
    issues.push({
      code: 'CONTRAST_LOW',
      severity: 'warning',
      message: `Foreground/background contrast is ${contrastRatio.toFixed(2)}:1.`,
      suggestion: 'Prefer at least 4.5:1 for more scanning headroom.',
    })
  }

  return {
    schemaVersion: 1,
    method: 'static-v1',
    ok: !issues.some(issue => issue.severity === 'error'),
    score: Math.max(0, score),
    issues,
    facts: {
      version: code.version,
      ecc: code.ecc,
      border: code.border,
      symbolModules: code.symbolSize,
      totalModules: code.size,
      targetSize,
      modulePixels,
      contrast: contrastRatio,
    },
  }
}

function escapeXML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Render an accessible, compact SVG without touching the DOM. */
export function renderSVG(code: QRCode, options: SVGOptions = {}): string {
  const size = integer('size', options.size ?? code.size * 8, 1, 16384)
  const dark = options.dark ?? '#000000'
  const light = options.light ?? '#ffffff'
  parseHexColor(dark, 'dark')
  parseHexColor(light, 'light')
  const title = options.title ?? 'QR code'

  let path = ''
  for (let y = 0; y < code.size; y++) {
    let x = 0
    while (x < code.size) {
      while (x < code.size && !code.matrix[y][x]) x++
      const start = x
      while (x < code.size && code.matrix[y][x]) x++
      if (x > start)
        path += `M${start} ${y}h${x - start}v1H${start}z`
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${code.size} ${code.size}" role="img" aria-label="${escapeXML(title)}" shape-rendering="crispEdges"><title>${escapeXML(title)}</title><rect width="100%" height="100%" fill="${light}"/><path fill="${dark}" d="${path}"/></svg>`
}

/** Render two module rows per terminal row with Unicode block characters. */
export function renderTerminal(code: QRCode): string {
  const lines: string[] = []
  for (let y = 0; y < code.size; y += 2) {
    let line = ''
    for (let x = 0; x < code.size; x++) {
      const top = code.matrix[y][x]
      const bottom = y + 1 < code.size && code.matrix[y + 1][x]
      line += top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ')
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export const capabilities = {
  schemaVersion: 1,
  inputs: ['text', 'bytes', 'stdin'] as const,
  outputs: ['svg', 'png', 'terminal', 'matrix'] as const,
  audits: ['quiet-zone', 'error-correction', 'module-size', 'contrast'] as const,
  scannerInputs: ['png'] as const,
  scanProfiles: ['screen', 'print'] as const,
  scannerRuntimes: ['node'] as const,
  encodingModes: ['numeric', 'alphanumeric', 'byte'] as const,
  optimization: ['size', 'bits', 'off'] as const,
  rotatingOutputs: ['svg', 'png'] as const,
  runtimes: ['browser', 'node', 'bun', 'deno', 'worker'] as const,
}
