import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditQR, createQR, renderSVG } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'

const ECC_LEVELS = ['L', 'M', 'Q', 'H']
const OPTIMIZATIONS = ['size', 'bits', false]
const TEXT_ALPHABETS = [
  [...'abcdefghijklmnopqrstuvwxyz'],
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'],
  [...'0123456789'],
  [...'éàøλ漢字🙂🚀'],
]

function randomGenerator(seed) {
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32)
}

function randomText(random, length) {
  const characters = []
  while (characters.length < length) {
    const alphabet = TEXT_ALPHABETS[Math.floor(random() * TEXT_ALPHABETS.length)]
    const run = 1 + Math.floor(random() * 24)
    for (let index = 0; index < run && characters.length < length; index++)
      characters.push(alphabet[Math.floor(random() * alphabet.length)])
  }
  return characters.join('')
}

test('seeded text and binary corpus stays deterministic under sustained generation', () => {
  const random = randomGenerator(0x51A7E55)

  for (let sample = 0; sample < 1_000; sample++) {
    const ecc = ECC_LEVELS[sample % ECC_LEVELS.length]
    const optimize = OPTIMIZATIONS[sample % OPTIMIZATIONS.length]
    const length = 1 + Math.floor(random() * 256)
    const data = sample % 5 === 0
      ? Uint8Array.from({ length }, () => Math.floor(random() * 256))
      : randomText(random, length)

    const first = createQR(data, { ecc, optimize })
    const second = createQR(data, { ecc, optimize })
    assert.equal(first.version, second.version)
    assert.deepEqual(first.matrix, second.matrix)
    assert.equal(first.dataBits, first.segments.reduce((sum, segment) => sum + segment.bits, 0))
    assert.equal(first.matrix.length, first.size)
    assert.ok(first.matrix.every(row => row.length === first.size))
    assert.equal(auditQR(first).ok, true)

    const png = renderPNG(first)
    assert.deepEqual(png, renderPNG(second))
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    if (sample % 100 === 0)
      assert.match(renderSVG(first), /^<svg[^>]+shape-rendering="crispEdges"/)
  }
})

test('every QR version and error-correction level renders with deterministic masks', () => {
  for (let version = 1; version <= 40; version++) {
    for (const [eccIndex, ecc] of ECC_LEVELS.entries()) {
      const mask = (version + eccIndex) % 8
      const payload = `v${version}-${ecc}`
      const code = createQR(payload, { version, ecc, mask, optimize: 'bits' })
      assert.equal(code.version, version)
      assert.equal(code.symbolSize, 17 + version * 4)
      assert.deepEqual(renderPNG(code), renderPNG(createQR(payload, {
        version,
        ecc,
        mask,
        optimize: 'bits',
      })))
    }
  }
})

test('independent scanner survives version-group boundaries and concurrent profiles', async () => {
  for (const version of [1, 9, 10, 26, 27, 40]) {
    const payload = `v${version}`
    const code = createQR(payload, { version, ecc: 'M', optimize: 'bits' })
    const report = await scanPNG(renderPNG(code, { size: code.size * 4 }), { expected: payload })
    assert.equal(report.ok, true, `scan profile failed at version ${version}`)
  }

  const payload = 'https://example.com/stress/1234567890'
  const png = renderPNG(createQR(payload, { ecc: 'H', optimize: 'bits' }))
  const reports = await Promise.all(Array.from({ length: 16 }, (_, index) =>
    scanPNG(png, {
      profile: index % 2 === 0 ? 'screen' : 'print',
      expected: payload,
    })))
  assert.ok(reports.every(report => report.ok && report.tests.every(result => result.passed)))
})

test('scanner rejects oversized dimensions before allocating a raster', async () => {
  const pngHeader = Uint8Array.of(
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 16, 1, 0, 0, 0, 1,
  )
  await assert.rejects(scanPNG(pngHeader), /exceed scanner safety limits/)
})
