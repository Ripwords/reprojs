#!/usr/bin/env bash
# Bumps packages/core's version, runs prerelease checks, commits, and tags
# as sdk-vX.Y.Z. The tag push triggers .github/workflows/publish-npm.yml,
# which republishes @reprojs/core from source with provenance.
#
# Usage:
#   bun run release:sdk [patch|minor|major]
#
# The SDK release is intentionally decoupled from the dashboard release
# (which uses `bun run release:minor` and v*.*.* tags), so a dashboard-only
# change doesn't force a churn republish of the SDK.

set -euo pipefail

BUMP="${1:-patch}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "usage: $0 [patch|minor|major]" >&2; exit 2 ;;
esac

# Refuse to release from a dirty working tree — next step commits whatever
# is staged, and we only want the version bump in the release commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "error: release:sdk must run from main (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi

echo "→ running prerelease checks (lint, test:sdk, sdk:build)..."
bun run prerelease

echo "→ bumping packages/core version ($BUMP)..."
# Edit package.json in place with Bun. `npm version` chokes here because
# packages/core's devDependencies use `workspace:*` protocol refs, which
# npm tries to resolve on its way through. Bun edits JSON directly and
# doesn't touch the dep graph, so it's both faster and workspace-safe.
# We also don't want npm's auto-tag anyway — the tag with the sdk-
# prefix is created manually below.
NEW_VERSION=$(bun -e '
  const path = "packages/core/package.json"
  const pkg = await Bun.file(path).json()
  const [M, m, pa] = pkg.version.split(".").map(Number)
  const bump = process.argv[1]
  const next =
    bump === "major" ? [M + 1, 0, 0] :
    bump === "minor" ? [M, m + 1, 0] :
    [M, m, pa + 1]
  pkg.version = next.join(".")
  await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n")
  console.log(pkg.version)
' "$BUMP")
TAG="sdk-v${NEW_VERSION}"

echo "→ committing chore(release): ${TAG}..."
git add packages/core/package.json
git commit -m "chore(release): ${TAG}"
git tag "$TAG"

echo ""
echo "✓ tagged $TAG locally."
echo ""
echo "Next: push to trigger publish-npm.yml"
echo "  git push --follow-tags"
echo ""
echo "(Push is intentionally manual — npm publishes are immutable within"
echo " 72h, so review the tag before it ships.)"
