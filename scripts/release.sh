#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PUBLISH=false
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

echo "== install"
bun install --frozen-lockfile

echo "== test"
bun test

echo "== typecheck"
bun run typecheck

echo "== build"
bun run build

PACKAGES=(
  "packages/rt-subscriptions"
  "packages/udf-datafeed"
  "packages/market-ingest"
)

for dir in "${PACKAGES[@]}"; do
  echo "== pack ${dir}"
  (cd "$dir" && npm pack --dry-run >/dev/null)
done

if [[ "$PUBLISH" == false ]]; then
  echo
  echo "Dry run complete. Re-run with --publish to publish to npm."
  exit 0
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in to npm. Run: npm login" >&2
  exit 1
fi

for dir in "${PACKAGES[@]}"; do
  echo "== publish ${dir}"
  (cd "$dir" && npm publish --access public)
done

echo
echo "Published. Next: git tag v0.1.0 && git push origin v0.1.0"
