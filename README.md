# qrs

Generate and verify QR codes from code, the terminal, CI, or an agent.

This repository is at the first working milestone. It deliberately calls its current result an
**audit**, not a scan guarantee: distortion testing and independent decoding come next.

## Library

```ts
import { auditQR, createQR, renderSVG } from '@rohanpoudel2/qrs'

const code = createQR('https://example.com')
const svg = renderSVG(code, { size: 320, title: 'Open example.com' })
const report = auditQR(code, { size: 320 })
```

Defaults are error correction `M` and a four-module quiet zone.

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

The CLI is non-interactive. Structured results go to stdout, operational messages go to stderr,
and failed checks use exit code `2`.

## Current audit

- Four-module quiet zone
- Error-correction headroom
- Effective module size
- Fractional raster sizing
- Foreground/background contrast

See [ROADMAP.md](./ROADMAP.md) for the scan-contract plan.

## Development

```bash
npm install
npm test
```

## License

MIT

