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
- O(n) optimal numeric/alphanumeric/byte segmentation when it reduces symbol size
- DOM-free accessible SVG, one-pass 1-bit PNG, terminal, and raw matrix output
- Stable, actionable JSON audit reports
- Screen and print profiles covering resize, blur, JPEG compression, and low contrast
- A non-interactive CLI designed for people, shell scripts, CI, and agents
- Local-first operation with deterministic output

## Install

After the first npm prerelease is published:

```bash
npm install @rohanpoudel2/qrs
```

Until then, clone this repository and use `npm ci && npm run build`; the executable is available as
`node dist/cli.js` from the checkout.

`qrs` is ESM-only and requires Node.js 20.19 or newer for the CLI and scanner. The generation,
audit, PNG, and rotation entry points are DOM-free; the scanner is intentionally Node-specific.

## Choose a workflow

| Goal | Use |
|---|---|
| Generate an accessible QR in an application | `@rohanpoudel2/qrs` |
| Render a deterministic raster artifact | `@rohanpoudel2/qrs/png` |
| Verify an existing PNG and degraded variants | `@rohanpoudel2/qrs/scan` |
| Generate or check from a shell script | `qrs generate`, `qrs audit`, or `qrs check` |
| Gate a repository of QR assets in CI | `qrs batch` with a JSONL manifest |
| Let an agent discover and call the tool | `qrs capabilities --json` and JSON output |
| Display a server-issued credential that rotates | `@rohanpoudel2/qrs/rotate` |

## Library quick start

Entry points are split so applications only load the capabilities they use:

```ts
import { auditQR, createQR, renderSVG, renderTerminal } from '@rohanpoudel2/qrs'
import { renderPNG } from '@rohanpoudel2/qrs/png'
import { scanPNG } from '@rohanpoudel2/qrs/scan' // Node.js only
import { frameAt, rotateQR, rotationWindow } from '@rohanpoudel2/qrs/rotate'
```

Generate once, then reuse the encoded matrix across renderers and audits:

```ts
import { writeFile } from 'node:fs/promises'
import { auditQR, createQR, renderSVG } from '@rohanpoudel2/qrs'
import { renderPNG } from '@rohanpoudel2/qrs/png'
import { scanPNG } from '@rohanpoudel2/qrs/scan'

const payload = 'https://example.com'
const code = createQR(payload, { ecc: 'M', optimize: 'size' })
const svg = renderSVG(code, { size: 320, title: 'Open example.com' })
const report = auditQR(code, { size: 320 })
const png = renderPNG(code)
const scan = await scanPNG(png, { profile: 'screen', expected: payload })

if (!report.ok || !scan.ok)
  throw new Error('QR artifact did not pass its safety checks')

await Promise.all([
  writeFile('code.svg', svg),
  writeFile('code.png', png),
])
```

Binary input remains binary; it is not coerced through a JavaScript string:

```ts
import { createQR } from '@rohanpoudel2/qrs'
import { renderPNG } from '@rohanpoudel2/qrs/png'

const bytes = Uint8Array.of(0x00, 0x01, 0xfe, 0xff)
const png = renderPNG(createQR(bytes, { ecc: 'Q' }))
```

The project and executable are named `qrs`. The npm identifier is scoped because the unrelated
unscoped `qrs` package is already owned on npm.

## CLI

```bash
# Generate SVG
qrs generate 'https://example.com' --output code.svg

# Generate the PNG and run the real screen profile before returning
qrs generate 'https://example.com' --format png --output code.png --check

# Force the shortest bitstream even when it does not reduce the QR version
qrs generate 'https://example.com/order/123456789' --optimize bits --json

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

## Use in CI

Keep the manifest next to the repository so the expected payload and scan profile are reviewed with
the artifact. For example, `qrs.checks.jsonl`:

```jsonl
{"path":"public/home.png","profile":"screen","expected":"https://example.com"}
{"path":"public/event-poster.png","profile":"print","expected":"https://example.com/event"}
```

Once the package is published, install `qrs` as a development dependency and expose the check as
an ordinary package script:

```json
{
  "scripts": {
    "qr:check": "qrs batch qrs.checks.jsonl"
  },
  "devDependencies": {
    "@rohanpoudel2/qrs": "^0.1.0"
  }
}
```

A minimal GitHub Actions job can generate application assets first and then fail when any record
does not pass:

```yaml
name: QR artifacts

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build:qr-assets # Replace with your artifact-generation command.
      - run: npm run qr:check
```

`qrs batch` writes one JSON object per manifest record and returns exit code `2` if any artifact
fails. This makes the same command useful locally, in pre-commit automation, and in CI without a
CI-specific wrapper.

## Use from an agent

An agent can inspect the supported surface before it generates anything:

```bash
qrs capabilities --json
```

It can then create an artifact, validate the exact bytes, and receive one structured result:

```bash
qrs generate 'https://example.com' \
  --format png \
  --output artifacts/home.png \
  --check \
  --profile screen \
  --json
```

For an artifact supplied by another tool, stream the bytes without creating an intermediate input
file:

```bash
some-qr-generator | qrs check --stdin --expected 'https://example.com' --json
```

The automation contract is intentionally small:

| Signal | Meaning |
|---|---|
| stdout with `--json` | One versioned result; no ANSI or explanatory prose |
| stderr | Operational messages only |
| exit `0` | Command and requested checks passed |
| exit `1` | Invalid command, option, input, or runtime error |
| exit `2` | Valid command, but an audit or scan contract failed |

Agents should treat exit `2` as an actionable artifact-quality failure rather than retrying the
same command unchanged. They can inspect `issues`, failed scan cases, and suggestions in the JSON
before choosing a safer size, color pair, border, or error-correction level.

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

## Encoding optimization

The default `size` strategy runs the segment planner only when a conservative lower bound shows that
mixed encoding can reduce the QR version. This preserves the original fast path for payloads that
cannot become smaller. Use `{ optimize: 'bits' }` or `--optimize bits` to request the shortest
bitstream regardless of version; use `false` or `--optimize off` to disable segmentation.

Each result exposes `segments`, `dataBits`, and `savedBits`. The planner is an O(n) six-state shortest
path across numeric, alphanumeric, and UTF-8 byte modes.

## Performance

Performance is a product contract. `npm run benchmark` measures the current machine, while CI uses
generous guardrails to catch algorithmic regressions without relying on noisy shared-runner timing.
`npm run test:stress` exercises a deterministic 1,000-item text/binary corpus, every QR version and
error-correction level, version-group scan boundaries, concurrent scan profiles, and scanner safety
limits. `npm run test:benchmark` runs the CI performance guardrails, and `npm run benchmark:json`
emits a versioned machine-readable benchmark report for tracking results over time. Use
`npm run --silent benchmark:json` when stdout must contain only JSON.

Current local baseline for a 296×296 QR:

| Operation | Time |
|---|---:|
| `createQR` | ~0.04 ms |
| Optimized mixed encode | ~0.10 ms |
| 1-bit `renderPNG` | ~0.04 ms |
| Rotating PNG frame, excluding token fetch | ~0.08 ms |
| Full screen profile, cold | ~35 ms |
| Full screen profile, warm | ~20–25 ms |

See the [product roadmap](./ROADMAP.md) for the remaining scan and styling work.

## Rotating server-issued QRs

`@rohanpoudel2/qrs/rotate` is a library API for applications that display a short-lived value. It
owns boundary scheduling and QR rendering; your application remains responsible for issuing and
verifying the credential. There is intentionally no rotation CLI because a long-running display
needs application authentication, lifecycle, and UI ownership.

```text
member app ── authenticated request ──> credential issuer
    │                                      │
    └──── short-lived token <──────────────┘
    │
    └──── rotating QR ──> scanner/verifier ──> replay and revocation policy
```

### Browser display

This example fetches a server-issued token, renders it as PNG, replaces object URLs safely, and
clears the image when its credential window ends:

```ts
import { rotateQR } from '@rohanpoudel2/qrs/rotate'

const image = document.querySelector<HTMLImageElement>('#membership-code')!
const controller = new AbortController()
let objectURL: string | undefined
let clearTimer: ReturnType<typeof setTimeout> | undefined

try {
  for await (const frame of rotateQR({
    period: 30_000,
    output: 'png',
    signal: controller.signal,
    token: async ({ step, signal }) => {
      const response = await fetch('/api/membership/pass', {
        signal,
        headers: {
          accept: 'text/plain',
          'x-rotation-step': String(step),
        },
      })
      if (!response.ok)
        throw new Error(`Credential request failed: ${response.status}`)
      return response.text()
    },
  })) {
    if (objectURL)
      URL.revokeObjectURL(objectURL)
    objectURL = URL.createObjectURL(new Blob([frame.artifact], { type: 'image/png' }))
    image.src = objectURL

    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      image.removeAttribute('src')
      if (objectURL)
        URL.revokeObjectURL(objectURL)
      objectURL = undefined
    }, Math.max(0, frame.expiresAt - Date.now()))
  }
}
finally {
  clearTimeout(clearTimer)
  if (objectURL)
    URL.revokeObjectURL(objectURL)
}

// Call controller.abort() when the view unmounts or the member signs out.
```

The token callback begins at the time boundary. A network request may therefore leave a short blank
period after the previous frame expires. Applications that require a seamless transition should
prefetch the next server-issued value in their application layer and still refuse to display an
expired frame.

### Server issuer

The client requests a step so its visual boundary and credential window can align. The server checks
that step against its own clock and bounded skew; it never trusts client-supplied timestamps.
`issueCredential` below represents application-owned signing code and is not supplied by `qrs`:

```ts
import { rotationWindow } from '@rohanpoudel2/qrs/rotate'

app.get('/api/membership/pass', requireMemberSession, async (request, response) => {
  const period = 30_000
  const requestedStep = Number(request.get('x-rotation-step'))
  const current = rotationWindow(Date.now(), { period })
  if (!Number.isSafeInteger(requestedStep) || Math.abs(requestedStep - current.step) > 1)
    return response.status(400).send('Invalid credential window')

  const window = rotationWindow(requestedStep * period, { period })
  const token = await issueCredential({
    protocolVersion: 1,
    type: 'membership-pass',
    keyId: activeSigningKey.id,
    issuer: 'https://issuer.example',
    audience: 'venue-entry',
    subject: request.member.id,
    // Return the same ID for repeated requests by this member in this window.
    tokenId: await tokenIds.forMemberWindow(request.member.id, requestedStep),
    issuedAt: Math.floor(Date.now() / 1_000),
    notBefore: Math.floor(window.validFrom / 1_000),
    expiresAt: Math.floor(window.expiresAt / 1_000),
  })

  response.type('text/plain').send(token)
})
```

The token-ID store can generate a random UUID when a member/window pair is first seen. Returning a
fresh token ID for every HTTP retry would allow one authenticated session to mint multiple
independently consumable credentials for the same window. The display clock must also remain
reasonably synchronized; signed token claims are authoritative at the verifier even when the local
frame timer differs slightly.

If every active display fetches once per 30-second period, issuer load is approximately
`active displays / 30` requests per second. Pre-issuing a small bundle of future signed tokens can
reduce that load, but increases revocation delay and requires careful protection of the bundle.

### Verifier

Verification happens outside `qrs`. A production verifier should authenticate the issuer, restrict
the allowed signature algorithm, validate audience and time claims with bounded clock skew, enforce
revocation, and atomically consume a unique token ID. Conceptually:

```ts
const claims = await verifyCredential(scannedValue, {
  allowedAlgorithms: ['EdDSA'],
  issuer: 'https://issuer.example',
  audience: 'venue-entry',
  clockToleranceSeconds: 2,
})

const firstUse = await replayStore.consumeOnce(claims.tokenId, claims.expiresAt)
if (!firstUse)
  throw new Error('Credential was already used')
```

For an online verifier, a short opaque random token backed by the server is often the smallest and
simplest design. Offline verification requires signed tokens, trusted public keys, synchronized
clocks, and a local replay cache; independent offline scanners cannot provide global replay
prevention without synchronizing their state.

### What rotation protects

Rotation and expiration reduce the useful lifetime of an old screenshot. They do not prevent reuse
during the active window, a live relay, account sharing, or a copied authenticated session that can
continue requesting tokens. Strict one-time use requires an atomic replay store, while higher-risk
access control may also need device binding, an operator-visible member identity, or an interactive
challenge.

The iterator schedules against exact boundaries instead of accumulating `setInterval` drift. It
discards newly fetched tokens that are already stale, handles clock rollback without repeating a
step, and stops cleanly through `AbortSignal`. `frameAt()` and `rotationWindow()` provide deterministic
one-frame and time-window primitives for server rendering and tests. The member application must
never contain the signing key or log live bearer tokens. Signed-token issuance and verification are
tracked separately in [security issue #8](https://github.com/rohanpoudel2/qrs/issues/8).

## Development

Requirements: Node.js 20.19 or newer and npm 11.

```bash
git clone https://github.com/rohanpoudel2/qrs.git
cd qrs
npm ci
npm test
npm run test:stress
npm run test:benchmark
npm run benchmark
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. For help, use
[GitHub Discussions](https://github.com/rohanpoudel2/qrs/discussions); report vulnerabilities using
the [security policy](./SECURITY.md).

## Community and license

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). qrs is available under the
[MIT License](./LICENSE).
