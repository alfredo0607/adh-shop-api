#!/usr/bin/env bash
# Fails if test code reached the production build.
#
# The tsconfig exclusions are the fix; this is the guard that keeps them true.
# A fixture shipping inside the image is invisible — the container starts, the
# tests pass, nothing fails — so without a check it regresses the next time
# someone adds a helper under a name the patterns do not cover.
set -euo pipefail

DIST="${1:-dist}"

[[ -d "$DIST" ]] || { echo "No build at $DIST. Run pnpm build first." >&2; exit 1; }

leaked=$(find "$DIST" \( \
  -name '*.spec.js' -o \
  -name '*.fixture.js' -o \
  -path '*__fixtures__*' -o \
  -path '*/test/*' -o \
  -path '*/testing/*' \
\) -print 2>/dev/null || true)

if [[ -n "$leaked" ]]; then
  echo "Test code found in the production build:" >&2
  echo "$leaked" | sed 's/^/  - /' >&2
  echo >&2
  echo "Exclude it in tsconfig.build.json." >&2
  exit 1
fi

# A build with no entry point still exits 0, so its absence is worth asserting
# here rather than discovering it when the container crash-loops.
[[ -f "$DIST/main.js" ]] || { echo "No $DIST/main.js: the artifact cannot start." >&2; exit 1; }

echo "Build artifact is clean: $(find "$DIST" -name '*.js' | wc -l) files, entry point present."
