# Contributing

## Setup

```bash
bun install
bun test
bun run test:ui
bun run typecheck
bun run build
```

## Layout

Each package is independent and has no runtime dependency on another package.

```
packages/<name>/src       public code
packages/<name>/tests     bun:test suites
packages/<name>/examples  runnable examples
```

## Rules

- New behavior needs a test at the protocol boundary, not a snapshot of markup.
  UI changes should include a component test under `tests-ui/`.
- No vendor SDKs in core packages; adapters are separate classes.
- Keep the public surface small. Export only what the README documents.
- Errors must be typed (`GatewayError`, `MarketError`, `ProviderError`) so
  callers can branch on `code`.
- Run `bun run test:ui`, `bun run typecheck` and `bun test` before opening a PR.
- Generated `.svelte-kit/` directories are ignored; do not commit them.

## Commits

Conventional style: `feat(subscriptions): ...`, `fix(udf): ...`,
`docs: ...`, `chore: ...`.
