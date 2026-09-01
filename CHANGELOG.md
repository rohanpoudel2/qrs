# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Universal QR API for text and byte input
- O(n) optimal numeric/alphanumeric/byte segmentation with size and bitstream strategies
- Segment metadata and saved-bit reporting
- Accessible SVG, terminal, and raw matrix output
- Fast, deterministic 1-bit indexed PNG output
- Static scan-safety audit with stable issue codes
- Independent `scan-v1` screen and print profiles
- Resize, blur, JPEG compression, and contrast stress cases
- Opt-in millisecond timings and performance regression guardrails
- Differential version testing against `qrcode` across all error-correction levels
- Drift-free rotating SVG/PNG frames backed by an application token provider
- Rotation-window, clock-rollback, stale-token, and cancellation handling
- Non-interactive, JSON-capable CLI
- Project governance, contribution, and security documentation

[Unreleased]: https://github.com/rohanpoudel2/qrs/commits/main
