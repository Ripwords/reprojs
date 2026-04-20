#!/usr/bin/env bash
# Bumps the root package version, runs prerelease checks, updates
# CHANGELOG.md, commits, and tags as vX.Y.Z. The tag push triggers
# .github/workflows/publish-docker.yml, which publishes the dashboard image
# to Docker Hub.
#
# Usage:
#   bun run release             # patch (via changelogen default)
#   bun run release:minor
#   bun run release:major
#
# Why this exists as a script instead of an inline `changelogen --release`:
#   changelogen's --from defaults to `git describe --tags --abbrev=0`, which
#   returns the most recent reachable tag regardless of prefix. A recently-
#   cut sdk-v* tag would become this release's base — that's how the v0.1.6
#   CHANGELOG entry got corrupted with a `sdk-v0.1.6...v0.1.6` compare range.
#   Pin --from to the last v*.*.* tag explicitly.

set -euo pipefail

BUMP_FLAG="${1:-}"  # "", "--minor", or "--major"

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

echo "→ running changelogen..."
bunx changelogen --release --from "$LAST_DASHBOARD_TAG" $BUMP_FLAG
