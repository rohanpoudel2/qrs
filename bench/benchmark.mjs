import { performance } from 'node:perf_hooks'
import { createQR } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'

function measure(iterations, operation) {
  for (let i = 0; i < Math.min(iterations, 25); i++) operation()
  const started = performance.now()
  for (let i = 0; i < iterations; i++) operation()
  return (performance.now() - started) / iterations
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
  rows.push({
    operation: `createQR (${sample.name})`,
    milliseconds: measure(sample.iterations, () => createQR(sample.payload)),
  })
  rows.push({
    operation: `renderPNG (${sample.name})`,
    milliseconds: measure(Math.min(sample.iterations, 2_000), () => renderPNG(code)),
  })
}

const medium = samples[1]
const png = renderPNG(createQR(medium.payload))
const cold = await scanPNG(png, { expected: medium.payload, timings: true })
const warm = await scanPNG(png, { expected: medium.payload, timings: true })
rows.push({ operation: 'scan screen (cold)', milliseconds: cold.durationMs })
rows.push({ operation: 'scan screen (warm)', milliseconds: warm.durationMs })

console.table(rows)
console.log(`PNG bytes: ${png.length}`)
