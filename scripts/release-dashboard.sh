#!/usr/bin/env bash
# Bumps the root package version, runs prerelease checks, updates
# CHANGELOG.md, commits, and tags as vX.Y.Z. The tag push triggers
# .github/workflows/publish-docker.yml, which publishes the dashboard image
# to Docker Hub.
#
# Usage:
#   bun run release             # patch
#   bun run release:minor
#   bun run release:major
#
# Why this exists as a script instead of an inline `changelogen --release`:
#   1. changelogen's --from defaults to `git describe --tags --abbrev=0`,
#      which returns the most recent reachable tag regardless of prefix. A
#      recently-cut sdk-v* tag would become this release's base — that's
#      how the v0.1.6 CHANGELOG entry got corrupted with a
#      sdk-v0.1.6...v0.1.6 compare range. Pin --from to the last v*.*.*
#      tag explicitly.
#   2. changelogen silently downgrades --minor and --major while on 0.x
#      versions (minor → patch, major → minor) to discourage 0.x SemVer
#      drift. We compute the bump ourselves and pass an explicit -r so
#      `release:minor` actually means minor.

set -euo pipefail

BUMP_FLAG="${1:-}"  # "", "--minor", or "--major"
case "$BUMP_FLAG" in
  "")        BUMP="patch" ;;
  "--minor") BUMP="minor" ;;
  "--major") BUMP="major" ;;
  *)
    echo "usage: $0 [--minor|--major]" >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "error: release must run from main (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi

echo "→ running prerelease checks..."
bun run prerelease

# Version-sort, filter to v* (exclude sdk-v*).
LAST_DASHBOARD_TAG=$(git tag --list 'v*.*.*' --sort=-version:refname | head -n1)
if [ -z "$LAST_DASHBOARD_TAG" ]; then
  echo "error: no v*.*.* tag found to use as --from base" >&2
  exit 1
fi
echo "→ using $LAST_DASHBOARD_TAG as changelog base"

# Compute the next version literally so changelogen's 0.x downgrade can't
# silently turn a `release:minor` into a patch.
CURRENT_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(node -e '
  const [M, m, pa] = process.argv[1].split(".").map(Number);
  const bump = process.argv[2];
  const next =
    bump === "major" ? [M + 1, 0, 0] :
    bump === "minor" ? [M, m + 1, 0] :
    [M, m, pa + 1];
  console.log(next.join("."));
' "$CURRENT_VERSION" "$BUMP")
TAG="v${NEW_VERSION}"

echo "→ bumping dashboard $CURRENT_VERSION → $NEW_VERSION via changelogen..."
bunx changelogen --release \
  -r "$NEW_VERSION" \
  --from "$LAST_DASHBOARD_TAG"

echo ""
echo "✓ tagged $TAG locally with CHANGELOG entry."
echo ""
echo "Next: push to trigger publish-docker.yml"
echo "  git push --follow-tags"
