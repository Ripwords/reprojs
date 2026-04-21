#!/usr/bin/env bash
# Shared pre-tag gate. Refuses to proceed with a release if the CI workflow
# on main is failing, pending, or missing for the current HEAD commit.
#
# Rationale: v0.1.11's tag was cut without checking CI, the Dockerfile build
# in publish-docker.yml then failed on the tag push, leaving an orphan tag
# with no image behind it. This function catches that class of mistake
# before the tag is even created.
#
# Usage (in a release script):
#   . "$(dirname "$0")/lib/ci-gate.sh"
#   require_green_ci
#
# Skippable via REPRO_SKIP_CI_GATE=1 for exceptional manual releases (e.g.
# releasing out-of-band fix commits from an offline machine). Emit a warning
# so the operator has to acknowledge.

require_green_ci() {
  if [ "${REPRO_SKIP_CI_GATE:-0}" = "1" ]; then
    echo "! REPRO_SKIP_CI_GATE=1 — skipping CI precheck" >&2
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "warning: gh CLI not found; skipping CI precheck." >&2
    echo "         Install https://cli.github.com or set REPRO_SKIP_CI_GATE=1" >&2
    return 0
  fi

  local sha
  sha=$(git rev-parse HEAD)
  echo "→ checking CI workflow status for $sha..."

  # `gh run list` is deliberate over `commits/:sha/check-runs` because that
  # endpoint lumps in external checks (e.g. third-party PR bots) that
  # could fail unrelated to release safety. Filter to just CI workflow.
  local result
  if ! result=$(gh run list \
      --workflow=ci.yml \
      --commit="$sha" \
      --limit=1 \
      --json status,conclusion 2>/dev/null); then
    echo "warning: could not query GitHub Actions (not authenticated?); skipping." >&2
    return 0
  fi

  local status conclusion
  status=$(printf '%s' "$result" | jq -r '.[0].status // "missing"')
  conclusion=$(printf '%s' "$result" | jq -r '.[0].conclusion // "none"')

  case "$status" in
    completed)
      if [ "$conclusion" = "success" ]; then
        echo "✓ CI green on $sha"
        return 0
      fi
      echo "error: CI for $sha completed with status '$conclusion'. Fix before tagging." >&2
      echo "       Override: REPRO_SKIP_CI_GATE=1 bun run release" >&2
      exit 1
      ;;
    in_progress|queued|requested|waiting|pending)
      echo "error: CI for $sha is still running ($status). Wait for it to finish." >&2
      echo "       Override: REPRO_SKIP_CI_GATE=1 bun run release" >&2
      exit 1
      ;;
    missing|"")
      echo "error: no CI run found for $sha. Did you push main first?" >&2
      echo "       Run: git push origin main" >&2
      echo "       Override: REPRO_SKIP_CI_GATE=1 bun run release" >&2
      exit 1
      ;;
    *)
      echo "error: unexpected CI status '$status' for $sha" >&2
      exit 1
      ;;
  esac
}
