# qrs

[![CI](https://github.com/rohanpoudel2/qrs/actions/workflows/ci.yml/badge.svg)](https://github.com/rohanpoudel2/qrs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19-339933?logo=node.js&logoColor=white)](./package.json)

Generate, audit, and independently stress-test QR codes from code, the terminal, CI, or an agent.

> [!IMPORTANT]
> `qrs` is pre-release software. `static-v1` reports are deterministic heuristics; `scan-v1` reports
> decode the exact PNG plus degraded variants with an independent ZXing-C++ WebAssembly reader.

## Why qrs?

- Safe defaults: error correction `M` and a four-module quiet zone
- Text and real `Uint8Array` input
- DOM-free accessible SVG, one-pass 1-bit PNG, terminal, and raw matrix output
- Stable, actionable JSON audit reports
- Screen and print profiles covering resize, blur, JPEG compression, and low contrast
- A non-interactive CLI designed for people, shell scripts, CI, and agents
- Local-first operation with deterministic output

## Library

```ts
import { auditQR, createQR, renderSVG } from '@rohanpoudel2/qrs'
import { renderPNG } from '@rohanpoudel2/qrs/png'
import { scanPNG } from '@rohanpoudel2/qrs/scan'

const code = createQR('https://example.com')
const svg = renderSVG(code, { size: 320, title: 'Open example.com' })
const report = auditQR(code, { size: 320 })
const png = renderPNG(code)
const scan = await scanPNG(png, { profile: 'screen', expected: 'https://example.com' })

if (!report.ok || !scan.ok)
  process.exitCode = 2
```

The project and executable are named `qrs`. The npm identifier is scoped because the unrelated
unscoped `qrs` package is already owned on npm.

## CLI

```bash
# Generate SVG
qrs generate 'https://example.com' --output code.svg

# Generate the PNG and run the real screen profile before returning
qrs generate 'https://example.com' --format png --output code.png --check

# Pipe input and receive structured output
echo 'https://example.com' | qrs generate --stdin --json

# Check an existing PNG and require its exact payload
qrs check code.png --profile print --expected 'https://example.com' --json

# Stream an artifact directly between agent-friendly commands
qrs generate 'https://example.com' --format png | qrs check --stdin --json

# Amortize scanner startup across many artifacts
qrs batch checks.jsonl

# Run the fast deterministic static audit without loading the scanner
qrs audit 'https://example.com' --size 330 --json

# Let an agent discover the current surface
qrs capabilities --json
```

The CLI never prompts. Structured results go to stdout, operational messages go to stderr, and
failed audits or scan profiles use exit code `2`; invalid commands or inputs use exit code `1`.

## Current audit

| Check | What it catches |
|---|---|
| Quiet zone | Margins smaller than the required four modules |
| Error correction | Low recovery headroom |
| Module size | Symbols that become too small at the target size |
| Raster alignment | Fractional module boundaries that can blur |
| Contrast and polarity | Low contrast or light-on-dark symbols |

The report identifies itself as `static-v1` so consumers cannot mistake it for a scanner result.

## Scan contract

`scan-v1` currently accepts PNG files up to 32 MiB and 4096×4096 pixels. It runs five checks:

1. The exact PNG bytes
2. Bilinear downscaling
3. A separable box blur
4. JPEG compression
5. Reduced contrast

ZXing is loaded only when the scan entry point or CLI `check` path is used. Normal library imports
and SVG generation do not initialize WebAssembly or image decoders. Pass `timings: true` or
`--timings` when measuring; timings are omitted by default so JSON reports stay deterministic.

Batch manifests are JSONL, with paths resolved relative to the manifest:

```jsonl
{"path":"public/home.png","profile":"screen","expected":"https://example.com"}
{"path":"public/poster.png","profile":"print"}
```

Batch output is JSONL in the same order. The WASM reader is initialized once and reused for every
record, which avoids per-artifact cold-start cost.

## Performance

Performance is a product contract. `npm run benchmark` measures the current machine, while CI uses
generous guardrails to catch algorithmic regressions without relying on noisy shared-runner timing.

Current local baseline for a 296×296 QR:

| Operation | Time |
|---|---:|
| `createQR` | ~0.04 ms |
| 1-bit `renderPNG` | ~0.04 ms |
| Full screen profile, cold | ~35 ms |
| Full screen profile, warm | ~20–25 ms |

See the [product roadmap](./ROADMAP.md) for the remaining scan and styling work.

## Development

Requirements: Node.js 20.19 or newer and npm 11.

```bash
git clone https://github.com/rohanpoudel2/qrs.git
cd qrs
npm ci
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. For help, use
[GitHub Discussions](https://github.com/rohanpoudel2/qrs/discussions); report vulnerabilities using
the [security policy](./SECURITY.md).

## Community and license

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). qrs is available under the
[MIT License](./LICENSE).
