# Product plan

## Position

Other libraries generate QR codes. `qrs` should make the final artifact measurable, reproducible,
and safe to hand to a person, CI job, or software agent.

## Architecture

```text
Library API ─┐
CLI / stdin ─┼─ encode once ─ render ─ audit ─ report
CI / agents ─┘                         └─ scan lab (next)
```

One portable core owns behavior. The CLI remains a thin, deterministic adapter. HTTP, MCP, and
framework wrappers do not belong here until real consumers need them.

## Milestones

### M0 — usable vertical slice

- [x] Text and `Uint8Array` input
- [x] Safe ECC `M` and four-module quiet-zone defaults
- [x] Accessible SVG, terminal, and raw matrix output
- [x] Static audit with stable JSON schema and actionable issue codes
- [x] Non-interactive CLI with stdin, files, JSON, and meaningful exit codes
- [x] Node built-in tests; no test framework

### M1 — first real scan contract

- [ ] Pure PNG output so the public raster artifact can be tested directly
- [ ] Independent decoder in an opt-in entry point
- [ ] Deterministic resize, blur, compression, and contrast sweeps
- [ ] Screen and print profiles
- [ ] Per-artifact result that distinguishes static checks from real decodes
- [ ] `qrs check <artifact>` and JSONL batch mode

Exit gate: the CLI can prove that the exact SVG or PNG it produced survives a reproducible profile
using a reader independent from the encoder.

### M2 — generator parity and safe styling

- [ ] Blob, data URL, and Canvas output
- [ ] Optimal mixed numeric/alphanumeric/byte segmentation
- [ ] ECI and Kanji encoding
- [ ] Wi-Fi, vCard, email, SMS, geo, and event payload builders
- [ ] `uqr` compatibility entry point and migration fixtures
- [ ] Reproducible size and speed benchmarks
- [ ] Rounded/dot modules and independently styled finder patterns
- [ ] Gradients with contrast analysis
- [ ] Embedded logos that cannot overwrite finder/timing/alignment patterns

Exit gate: every version/ECC/mode boundary decodes in two independent readers, mixed payloads never
require a larger symbol than `qrcode`, and styled public artifacts pass the scan contract.

### M3 — automatic safety

- [ ] Map obscured modules to Reed–Solomon codewords and report actual damage distribution
- [ ] Auto-tune ECC, version, mask, logo size, and styling
- [ ] Label and poster profiles
- [ ] Crop, obstruction, and perspective sweeps
- [ ] Per-artifact score with the weakest passing/failing condition
- [ ] Repository glob support and CI annotations

Exit gate: results are reproducible across supported runtimes and never describe a static heuristic
as a real scan result.

### M4 — only when demanded

- Camera scanning
- Structured Append, Micro QR, and rMQR
- GitHub Action, HTTP handler, or MCP adapter
- Framework components

These are intentionally deferred. A clean CLI is already callable by agents and every framework can
consume an SVG string.

## Non-negotiable contracts

- Local-first; generation never requires a network request.
- `--json` is stable, versioned, and contains no ANSI or prose outside its schema.
- Identical input and options produce identical artifacts.
- Invalid or unsafe input fails explicitly.
- Independent readers, not the encoder itself, are the correctness oracle.
- The root library stays DOM-free and importable in browsers, workers, Node, Bun, and Deno.
