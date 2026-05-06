// scripts/run-agent-episode.ts
// One JSON line per episode on stdout (NDJSON when --repeat N>1 or --seeds a,b,c).
//
// Run:
//   node --experimental-strip-types scripts/run-agent-episode.ts -- --seed 42 --max-ticks 2000
//   node --experimental-strip-types scripts/run-agent-episode.ts -- --repeat 20 --seed 1 --max-ticks 500
//   node --experimental-strip-types scripts/run-agent-episode.ts -- --seeds 1,2,3,4,5 --max-ticks 300
//   node --experimental-strip-types scripts/run-agent-episode.ts -- --seed 1 --scenario-id invasion_probe --policy heuristic
//   node --experimental-strip-types scripts/run-agent-episode.ts -- --commands-file ./my-ticks.jsonl
//
// Uses the same .js→.ts resolve hook as scripts/run-sim.ts (see that file for rationale).
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

const { SimAgentHarness } = await import('../src/sim-agent/harness.js');
const { createNoOpPolicy, createHeuristicRatioPolicy, createCommandsFilePolicy } = await import(
  '../src/sim-agent/policies.js',
);

const args = parseArgs(process.argv.slice(2));
const seed = Number(args['seed'] ?? '1');
const repeat = Number(args['repeat'] ?? '1');
const seedsCsv = args['seeds'];
const maxTicks = Number(args['max-ticks'] ?? '500');
const scenarioId = args['scenario-id'] ?? 'default';
const opponentMode = args['opponent'] === 'none' ? 'none' : 'ai';
const policyName = (args['policy'] ?? 'noop').toLowerCase();
const commandsFile = args['commands-file'];
const ldExperiment = args['ld-experiment'];
const ldVariation = args['ld-variation'];
const ldIteration = args['ld-iteration'];

let seeds: number[];
if (seedsCsv !== undefined) {
  seeds = seedsCsv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (seeds.length === 0) {
    console.error('--seeds must list at least one finite number (comma-separated).');
    process.exit(1);
  }
} else {
  if (!Number.isFinite(repeat) || repeat < 1 || !Number.isInteger(repeat)) {
    console.error('--repeat must be a positive integer.');
    process.exit(1);
  }
  if (!Number.isFinite(seed)) {
    console.error('--seed must be finite when using --repeat.');
    process.exit(1);
  }
  seeds = Array.from({ length: repeat }, (_, i) => seed + i);
}

if (!Number.isFinite(maxTicks) || maxTicks < 0) {
  console.error(
    'Usage: node --experimental-strip-types scripts/run-agent-episode.ts -- ' +
      '[--seed N] [--repeat N] [--seeds a,b,c] [--max-ticks N] [--scenario-id ID] [--opponent ai|none] ' +
      '[--policy noop|heuristic] [--commands-file PATH] ' +
      '[--ld-experiment K] [--ld-variation K] [--ld-iteration K]',
  );
  process.exit(1);
}

if (commandsFile !== undefined && policyName !== 'noop' && policyName !== '') {
  console.error('Use either --commands-file or --policy, not both.');
  process.exit(1);
}

const getCommands =
  commandsFile !== undefined
    ? createCommandsFilePolicy(commandsFile)
    : policyName === 'heuristic'
      ? createHeuristicRatioPolicy()
      : createNoOpPolicy();

const launchDarkly =
  ldExperiment !== undefined || ldVariation !== undefined || ldIteration !== undefined
    ? {
        ...(ldExperiment !== undefined ? { experimentKey: ldExperiment } : {}),
        ...(ldVariation !== undefined ? { variationKey: ldVariation } : {}),
        ...(ldIteration !== undefined ? { iterationId: ldIteration } : {}),
      }
    : undefined;

for (let i = 0; i < seeds.length; i++) {
  const episodeSeed = seeds[i]!;
  const harness = new SimAgentHarness({
    seed: episodeSeed,
    scenarioId,
    opponentMode,
    recordInputLog: true,
  });

  const episode = harness.runEpisode({
    maxTicks,
    getCommands,
    ...(launchDarkly !== undefined ? { launchDarkly } : {}),
  });

  console.log(JSON.stringify(episode));
}
