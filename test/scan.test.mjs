import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { createQR } from '../dist/index.js'
import { renderPNG } from '../dist/png.js'
import { scanPNG } from '../dist/scan.js'

const payload = 'https://example.com/order/123456789'
const exec = promisify(execFile)

function cliWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk)
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk)
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout)))
    child.stdin.end(input)
  })
}

test('PNG renderer is deterministic, indexed, and pixel-aligned', () => {
  const code = createQR(payload)
  const first = renderPNG(code)
  const second = renderPNG(code)
  assert.deepEqual(first, second)
  assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength)
  assert.equal(view.getUint32(16), code.size * 8)
  assert.equal(first[24], 1, 'PNG must use one bit per pixel')
  assert.equal(first[25], 3, 'PNG must use indexed color')
  assert.throws(() => renderPNG(code, { size: 320 }), /multiple/)
})

test('independent scanner passes deterministic screen and print profiles', async () => {
  const png = renderPNG(createQR(payload))
  let screen
  for (const profile of ['screen', 'print']) {
    const report = await scanPNG(png, { profile, expected: payload })
    if (profile === 'screen') screen = report
    assert.equal(report.method, 'scan-v1')
    assert.match(report.decoder, /^zxing-wasm\//)
    assert.equal(report.ok, true)
    assert.equal(report.score, 100)
    assert.equal(report.tests.length, 5)
    assert.ok(report.tests.every(result => result.passed))
  }
  assert.deepEqual(await scanPNG(png, { profile: 'screen', expected: payload }), screen)

  const mismatch = await scanPNG(png, { expected: 'https://wrong.example' })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.score, 0)
})

test('CLI generates and checks the exact PNG artifact', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'qrs-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'code.png')
  const generated = JSON.parse((await exec(process.execPath, [
    'dist/cli.js', 'generate', payload, '--format', 'png', '--output', path, '--check', '--json',
  ])).stdout)
  assert.equal(generated.scan.ok, true)
  assert.equal((await readFile(path)).subarray(1, 4).toString(), 'PNG')

  const checked = JSON.parse((await exec(process.execPath, [
    'dist/cli.js', 'check', path, '--profile', 'print', '--expected', payload, '--json',
  ])).stdout)
  assert.equal(checked.scan.ok, true)
  assert.equal(checked.scan.decoded, payload)

  const piped = await cliWithInput(['check', '--stdin', '--json'], await readFile(path))
  assert.equal(piped.artifact, 'stdin')
  assert.equal(piped.scan.ok, true)

  const manifest = join(directory, 'checks.jsonl')
  await writeFile(manifest, [
    JSON.stringify({ path: 'code.png', profile: 'screen', expected: payload }),
    JSON.stringify({ path: 'code.png', profile: 'print', expected: payload }),
  ].join('\n'))
  const batch = (await exec(process.execPath, ['dist/cli.js', 'batch', manifest])).stdout
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.equal(batch.length, 2)
  assert.ok(batch.every(result => result.ok))
})
