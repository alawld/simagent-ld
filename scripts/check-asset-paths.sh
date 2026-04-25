#!/usr/bin/env bash
# scripts/check-asset-paths.sh
# Catch root-absolute runtime asset paths in src/ that bypass Vite's --base
# rewriting. Vite only rewrites paths that flow through the module graph
# (imports, HTML); runtime string literals like '/assets/foo.svg' stay
# unchanged in the bundle and 404 under any non-root deploy base.
#
# Fix shape: prefix with `import.meta.env.BASE_URL`, e.g.
#   const URL = `${import.meta.env.BASE_URL}assets/foo.svg`;
#
# Run via: bash scripts/check-asset-paths.sh   (or npm run verify)
# Exits 0 if clean; exits 1 with a list of offending lines otherwise.

set -euo pipefail

# Match string literals that begin with /assets/, /fonts/, /audio/, or /sprites/
# inside src/. Both single- and double-quoted forms.
PATTERN="['\"]/(assets|fonts|audio|sprites)/"

HITS=$(grep -rnE "$PATTERN" src/ --include='*.ts' --include='*.tsx' --exclude='*.test.ts' || true)

if [[ -n "$HITS" ]]; then
  echo "Root-absolute asset path detected — these break under Vite --base= overlay builds:"
  echo "$HITS"
  echo ""
  echo "Replace with: \`\${import.meta.env.BASE_URL}assets/foo.svg\` (BASE_URL has trailing /)."
  exit 1
fi
echo "Asset-path guard: clean."
