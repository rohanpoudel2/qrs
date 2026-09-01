import {
  _ALPHANUMERIC,
  _BYTES,
  _ECC_BLOCKS,
  _GF256,
  _tests,
  _WORDS_PER_BLOCK,
} from 'qr'
import type { EncodingType, ErrorCorrection } from 'qr'

export type SegmentMode = EncodingType

export interface SegmentMetadata {
  mode: SegmentMode
  characters: number
  bytes: number
  bits: number
}

export interface OptimizedSymbol {
  matrix: boolean[][]
  version: number
  segments: SegmentMetadata[]
  dataBits: number
  savedBits: number
}

interface PlannedSegment extends SegmentMetadata {
  text: string
}

interface Plan {
  segments: PlannedSegment[]
  bits: number
  singleBits: number
}

const MODES: SegmentMode[] = ['numeric', 'numeric', 'numeric', 'alphanumeric', 'alphanumeric', 'byte']
const MODE_BITS: Record<SegmentMode, number> = { numeric: 1, alphanumeric: 2, byte: 4 }
const LENGTH_BITS: Record<SegmentMode, number[]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
}
const ALNUM = /* @__PURE__ */ (() => {
  const values = new Int8Array(128).fill(-1)
  for (let i = 0; i < _ALPHANUMERIC.length; i++) values[_ALPHANUMERIC.charCodeAt(i)] = i
  return values
})()
const ENCODER = new TextEncoder()

function group(version: number): number {
  return Math.floor((version + 7) / 17)
}

function capacity(version: number, ecc: ErrorCorrection): number {
  return (_BYTES[version - 1]
    - _WORDS_PER_BLOCK[ecc][version - 1] * _ECC_BLOCKS[ecc][version - 1]) * 8
}

function utf8Length(char: string): number {
  const point = char.codePointAt(0)!
  return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
}

function canEncode(mode: SegmentMode, char: string): boolean {
  if (mode === 'byte') return true
  if (char.length !== 1 || char.charCodeAt(0) >= 128) return false
  const value = ALNUM[char.charCodeAt(0)]
  return mode === 'numeric' ? value >= 0 && value <= 9 : value >= 0
}

function stateFor(mode: SegmentMode, count: number): number {
  if (mode === 'numeric') return count % 3
  if (mode === 'alphanumeric') return 3 + count % 2
  return 5
}

function payloadIncrement(mode: SegmentMode, count: number, units: number): number {
  if (mode === 'numeric') return count % 3 === 0 ? 4 : 3
  if (mode === 'alphanumeric') return count % 2 === 0 ? 6 : 5
  return units * 8
}

function payloadBits(mode: SegmentMode, characters: number, bytes: number): number {
  if (mode === 'numeric') return Math.floor(characters / 3) * 10 + [0, 4, 7][characters % 3]
  if (mode === 'alphanumeric') return Math.floor(characters / 2) * 11 + (characters % 2) * 6
  return bytes * 8
}

function makeSegment(mode: SegmentMode, chars: string[], start: number, end: number, versionGroup: number): PlannedSegment {
  const text = chars.slice(start, end).join('')
  const characters = end - start
  let bytes = characters
  if (mode === 'byte') {
    bytes = 0
    for (let i = start; i < end; i++) bytes += utf8Length(chars[i])
  }
  return {
    mode,
    text,
    characters,
    bytes,
    bits: 4 + LENGTH_BITS[mode][versionGroup] + payloadBits(mode, characters, bytes),
  }
}

function singleModeBits(chars: string[], versionGroup: number): number {
  const mode: SegmentMode = chars.every(char => canEncode('numeric', char))
    ? 'numeric'
    : chars.every(char => canEncode('alphanumeric', char))
      ? 'alphanumeric'
      : 'byte'
  const limit = (1 << LENGTH_BITS[mode][versionGroup]) - 1
  let bits = 0
  for (let start = 0; start < chars.length;) {
    let end = start
    let units = 0
    while (end < chars.length) {
      const next = mode === 'byte' ? utf8Length(chars[end]) : 1
      if (units + next > limit) break
      units += next
      end++
    }
    bits += makeSegment(mode, chars, start, end, versionGroup).bits
    start = end
  }
  return bits
}

function singleModePlan(mode: SegmentMode, chars: string[], versionGroup: number): Plan {
  const limit = (1 << LENGTH_BITS[mode][versionGroup]) - 1
  const segments: PlannedSegment[] = []
  for (let start = 0; start < chars.length;) {
    let end = start
    let units = 0
    while (end < chars.length) {
      const next = mode === 'byte' ? utf8Length(chars[end]) : 1
      if (units + next > limit) break
      units += next
      end++
    }
    segments.push(makeSegment(mode, chars, start, end, versionGroup))
    start = end
  }
  const bits = segments.reduce((sum, segment) => sum + segment.bits, 0)
  return { segments, bits, singleBits: bits }
}

function hasRun(chars: string[], mode: SegmentMode, minimum: number): boolean {
  let length = 0
  for (const char of chars) {
    length = canEncode(mode, char) ? length + 1 : 0
    if (length >= minimum) return true
  }
  return false
}

export function shouldOptimize(text: string): boolean {
  let allNumeric = true
  let allAlphanumeric = true
  let numericRun = 0
  let alphanumericRun = 0
  let maxNumeric = 0
  let maxAlphanumeric = 0
  for (const char of text) {
    const numeric = canEncode('numeric', char)
    const alphanumeric = canEncode('alphanumeric', char)
    allNumeric &&= numeric
    allAlphanumeric &&= alphanumeric
    numericRun = numeric ? numericRun + 1 : 0
    alphanumericRun = alphanumeric ? alphanumericRun + 1 : 0
    maxNumeric = Math.max(maxNumeric, numericRun)
    maxAlphanumeric = Math.max(maxAlphanumeric, alphanumericRun)
  }
  if (allNumeric) return false
  if (allAlphanumeric) return maxNumeric >= 6
  return maxNumeric >= 3 || maxAlphanumeric >= 5
}

export function mightReduceVersion(text: string, ecc: ErrorCorrection, version: number): boolean {
  if (version <= 1) return false
  const previous = version - 1
  const versionGroup = group(previous)
  let optimisticBits = 4 + Math.min(
    LENGTH_BITS.numeric[versionGroup],
    LENGTH_BITS.alphanumeric[versionGroup],
    LENGTH_BITS.byte[versionGroup],
  )
  for (const char of text) {
    optimisticBits += canEncode('numeric', char)
      ? 3
      : canEncode('alphanumeric', char)
        ? 5
        : utf8Length(char) * 8
  }
  return optimisticBits <= capacity(previous, ecc)
}

export function describeSingle(text: string, version: number): { segment: SegmentMetadata, bits: number } {
  let numeric = true
  let alphanumeric = true
  let characters = 0
  let bytes = 0
  for (const char of text) {
    numeric &&= canEncode('numeric', char)
    alphanumeric &&= canEncode('alphanumeric', char)
    characters++
    bytes += utf8Length(char)
  }
  const mode: SegmentMode = numeric ? 'numeric' : alphanumeric ? 'alphanumeric' : 'byte'
  if (mode !== 'byte') bytes = characters
  const bits = 4 + LENGTH_BITS[mode][group(version)] + payloadBits(mode, characters, bytes)
  return { segment: { mode, characters, bytes, bits }, bits }
}

export function singleFits(text: string, ecc: ErrorCorrection, version = 40): boolean {
  const { segment, bits } = describeSingle(text, version)
  const count = segment.mode === 'byte' ? segment.bytes : segment.characters
  return count < 1 << LENGTH_BITS[segment.mode][group(version)] && bits <= capacity(version, ecc)
}

/** Exact shortest-path segmentation for one QR version group in O(code points). */
function plan(text: string, versionGroup: number): Plan {
  const chars = [...text]
  if (chars.length === 0) return { segments: [], bits: 0, singleBits: 0 }

  if (chars.every(char => canEncode('numeric', char)))
    return singleModePlan('numeric', chars, versionGroup)
  if (chars.every(char => canEncode('alphanumeric', char)) && !hasRun(chars, 'numeric', 6))
    return singleModePlan('alphanumeric', chars, versionGroup)
  if (!hasRun(chars, 'numeric', 3) && !hasRun(chars, 'alphanumeric', 5))
    return singleModePlan('byte', chars, versionGroup)

  const cells = (chars.length + 1) * MODES.length
  const costs = new Float64Array(cells).fill(Number.POSITIVE_INFINITY)
  const counts = new Uint32Array(cells)
  const segmentCounts = new Uint16Array(cells)
  const parents = new Int8Array(cells).fill(-2)
  const started = new Uint8Array(cells)

  const offer = (
    position: number,
    state: number,
    cost: number,
    count: number,
    segments: number,
    parent: number,
    starts: boolean,
  ) => {
    const cell = position * MODES.length + state
    if (cost < costs[cell] || (cost === costs[cell] && segments < segmentCounts[cell])) {
      costs[cell] = cost
      counts[cell] = count
      segmentCounts[cell] = segments
      parents[cell] = parent
      started[cell] = starts ? 1 : 0
    }
  }

  for (let position = 0; position < chars.length; position++) {
    const char = chars[position]
    const possibleModes: SegmentMode[] = ['numeric', 'alphanumeric', 'byte']
    const modes = possibleModes.filter(mode => canEncode(mode, char))
    if (position === 0) {
      for (const mode of modes) {
        const units = mode === 'byte' ? utf8Length(char) : 1
        offer(1, stateFor(mode, units), 4 + LENGTH_BITS[mode][versionGroup] + payloadIncrement(mode, 0, units), units, 1, -1, true)
      }
      continue
    }

    for (let parent = 0; parent < MODES.length; parent++) {
      const parentCell = position * MODES.length + parent
      const parentCost = costs[parentCell]
      if (!Number.isFinite(parentCost)) continue
      const parentMode = MODES[parent]
      const parentCount = counts[parentCell]
      const parentSegments = segmentCounts[parentCell]

      if (canEncode(parentMode, char)) {
        const units = parentMode === 'byte' ? utf8Length(char) : 1
        const limit = (1 << LENGTH_BITS[parentMode][versionGroup]) - 1
        if (parentCount + units <= limit) {
          offer(
            position + 1,
            stateFor(parentMode, parentCount + units),
            parentCost + payloadIncrement(parentMode, parentCount, units),
            parentCount + units,
            parentSegments,
            parent,
            false,
          )
        }
        else {
          offer(
            position + 1,
            stateFor(parentMode, units),
            parentCost + 4 + LENGTH_BITS[parentMode][versionGroup] + payloadIncrement(parentMode, 0, units),
            units,
            parentSegments + 1,
            parent,
            true,
          )
        }
      }

      for (const mode of modes) {
        if (mode === parentMode) continue
        const units = mode === 'byte' ? utf8Length(char) : 1
        offer(
          position + 1,
          stateFor(mode, units),
          parentCost + 4 + LENGTH_BITS[mode][versionGroup] + payloadIncrement(mode, 0, units),
          units,
          parentSegments + 1,
          parent,
          true,
        )
      }
    }
  }

  let state = 0
  const endOffset = chars.length * MODES.length
  for (let candidate = 1; candidate < MODES.length; candidate++) {
    const cell = endOffset + candidate
    const best = endOffset + state
    if (costs[cell] < costs[best]
      || (costs[cell] === costs[best] && segmentCounts[cell] < segmentCounts[best])) state = candidate
  }

  const modes = new Array<SegmentMode>(chars.length)
  const starts = new Uint8Array(chars.length)
  for (let position = chars.length; position > 0; position--) {
    const cell = position * MODES.length + state
    modes[position - 1] = MODES[state]
    starts[position - 1] = started[cell]
    state = parents[cell]
  }

  const segments: PlannedSegment[] = []
  for (let start = 0, end = 1; end <= chars.length; end++) {
    if (end < chars.length && !starts[end]) continue
    segments.push(makeSegment(modes[start], chars, start, end, versionGroup))
    start = end
  }
  const bits = segments.reduce((sum, segment) => sum + segment.bits, 0)
  return { segments, bits, singleBits: singleModeBits(chars, versionGroup) }
}

type RsCache = { generator: Uint8Array, multiplication: Uint8Array }
const RS_CACHE: Array<RsCache | undefined> = []

function reedSolomon(words: number): RsCache {
  let cached = RS_CACHE[words]
  if (cached) return cached
  const generator = new Uint8Array(words)
  generator[words - 1] = 1
  const { exp, log } = _GF256
  for (let i = 0, root = 1; i < words; i++) {
    for (let j = 0; j < words; j++) {
      const value = generator[j]
      generator[j] = (value ? exp[log[value] + log[root]] : 0) ^ (j + 1 < words ? generator[j + 1] : 0)
    }
    root = exp[log[root] + 1]
  }
  const multiplication = new Uint8Array(256 * words)
  for (let factor = 1; factor < 256; factor++) {
    const factorLog = log[factor]
    const offset = factor * words
    for (let j = 0; j < words; j++) {
      const value = generator[j]
      if (value) multiplication[offset + j] = exp[log[value] + factorLog]
    }
  }
  cached = { generator, multiplication }
  RS_CACHE[words] = cached
  return cached
}

function encodeSegments(segments: PlannedSegment[], version: number, ecc: ErrorCorrection): Uint8Array {
  const capacityBits = capacity(version, ecc)
  const data = new Uint8Array(capacityBits >>> 3)
  let accumulator = 0
  let accumulatorBits = 0
  let bytePosition = 0
  const push = (value: number, length: number) => {
    accumulator = (accumulator << length) | value
    for (accumulatorBits += length; accumulatorBits >= 8;)
      data[bytePosition++] = accumulator >>> (accumulatorBits -= 8) & 0xFF
  }

  const versionGroup = group(version)
  for (const segment of segments) {
    const count = segment.mode === 'byte' ? segment.bytes : segment.characters
    push(MODE_BITS[segment.mode], 4)
    push(count, LENGTH_BITS[segment.mode][versionGroup])
    if (segment.mode === 'numeric') {
      for (let i = 0; i < segment.text.length; i += 3) {
        const length = Math.min(3, segment.text.length - i)
        push(Number(segment.text.slice(i, i + length)), [0, 4, 7, 10][length])
      }
    }
    else if (segment.mode === 'alphanumeric') {
      for (let i = 0; i + 1 < segment.text.length; i += 2)
        push(ALNUM[segment.text.charCodeAt(i)] * 45 + ALNUM[segment.text.charCodeAt(i + 1)], 11)
      if (segment.text.length & 1) push(ALNUM[segment.text.charCodeAt(segment.text.length - 1)], 6)
    }
    else {
      const bytes = ENCODER.encode(segment.text)
      for (const byte of bytes) push(byte, 8)
    }
  }

  let bitPosition = bytePosition * 8 + accumulatorBits
  if (bitPosition > capacityBits) throw new RangeError('Capacity overflow')
  if (accumulatorBits) data[bytePosition] = accumulator << (8 - accumulatorBits) & 0xFF
  bitPosition += Math.min(4, capacityBits - bitPosition)
  if (bitPosition & 7) bitPosition += 8 - (bitPosition & 7)
  for (let i = bitPosition >>> 3, pad = 0; i < data.length; i++, pad ^= 1)
    data[i] = pad ? 0x11 : 0xEC

  const words = _WORDS_PER_BLOCK[ecc][version - 1]
  const numberOfBlocks = _ECC_BLOCKS[ecc][version - 1]
  const blockLength = Math.floor(_BYTES[version - 1] / numberOfBlocks) - words
  const shortBlocks = numberOfBlocks - _BYTES[version - 1] % numberOfBlocks
  const rs = reedSolomon(words)
  const blocks: Uint8Array[] = []
  const corrections: Uint8Array[] = []
  for (let block = 0, position = 0; block < numberOfBlocks; block++) {
    const length = blockLength + (block < shortBlocks ? 0 : 1)
    blocks.push(data.subarray(position, position + length))
    corrections.push(_tests.rsEcc(blocks[block], rs.generator, rs.multiplication))
    position += length
  }

  const output = new Uint8Array(data.length + words * numberOfBlocks)
  let outputPosition = 0
  for (let index = 0; index <= blockLength; index++)
    for (const block of blocks) if (index < block.length) output[outputPosition++] = block[index]
  for (let index = 0; index < words; index++)
    for (const correction of corrections) output[outputPosition++] = correction[index]
  return output
}

function toMatrix(version: number, ecc: ErrorCorrection, data: Uint8Array, mask?: number): boolean[][] {
  const symbol = _tests.drawSymbol(version, ecc, data, mask)
  return Array.from({ length: symbol.size }, (_, y) =>
    Array.from({ length: symbol.size }, (_, x) => _tests.matGet(symbol, x, y) === 1),
  )
}

export function encodeOptimized(text: string, ecc: ErrorCorrection, forcedVersion?: number, mask?: number): OptimizedSymbol {
  let selectedPlan: Plan | undefined
  let version = forcedVersion
  if (version !== undefined) {
    selectedPlan = plan(text, group(version))
    if (selectedPlan.bits > capacity(version, ecc)) throw new RangeError('Capacity overflow')
  }
  else {
    for (let versionGroup = 0; versionGroup < 3 && version === undefined; versionGroup++) {
      const candidate = plan(text, versionGroup)
      const start = versionGroup === 0 ? 1 : versionGroup === 1 ? 10 : 27
      const end = versionGroup === 0 ? 9 : versionGroup === 1 ? 26 : 40
      for (let candidateVersion = start; candidateVersion <= end; candidateVersion++) {
        if (candidate.bits <= capacity(candidateVersion, ecc)) {
          selectedPlan = candidate
          version = candidateVersion
          break
        }
      }
    }
  }
  if (!selectedPlan || version === undefined) throw new RangeError('Capacity overflow')

  const data = selectedPlan.segments.length === 1
    ? _tests.encodeData(
        version,
        ecc,
        selectedPlan.segments[0].text,
        selectedPlan.segments[0].mode,
        selectedPlan.segments[0].mode === 'byte' ? ENCODER.encode(selectedPlan.segments[0].text) : undefined,
      )
    : encodeSegments(selectedPlan.segments, version, ecc)
  return {
    matrix: toMatrix(version, ecc, data, mask),
    version,
    segments: selectedPlan.segments.map(({ mode, characters, bytes, bits }) => ({ mode, characters, bytes, bits })),
    dataBits: selectedPlan.bits,
    savedBits: selectedPlan.singleBits - selectedPlan.bits,
  }
}
