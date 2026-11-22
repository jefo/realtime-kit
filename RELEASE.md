# Releasing

The repository is public and CI is green. npm publishing is the remaining step;
the package name and scope must be decided first.

## 0. Current state

- `bun test` — 143 tests.
- `bun run test:ui` — 14 component tests (Vitest + Testing Library).
- `bun run typecheck` — clean, including `svelte-check`.
- `bun run build` — ESM, `.d.ts`, and Svelte components in each `dist/`.
- `node scripts/consumer-smoke.mjs` — packs all four packages, installs them
  with npm into a clean project, runs a Node smoke and a Vite build.
- CI: `.github/workflows/ci.yml`.
- Node consumer: `.github/workflows/consumer.yml`.
- Pages demo: `.github/workflows/pages.yml`.

## 1. Choose the name and scope

The current package names are `@rtkit/*`. Before publishing, confirm that the
account owns the npm scope. `rtkit` also names an unrelated Linux project, and
`terminal-kit` is an existing npm package, so a rename is likely.

If the scope is not owned:

- choose a unique project name and npm scope;
- rename the packages, imports, README badges and repository links;
- update the Pages base in `examples/terminal-demo/vite.config.ts` if the
  repository name changes;
- run the full release dry run again.

Do not publish under a scope you do not control: npm returns `403 Forbidden`.

## 2. Repository settings

Repository description, topics, homepage and Discussions are configured in
GitHub settings. If `gh` is available:

```bash
gh repo edit jefo/realtime-kit \
  --description "Real-time market data primitives: ingest, SSE sessions, UDF datafeed, Svelte UI" \
  --homepage "https://jefo.github.io/realtime-kit/" \
  --add-topic typescript --add-topic bun --add-topic sse \
  --add-topic tradingview --add-topic market-data --add-topic svelte
```

Otherwise set them manually. Enable **Discussions** if you want a place for API
questions; enable **Pages → GitHub Actions** for the demo.

## 3. Log in to npm

```bash
npm login
npm whoami
```

If 2FA is enabled, keep a one-time password ready or set `NPM_CONFIG_OTP`.

## 4. Dry run

```bash
./scripts/release.sh
```

This checks a clean tree, installs with the frozen lockfile, runs tests,
typecheck and build, and verifies the tarball contents for all four packages.
Nothing is published.

Run the consumer smoke as well:

```bash
node scripts/consumer-smoke.mjs
```

## 5. Publish

```bash
./scripts/release.sh --publish
```

Or manually:

```bash
cd packages/rt-subscriptions && npm publish --access public
cd ../udf-datafeed && npm publish --access public
cd ../market-ingest && npm publish --access public
cd ../terminal-kit && npm publish --access public
```

There are no runtime dependencies between the packages, so order does not
matter.

## 6. Tag and release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The publish workflow also runs on `v*` tags when `NPM_TOKEN` is configured in
**Settings → Secrets and variables → Actions**. For manual publishing, create
the GitHub release from the tag and copy the relevant `CHANGELOG.md` entries.

## 7. Verify

```bash
npm view @rtkit/subscriptions version
npm view @rtkit/udf-datafeed version
npm view @rtkit/market-ingest version
npm view @rtkit/terminal-kit version

mkdir -p /tmp/rtkit-smoke && cd /tmp/rtkit-smoke
bun init -y
bun add @rtkit/subscriptions @rtkit/udf-datafeed @rtkit/market-ingest @rtkit/terminal-kit
bun -e "import('@rtkit/subscriptions').then(m => console.log(Object.keys(m).length, 'exports'))"
```

## 8. Demo

The Pages workflow builds `examples/terminal-demo` and deploys it to
`https://jefo.github.io/realtime-kit/`. If the deployment fails, check that
Pages is set to **GitHub Actions** and that the base path in
`examples/terminal-demo/vite.config.ts` matches the repository name.

## 9. Post-release

- [ ] Add npm links to the repository README and `jefo/portfolio`.
- [ ] Pin the repository on the GitHub profile.
- [ ] Publish the launch post (stored outside this repository).
- [ ] Open a discussion for API feedback.
- [ ] Watch the first issues and resist adding scope before 0.2.

## 10. Unpublish policy

npm allows unpublishing within 72 hours if no other package depends on the
version. After that, publish a patch instead. Never reuse a version number.
