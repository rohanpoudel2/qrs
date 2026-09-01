# Contributing to qrs

Thanks for helping make QR generation more reliable and easier to automate.

## Before you start

- Search existing issues and discussions before opening a new one.
- Use an issue form for reproducible bugs and concrete feature requests.
- Use [GitHub Discussions](https://github.com/rohanpoudel2/qrs/discussions) for questions and ideas
  that are not ready to become work items.
- Do not report vulnerabilities publicly; follow [SECURITY.md](./SECURITY.md).
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

You need Node.js 20.19 or newer and npm 11.

```bash
git clone https://github.com/rohanpoudel2/qrs.git
cd qrs
npm ci
npm test
```

The portable library lives in `src/index.ts`; the Node-specific CLI is a thin adapter in
`src/cli.ts`. Tests use the Node.js built-in test runner.

## Making a change

1. Fork the repository and create a focused branch from `main`.
2. Add the smallest change that solves the reported problem.
3. Add or update a test for behavior changes.
4. Update the README, roadmap, or changelog when users need to know about the change.
5. Run `npm test` and `npm pack --dry-run`.
6. Open a pull request using the provided template.

Keep pull requests focused. Unrelated cleanup makes review and rollback harder. New runtime
dependencies need a concrete bundle-size, security, or correctness justification.

Performance-sensitive changes should also run `npm run benchmark`. Include before/after numbers in
the pull request, but do not tune production behavior for one machine or one payload.

## Project contracts

- Generation is local-first and deterministic.
- The root library stays DOM-free and runtime-portable.
- JSON output is stable, versioned, and contains no unstructured logs.
- Static heuristics must never be described as real scanner results.
- Independent readers—not the encoder itself—are the correctness oracle.
