import assert from 'node:assert/strict'
import { test } from 'node:test'
import QRCode from 'qrcode'
import { createQR } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'

const known = [
  ['ABCDE12345678?A1A', 1, ['alphanumeric', 'numeric', 'byte'], 126],
  [`abc${'1'.repeat(40)}`, 2, ['byte', 'numeric'], 184],
  [`hello${'1'.repeat(80)}`, 3, ['byte', 'numeric'], 333],
]

test('known mixed payloads use the smallest version and exact optimal bit count', () => {
  for (const [text, version, modes, bits] of known) {
    const code = createQR(text)
    assert.equal(code.version, version)
    assert.deepEqual(code.segments.map(segment => segment.mode), modes)
    assert.equal(code.dataBits, bits)
    assert.equal(code.segments.reduce((sum, segment) => sum + segment.bits, 0), bits)
    assert.ok(code.savedBits > 0)
  }
})

test('size optimization avoids planner work unless it lowers the QR version', () => {
  const text = 'https://example.com/order/123456789'
  const size = createQR(text)
  const bits = createQR(text, { optimize: 'bits' })
  const disabled = createQR(text, { optimize: false })
  assert.equal(size.version, disabled.version)
  assert.equal(size.savedBits, 0)
  assert.ok(bits.savedBits > 0)
  assert.ok(bits.segments.length > 1)
  assert.throws(() => createQR(text, { optimize: 'fastest' }), /optimize/)

  const forcedText = `abc${'1'.repeat(40)}`
  assert.equal(createQR(forcedText, { version: 2, optimize: 'bits' }).version, 2)
  assert.throws(() => createQR(forcedText, { version: 2, optimize: false }), /Capacity/)
})

test('never selects a larger version than qrcode across a deterministic mixed corpus', () => {
  let seed = 0x51A7E
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32)
  const alphabets = ['lowercase', 'UPPERCASE', '0123456789', '-./:', 'é🙂']

  for (let sample = 0; sample < 250; sample++) {
    let text = ''
    const chunks = 2 + Math.floor(random() * 7)
    for (let chunk = 0; chunk < chunks; chunk++) {
      const characters = [...alphabets[Math.floor(random() * alphabets.length)]]
      const length = 1 + Math.floor(random() * 28)
      for (let i = 0; i < length; i++)
        text += characters[Math.floor(random() * characters.length)]
    }
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      const ours = createQR(text, { ecc }).version
      const reference = QRCode.create(text, { errorCorrectionLevel: ecc }).version
      assert.ok(ours <= reference, `version ${ours} > ${reference} at ${ecc} for ${JSON.stringify(text)}`)

      const optimized = createQR(text, { ecc, optimize: 'bits' })
      const referenceAtVersion = QRCode.create(text, {
        errorCorrectionLevel: ecc,
        version: optimized.version,
      })
      const versionGroup = Math.floor((optimized.version + 7) / 17)
      const referenceBits = referenceAtVersion.segments.reduce((sum, segment) =>
        sum + 4 + segment.mode.ccBits[versionGroup] + segment.getBitsLength(), 0)
      assert.ok(
        optimized.dataBits <= referenceBits,
        `${optimized.dataBits} bits > ${referenceBits} at ${ecc} for ${JSON.stringify(text)}`,
      )
    }
  }
})

test('independent reader decodes optimized payloads at every error-correction level', async () => {
  for (const text of [known[0][0], `é🙂${'1234567890'.repeat(6)}`]) {
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      const code = createQR(text, { ecc, optimize: 'bits' })
      assert.ok(code.segments.length > 1)
      const report = await scanPNG(renderPNG(code), { expected: text })
      assert.equal(report.ok, true)
      assert.equal(report.decoded, text)
    }
  }

  const long = `a${'1'.repeat(1500)}`
  const highVersion = createQR(long, { ecc: 'H' })
  assert.ok(highVersion.version >= 27)
  const report = await scanPNG(renderPNG(highVersion, { size: highVersion.size * 4 }), { expected: long })
  assert.equal(report.ok, true)
})
