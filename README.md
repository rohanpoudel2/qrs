# qrs

[![CI](https://github.com/rohanpoudel2/qrs/actions/workflows/ci.yml/badge.svg)](https://github.com/rohanpoudel2/qrs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19-339933?logo=node.js&logoColor=white)](./package.json)

Generate and audit QR codes from code, the terminal, CI, or an agent.

> [!IMPORTANT]
> `qrs` is pre-release software. Its current audit performs deterministic static checks, not a real
> scanner guarantee. Independent decoding and distortion testing are the next milestone.

## Why qrs?

- Safe defaults: error correction `M` and a four-module quiet zone
- Text and real `Uint8Array` input
- DOM-free accessible SVG, terminal, and raw matrix output
- Stable, actionable JSON audit reports
- A non-interactive CLI designed for people, shell scripts, CI, and agents
- Local-first operation with deterministic output

## Library

```ts
import { auditQR, createQR, renderSVG } from '@rohanpoudel2/qrs'

const code = createQR('https://example.com')
const svg = renderSVG(code, { size: 320, title: 'Open example.com' })
const report = auditQR(code, { size: 320 })

if (!report.ok)
  console.error(report.issues)
```

The project and executable are named `qrs`. The npm identifier is scoped because the unrelated
unscoped `qrs` package is already owned on npm.

## CLI

```bash
# Generate SVG
qrs generate 'https://example.com' --output code.svg

# Pipe input and receive structured output
echo 'https://example.com' | qrs generate --stdin --json

# Check a proposed output configuration
qrs check 'https://example.com' --size 320 --json

# Generate and fail with exit code 2 when the audit fails
qrs generate 'https://example.com' --border 1 --check --output code.svg

# Let an agent discover the current surface
qrs capabilities --json
```

The CLI never prompts. Structured results go to stdout, operational messages go to stderr, and
failed audits use exit code `2`; invalid commands or inputs use exit code `1`.

## Current audit

| Check | What it catches |
|---|---|
| Quiet zone | Margins smaller than the required four modules |
| Error correction | Low recovery headroom |
| Module size | Symbols that become too small at the target size |
| Raster alignment | Fractional module boundaries that can blur |
| Contrast and polarity | Low contrast or light-on-dark symbols |

The report identifies itself as `static-v1` so consumers cannot mistake it for a scanner result.
See the [product roadmap](./ROADMAP.md) for the scan-contract plan.

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

