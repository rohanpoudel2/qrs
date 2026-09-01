#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  auditQR,
  capabilities,
  createQR,
  renderSVG,
  renderTerminal,
} from './index.js'
import type { AuditReport, ErrorCorrectionLevel } from './index.js'

const HELP = `qrs — generate and check QR codes

Usage:
  qrs generate [data] [options]
  qrs audit [data] [options]
  qrs check <artifact.png> [options]
  qrs batch <manifest.jsonl> [options]
  qrs capabilities [--json]

Options:
  --stdin              Read data or a PNG artifact from stdin
  --input <file>       Read data from a UTF-8 file
  --output, -o <file>  Write generated output to a file
  --format <format>    svg, png, terminal, or matrix (default: svg)
  --ecc <level>        L, M, Q, or H (default: M)
  --border <modules>   Quiet zone modules (default: 4)
  --version <number>   Force QR version 1-40
  --mask <number>      Force mask 0-7
  --optimize <mode>    size, bits, or off (default: size)
  --size <pixels>      Intended output size
  --dark <hex>         Dark color (default: #000000)
  --light <hex>        Light color (default: #ffffff)
  --title <text>       Accessible SVG title
  --profile <profile>  screen or print (default: screen)
  --expected <text>    Require a checked PNG to decode to this exact text
  --check              Audit and scan generated PNG; exits 2 on failure
  --timings            Include millisecond measurements in scan reports
  --json               Emit a machine-readable envelope
  --pretty             Pretty-print JSON
  --help, -h           Show help
`

function parseCLI() {
  return parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      stdin: { type: 'boolean' },
      input: { type: 'string' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', default: 'svg' },
      ecc: { type: 'string', default: 'M' },
      border: { type: 'string', default: '4' },
      version: { type: 'string' },
      mask: { type: 'string' },
      optimize: { type: 'string', default: 'size' },
      size: { type: 'string' },
      dark: { type: 'string', default: '#000000' },
      light: { type: 'string', default: '#ffffff' },
      title: { type: 'string' },
      profile: { type: 'string', default: 'screen' },
      expected: { type: 'string' },
      check: { type: 'boolean' },
      timings: { type: 'boolean' },
      json: { type: 'boolean' },
      pretty: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
}

let parsed: ReturnType<typeof parseCLI>
try {
  parsed = parseCLI()
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (process.argv.includes('--json'))
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'QRS_CLI_ERROR', message } })}\n`)
  else
    process.stderr.write(`qrs: ${message}\n`)
  process.exit(1)
}

const { values, positionals } = parsed

function numberOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    throw new TypeError(`--${name} must be a number`)
  return parsed
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, values.pretty ? 2 : 0)}\n`
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

async function stdin(): Promise<string> {
  let data = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin)
    data += chunk
  return data.replace(/\r?\n$/, '')
}

async function stdinBytes(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function input(command: string): Promise<string> {
  if (values.input)
    return readFile(values.input, 'utf8')
  if (values.stdin || (!process.stdin.isTTY && positionals.length < 2))
    return stdin()
  const data = positionals[1]
  if (data === undefined)
    throw new TypeError(`${command} requires data, --input, or --stdin`)
  return data
}

function humanReport(report: AuditReport): string {
  const lines = [`${report.ok ? 'PASS' : 'FAIL'} ${report.score}/100 (${report.method})`]
  for (const issue of report.issues)
    lines.push(`${issue.severity.toUpperCase()} ${issue.code}: ${issue.message} ${issue.suggestion}`)
  return `${lines.join('\n')}\n`
}

function humanScanReport(report: { ok: boolean, score: number, method: string, profile: string, tests: Array<{ name: string, passed: boolean }> }): string {
  const lines = [`${report.ok ? 'PASS' : 'FAIL'} ${report.score}/100 (${report.method}, ${report.profile})`]
  for (const test of report.tests)
    lines.push(`${test.passed ? 'PASS' : 'FAIL'} ${test.name}`)
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP)
    return
  }

  const command = positionals[0]
  if (command === 'capabilities') {
    process.stdout.write(values.json ? json(capabilities) : `${capabilities.outputs.join(', ')}\n`)
    return
  }
  if (command !== 'generate' && command !== 'audit' && command !== 'check' && command !== 'batch')
    throw new TypeError(`Unknown command: ${command}`)

  if (command === 'batch') {
    const manifestPath = values.input ?? positionals[1]
    const fromStdin = values.stdin || (!process.stdin.isTTY && !manifestPath)
    if (!manifestPath && !fromStdin)
      throw new TypeError('batch requires a JSONL path, --input, or --stdin')
    const source = fromStdin ? await stdin() : await readFile(manifestPath as string, 'utf8')
    const base = fromStdin ? process.cwd() : dirname(resolve(manifestPath as string))
    const { scanPNG } = await import('./scan.js')
    let failed = false
    for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line) as { path?: unknown, profile?: unknown, expected?: unknown, timings?: unknown }
        if (!record || typeof record !== 'object' || typeof record.path !== 'string')
          throw new TypeError('record.path must be a string')
        const profile = record.profile ?? values.profile
        if (profile !== 'screen' && profile !== 'print')
          throw new TypeError('record.profile must be screen or print')
        if (record.expected !== undefined && typeof record.expected !== 'string')
          throw new TypeError('record.expected must be a string')
        const scan = await scanPNG(await readFile(resolve(base, record.path)), {
          profile,
          expected: record.expected,
          timings: record.timings === true || values.timings,
        })
        failed ||= !scan.ok
        process.stdout.write(jsonLine({ ok: scan.ok, index: lineIndex, artifact: record.path, scan }))
      }
      catch (error) {
        failed = true
        const message = error instanceof Error ? error.message : String(error)
        process.stdout.write(jsonLine({
          ok: false,
          index: lineIndex,
          error: { code: 'QRS_BATCH_ITEM_ERROR', message },
        }))
      }
    }
    if (failed) process.exitCode = 2
    return
  }

  if (command === 'check') {
    const path = values.input ?? positionals[1]
    const fromStdin = values.stdin || (!process.stdin.isTTY && !path)
    if (!path && !fromStdin)
      throw new TypeError('check requires a PNG path, --input, or --stdin')
    const bytes = fromStdin ? await stdinBytes() : await readFile(path as string)
    const artifact = fromStdin ? 'stdin' : path as string
    const { scanPNG } = await import('./scan.js')
    const scan = await scanPNG(bytes, {
      profile: values.profile as 'screen' | 'print',
      expected: values.expected,
      timings: values.timings,
    })
    process.stdout.write(values.json ? json({ ok: scan.ok, command, artifact, scan }) : humanScanReport(scan))
    if (!scan.ok) process.exitCode = 2
    return
  }

  const data = await input(command)
  const ecc = values.ecc?.toUpperCase() as ErrorCorrectionLevel
  const code = createQR(data, {
    ecc,
    border: numberOption('border', values.border),
    version: numberOption('version', values.version),
    mask: numberOption('mask', values.mask),
    optimize: values.optimize === 'off' ? false : values.optimize as 'size' | 'bits',
  })
  const size = numberOption('size', values.size)
  const audit = auditQR(code, { size, dark: values.dark, light: values.light })

  if (command === 'audit') {
    process.stdout.write(values.json ? json({ ok: audit.ok, command, audit }) : humanReport(audit))
    if (!audit.ok) process.exitCode = 2
    return
  }

  let content: string | Uint8Array
  if (values.format === 'svg') {
    content = renderSVG(code, {
      size,
      dark: values.dark,
      light: values.light,
      title: values.title,
    })
  }
  else if (values.format === 'png') {
    const { renderPNG } = await import('./png.js')
    content = renderPNG(code, { size, dark: values.dark, light: values.light })
  }
  else if (values.format === 'terminal') {
    content = `${renderTerminal(code)}\n`
  }
  else if (values.format === 'matrix') {
    content = json(code.matrix)
  }
  else {
    throw new TypeError('--format must be svg, png, terminal, or matrix')
  }

  if (values.check && values.format !== 'png')
    throw new TypeError('--check currently requires --format png')

  let scan
  if (values.check) {
    const scanner = await import('./scan.js')
    scan = await scanner.scanPNG(content as Uint8Array, {
      profile: values.profile as 'screen' | 'print',
      expected: data,
      timings: values.timings,
    })
  }

  if (values.output)
    await writeFile(values.output, content)

  if (values.json) {
    process.stdout.write(json({
      ok: !values.check || (audit.ok && scan?.ok === true),
      command,
      artifact: values.output
        ? { format: values.format, path: values.output }
        : typeof content === 'string'
          ? { format: values.format, content }
          : { format: values.format, encoding: 'base64', content: Buffer.from(content).toString('base64') },
      qr: {
        version: code.version,
        ecc: code.ecc,
        border: code.border,
        modules: code.size,
        segments: code.segments,
        dataBits: code.dataBits,
        savedBits: code.savedBits,
      },
      audit,
      ...(scan ? { scan } : {}),
    }))
  }
  else if (!values.output) {
    process.stdout.write(content)
  }
  else {
    process.stderr.write(`Wrote ${values.output}\n`)
  }

  if (values.check && (!audit.ok || !scan?.ok))
    process.exitCode = 2
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (values.json)
    process.stdout.write(json({ ok: false, error: { code: 'QRS_CLI_ERROR', message } }))
  else
    process.stderr.write(`qrs: ${message}\n`)
  process.exitCode = 1
})
