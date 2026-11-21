# Release

Everything is built and tested. Only the credentials and the public repository
are missing.

## 0. What is already done

- `bun test` — 107 tests.
- `bun run typecheck` — clean.
- `bun run build` — ESM + `.d.ts` in each `dist/`.
- `npm pack --dry-run` — `dist`, `README.md`, `LICENSE`, `package.json` only.
- CI: `.github/workflows/ci.yml`.
- Publish workflow: `.github/workflows/publish.yml`.

## 1. Create the GitHub repository

The SSH key on this machine already authenticates as `jefo`.

Create an empty public repository `jefo/realtime-kit` at
<https://github.com/new?name=realtime-kit&visibility=public> (no README, no
license — they already exist), then:

```bash
cd Products/realtime-kit
git remote add origin git@github.com:jefo/realtime-kit.git
git branch -M main
git push -u origin main
```

Check that CI is green.

## 2. Decide the npm scope

The packages are named `@rtkit/*`. A scope must be owned by an npm user or org.

**Option A — create the `rtkit` org (recommended).**
Go to <https://www.npmjs.com/org/create>, create a free public org named `rtkit`,
then publish from your account. No code changes.

**Option B — use the `@jefo` scope.**
If your npm username is `jefo`, the scope already exists. Rename the packages
before publishing:

```bash
# package names
perl -pi -e 's/@rtkit\//@jefo\//g' packages/*/package.json package.json \
  packages/*/README.md README.md examples/*.ts packages/*/src/**/*.ts 2>/dev/null || true

# re-link the workspace
bun install
bun test
```

Do not publish under a scope you do not own: npm returns `403 Forbidden`.

## 3. Log in to npm

```bash
npm login
npm whoami
```

If 2FA is enabled, keep the one-time password ready or set `NPM_CONFIG_OTP`.

## 4. Dry run

```bash
./scripts/release.sh
```

This checks a clean tree, installs with the frozen lockfile, runs tests,
typecheck and build, and verifies the tarball contents for all three packages.
Nothing is published.

Inspect a tarball if needed:

```bash
cd packages/rt-subscriptions && npm pack --dry-run
```

## 5. Publish

```bash
./scripts/release.sh --publish
```

Or manually, one package at a time:

```bash
cd packages/rt-subscriptions && npm publish --access public
cd ../udf-datafeed && npm publish --access public
cd ../market-ingest && npm publish --access public
```

There are no runtime dependencies between the packages, so order does not
matter.

## 6. Tag and release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `publish` workflow also runs on `v*` tags when `NPM_TOKEN` is configured.
For manual publishing, add the secret in **Settings → Secrets and variables →
Actions**:

```
NPM_TOKEN = <automation token from npmjs.com>
```

Then create a GitHub release from the tag with the contents of `CHANGELOG.md`.

## 7. Verify

```bash
npm view @rtkit/subscriptions version
npm view @rtkit/udf-datafeed version
npm view @rtkit/market-ingest version

mkdir -p /tmp/rtkit-smoke && cd /tmp/rtkit-smoke
bun init -y
bun add @rtkit/subscriptions @rtkit/udf-datafeed @rtkit/market-ingest
bun -e "import('@rtkit/subscriptions').then(m => console.log(Object.keys(m).length, 'exports'))"
```

## 8. Unpublish policy

npm allows unpublishing within 72 hours if no other package depends on the
version. After that, publish a patch instead. Never reuse a version number.

## 9. Post-release

- [ ] Add the npm links to the README of `jefo/portfolio`.
- [ ] Add the repository topics: `typescript`, `bun`, `sse`, `tradingview`, `market-data`.
- [ ] Publish the launch post from `SALES.md`.
- [ ] Pin the repository on the GitHub profile.
- [ ] Replace the "not on npm yet" note in package READMEs if any remain.
