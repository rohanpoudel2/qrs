import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { auditQR, createQR, renderSVG } from '../dist/index.js'

function cli(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk)
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk)
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

test('uses safe defaults and accepts binary data', () => {
  const text = createQR('hello')
  assert.equal(text.ecc, 'M')
  assert.equal(text.border, 4)
  assert.equal(text.size, text.symbolSize + 8)
  assert.equal(auditQR(text).ok, true)

  const binary = createQR(new Uint8Array([0, 1, 254, 255]))
  assert.ok(binary.version >= 1)
  assert.throws(() => createQR(new Uint16Array([1])), /string or Uint8Array/)
})

test('audit returns stable, actionable failures', () => {
  const report = auditQR(createQR('unsafe', { ecc: 'L', border: 1 }), {
    size: 40,
    dark: '#777',
    light: '#888',
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some(issue => issue.code === 'QUIET_ZONE_TOO_SMALL'))
  assert.ok(report.issues.some(issue => issue.code === 'CONTRAST_TOO_LOW'))
  assert.ok(report.issues.every(issue => issue.suggestion.length > 0))

  const inverted = auditQR(createQR('inverted'), { dark: '#fff', light: '#000' })
  assert.equal(inverted.ok, false)
  assert.ok(inverted.issues.some(issue => issue.code === 'POLARITY_INVERTED'))
})

test('SVG is accessible and escapes caller text', () => {
  const svg = renderSVG(createQR('hello'), { title: '<scan & go>' })
  assert.match(svg, /^<svg/)
  assert.match(svg, /role="img"/)
  assert.match(svg, /&lt;scan &amp; go&gt;/)
  assert.doesNotMatch(svg, /<scan/)
})

test('CLI accepts stdin and emits machine-readable output', async () => {
  const { code, stdout, stderr } = await cli([
    'generate',
    '--stdin',
    '--format',
    'svg',
    '--json',
  ], 'https://example.com')
  assert.equal(code, 0, stderr)
  const result = JSON.parse(stdout)
  assert.equal(result.ok, true)
  assert.equal(result.artifact.format, 'svg')
  assert.match(result.artifact.content, /^<svg/)
  assert.equal(result.audit.ok, true)
})

test('CLI keeps parser errors machine-readable', async () => {
  const { code, stdout } = await cli([
    'generate',
    'hello',
    '--not-an-option',
    '--json',
  ])
  assert.equal(code, 1)
  const result = JSON.parse(stdout)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'QRS_CLI_ERROR')
})
