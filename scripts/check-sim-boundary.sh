#!/usr/bin/env bash
# scripts/check-sim-boundary.sh
# FNDN-07 grep backstop — catches nested WorldState sim-state writes that the ESLint
# nonSimMutationGuard tripwire misses (e.g., world.ants.alive[id] = 0).
#
# Run via: bash scripts/check-sim-boundary.sh   (or npm run verify)
# Exits 0 if clean; exits 1 with a reviewer-friendly diagnostic if violations are found.
#
# SCEN-05 magic-number spot check (for reference — not automated here):
#   grep -rnE '\b[0-9]{2,}\b' src/sim/ src/platform/ --include='*.ts'
#   Run manually at phase gate to verify no unnamed integer literals >= 10 remain.
#   ESLint's simSafetyConfig + reviewer grep together satisfy SCEN-05 for Phase 5.
#
# NOTE ON PATTERN: The original RESEARCH.md pattern uses \b word-boundary and (?!=)
# negative-lookahead which require GNU grep (Linux). This script uses BSD-compatible
# ERE syntax: (^|[^[:alnum:]_]) for word-break and =[^=] for single-assignment.
# The pattern is deliberately broad and may produce false positives (e.g., == comparisons) —
# reviewer eyeballs each hit. False negatives (missed writes) are the real risk.

set -euo pipefail

# Any assignment, compound assignment, or UpdateExpression touching a WorldState
# sim-state field at ANY depth in non-sim layers.
# Matches: world.tick = 0, worldState.rngState += 5, world.tick++, --world.nextEntityId
# May also match: world.tick == x (false positive — review and dismiss)
# Does NOT match: newerworld.tick = 0 (word-break at start)
PATTERN='(^|[^[:alnum:]_])(world|worldState|w)\.[a-zA-Z_][a-zA-Z0-9_]*.*(=[^=]|[+][+]|--|[+]=|-=|[*]=|/=)'

HITS=$(grep -rnE "$PATTERN" src/render src/input src/platform --include='*.ts' --exclude='*.test.ts' \
  | grep -v '\.commandQueue' \
  || true)

if [[ -n "$HITS" ]]; then
  echo "FNDN-07 violation candidates (review each):"
  echo "$HITS"
  echo ""
  echo "Expected: every hit is either (a) reading sim state, or (b) a false positive."
  echo "Any actual write to a non-commandQueue WorldState field must be replaced"
  echo "with a SimCommand push per PRD §5."
  exit 1
fi
echo "FNDN-07 grep guard: clean."
