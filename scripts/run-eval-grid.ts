// scripts/run-eval-grid.ts
// Cartesian eval: seeds × scenarios × policies → JSON summary + pass/fail counts.
//
// Run:
//   node --experimental-strip-types scripts/run-eval-grid.ts --
//   node --experimental-strip-types scripts/run-eval-grid.ts -- --max-ticks 80 --seeds 1,2 --scenarios default,invasion_probe --policies noop
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.js')) {
        const tsSpec = specifier.slice(0, -3) + '.ts';
        try { return await nextResolve(tsSpec, context); } catch (_) {}
      }
      return nextResolve(specifier, context);
    }
  `),
  pathToFileURL('./'),
);

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const {
  runEvalGrid,
  DEFAULT_EVAL_SEEDS,
  DEFAULT_EVAL_SCENARIOS,
  DEFAULT_EVAL_POLICIES,
} = await import('../src/sim-agent/eval-grid.js');

const args = parseArgs(process.argv.slice(2));
const maxTicks = Number(args['max-ticks'] ?? '120');
const opponentMode = args['opponent'] === 'ai' ? 'ai' : 'none';

const seeds =
  args['seeds'] !== undefined
    ? args['seeds'].split(',').map((s) => Number(s.trim()))
    : [...DEFAULT_EVAL_SEEDS];
const scenarioIds =
  args['scenarios'] !== undefined
    ? args['scenarios'].split(',').map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_EVAL_SCENARIOS];
const policies =
  args['policies'] !== undefined
    ? (args['policies'].split(',').map((s) => s.trim()).filter(Boolean) as ('noop' | 'heuristic')[])
    : [...DEFAULT_EVAL_POLICIES];

if (!Number.isFinite(maxTicks) || maxTicks < 1) {
  console.error(
    'Usage: node --experimental-strip-types scripts/run-eval-grid.ts -- ' +
      '[--max-ticks N] [--seeds 1,2,3] [--scenarios a,b] [--policies noop,heuristic] [--opponent none|ai]',
  );
  process.exit(1);
}

for (const p of policies) {
  if (p !== 'noop' && p !== 'heuristic') {
    console.error(`Unknown policy: ${p} (allowed: noop, heuristic)`);
    process.exit(1);
  }
}

const grid = runEvalGrid({ seeds, scenarioIds, policies, maxTicks, opponentMode });
console.log(JSON.stringify(grid));

if (grid.summary.failed > 0) {
  process.exitCode = 1;
}
