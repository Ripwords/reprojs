#!/usr/bin/env bash
# Run each SDK package's test suite in a fresh `bun test` process so
# globalThis state cannot leak across test files.
#
# Why: the wizard tests in packages/ui assign happy-dom Window/document
# onto globalThis (Preact's `render` reads document from global scope).
# When `bun test packages/` walked all files in one process, that
# polluted globalThis was visible to recorder tests that loaded later,
# breaking them with "cancelAnimationFrame is not defined" and
# "target[PropertySymbol.observeMutations] is not a function" — even
# though every package's tests pass cleanly when run in isolation.
#
# Per-package invocation costs ~2s of process-startup overhead total but
# eliminates the cross-file pollution class entirely.

set -euo pipefail

PACKAGES=(sdk-utils shared recorder ui core expo integrations)

for pkg in "${PACKAGES[@]}"; do
  echo "--- packages/$pkg"
  bun test "packages/$pkg"
done
