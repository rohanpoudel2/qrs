import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { createQR } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'
import { frameAt } from '../dist/rotate.js'

test('performance guardrails catch algorithmic regressions', async () => {
  const payload = 'https://example.com/order/123456789'
  const code = createQR(payload)
  for (let i = 0; i < 10; i++) renderPNG(code)

  const iterations = 200
  const started = performance.now()
  let png
  for (let i = 0; i < iterations; i++) png = renderPNG(code)
  const averagePNG = (performance.now() - started) / iterations
  assert.ok(averagePNG < 2, `PNG rendering regressed to ${averagePNG.toFixed(3)} ms/op`)

  const mixed = `abc${'1'.repeat(40)}`
  const mixedStarted = performance.now()
  for (let i = 0; i < iterations; i++) createQR(mixed)
  const averageMixed = (performance.now() - mixedStarted) / iterations
  assert.ok(averageMixed < 1, `mixed segmentation regressed to ${averageMixed.toFixed(3)} ms/op`)

  const frameStarted = performance.now()
  for (let i = 0; i < iterations; i++) {
    await frameAt({ token: () => payload, output: 'png' }, 60_000)
  }
  const averageFrame = (performance.now() - frameStarted) / iterations
  assert.ok(averageFrame < 2, `rotating frame generation regressed to ${averageFrame.toFixed(3)} ms/op`)

  await scanPNG(png, { expected: payload })
  const warm = await scanPNG(png, { expected: payload, timings: true })
  // Shared CI runners are much noisier than local hardware; this is a 10x-class regression tripwire.
  assert.ok(warm.durationMs < 250, `warm scan profile regressed to ${warm.durationMs} ms`)
})
