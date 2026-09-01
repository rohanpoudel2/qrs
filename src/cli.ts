#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
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
  qrs check [data] [options]
  qrs capabilities [--json]

Options:
  --stdin              Read data from stdin
  --input <file>       Read data from a UTF-8 file
  --output, -o <file>  Write generated output to a file
  --format <format>    svg, terminal, or matrix (default: svg)
  --ecc <level>        L, M, Q, or H (default: M)
  --border <modules>   Quiet zone modules (default: 4)
  --version <number>   Force QR version 1-40
  --mask <number>      Force mask 0-7
  --size <pixels>      Intended output size
  --dark <hex>         Dark color (default: #000000)
  --light <hex>        Light color (default: #ffffff)
  --title <text>       Accessible SVG title
  --check              Audit while generating; exits 2 on failure
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
      size: { type: 'string' },
      dark: { type: 'string', default: '#000000' },
      light: { type: 'string', default: '#ffffff' },
      title: { type: 'string' },
      check: { type: 'boolean' },
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

async function stdin(): Promise<string> {
  let data = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin)
    data += chunk
  return data.replace(/\r?\n$/, '')
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
  if (command !== 'generate' && command !== 'check')
    throw new TypeError(`Unknown command: ${command}`)

  const data = await input(command)
  const ecc = values.ecc?.toUpperCase() as ErrorCorrectionLevel
  const code = createQR(data, {
    ecc,
    border: numberOption('border', values.border),
    version: numberOption('version', values.version),
    mask: numberOption('mask', values.mask),
  })
  const size = numberOption('size', values.size)
  const audit = auditQR(code, { size, dark: values.dark, light: values.light })

  if (command === 'check') {
    process.stdout.write(values.json ? json({ ok: audit.ok, command, audit }) : humanReport(audit))
    if (!audit.ok) process.exitCode = 2
    return
  }

  let content: string
  if (values.format === 'svg') {
    content = renderSVG(code, {
      size,
      dark: values.dark,
      light: values.light,
      title: values.title,
    })
  }
  else if (values.format === 'terminal') {
    content = `${renderTerminal(code)}\n`
  }
  else if (values.format === 'matrix') {
    content = json(code.matrix)
  }
  else {
    throw new TypeError('--format must be svg, terminal, or matrix')
  }

  if (values.output)
    await writeFile(values.output, content)

  if (values.json) {
    process.stdout.write(json({
      ok: !values.check || audit.ok,
      command,
      artifact: values.output
        ? { format: values.format, path: values.output }
        : { format: values.format, content },
      qr: {
        version: code.version,
        ecc: code.ecc,
        border: code.border,
        modules: code.size,
      },
      audit,
    }))
  }
  else if (!values.output) {
    process.stdout.write(content)
  }
  else {
    process.stderr.write(`Wrote ${values.output}\n`)
  }

  if (values.check && !audit.ok)
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
