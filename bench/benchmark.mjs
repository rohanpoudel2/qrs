import { performance } from 'node:perf_hooks'
import { createQR } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'
import { frameAt } from '../dist/rotate.js'

function measure(iterations, operation) {
  for (let i = 0; i < Math.min(iterations, 25); i++) operation()
  const started = performance.now()
  for (let i = 0; i < iterations; i++) operation()
  return (performance.now() - started) / iterations
}

function result(operation, iterations, milliseconds) {
  return {
    operation,
    iterations,
    milliseconds: Math.round(milliseconds * 1_000_000) / 1_000_000,
  }
}

const samples = [
  { name: 'small', payload: 'hello', iterations: 20_000 },
  { name: 'medium', payload: 'https://example.com/order/123456789', iterations: 10_000 },
  { name: 'mixed', payload: `abc${'1'.repeat(40)}`, iterations: 5_000 },
  { name: 'large', payload: 'x'.repeat(768), iterations: 500 },
]
const rows = []
for (const sample of samples) {
  const code = createQR(sample.payload)
  rows.push(result(
    `createQR (${sample.name})`,
    sample.iterations,
    measure(sample.iterations, () => createQR(sample.payload)),
  ))
  const renderIterations = Math.min(sample.iterations, 2_000)
  rows.push(result(
    `renderPNG (${sample.name})`,
    renderIterations,
    measure(renderIterations, () => renderPNG(code)),
  ))
}

const medium = samples[1]
const png = renderPNG(createQR(medium.payload))
const cold = await scanPNG(png, { expected: medium.payload, timings: true })
const warm = await scanPNG(png, { expected: medium.payload, timings: true })
rows.push(result('scan screen (cold)', 1, cold.durationMs))
rows.push(result('scan screen (warm)', 1, warm.durationMs))
const frameStarted = performance.now()
const frameIterations = 2_000
for (let i = 0; i < frameIterations; i++)
  await frameAt({ token: () => medium.payload, output: 'png' }, 60_000)
rows.push(result('rotating PNG frame', frameIterations, (performance.now() - frameStarted) / frameIterations))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    unit: 'milliseconds/op',
    results: rows,
    artifacts: { mediumPngBytes: png.length },
  }))
}
else {
  console.table(rows)
  console.log(`PNG bytes: ${png.length}`)
}
