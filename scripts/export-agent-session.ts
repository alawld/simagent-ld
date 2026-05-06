// One JSON line: SimAgentSessionRecording (seed, scenarioId, inputLog, …) for imitation / BC datasets.
//
// Run:
//   npm run sim:export-session -- --seed 7 --max-ticks 30 --opponent none
//
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

const { SimAgentHarness, buildSessionRecording } = await import('../src/sim-agent/harness.js');
const { createNoOpPolicy, createHeuristicRatioPolicy, createCommandsFilePolicy } = await import(
  '../src/sim-agent/policies.js',
);

const args = parseArgs(process.argv.slice(2));
const seed = Number(args['seed'] ?? '1');
const maxTicks = Number(args['max-ticks'] ?? '100');
const scenarioId = args['scenario-id'] ?? 'default';
const opponentMode = args['opponent'] === 'none' ? 'none' : 'ai';
const policyName = (args['policy'] ?? 'noop').toLowerCase();
const commandsFile = args['commands-file'];

if (!Number.isFinite(seed) || !Number.isFinite(maxTicks) || maxTicks < 0) {
  console.error(
    'Usage: npm run sim:export-session -- [--seed N] [--max-ticks N] [--scenario-id ID] ' +
      '[--opponent ai|none] [--policy noop|heuristic] [--commands-file PATH]',
  );
  process.exit(1);
}

if (commandsFile !== undefined && policyName !== 'noop' && policyName !== '') {
  console.error('Use either --commands-file or --policy, not both.');
  process.exit(1);
}

const harness = new SimAgentHarness({
  seed,
  scenarioId,
  opponentMode,
  recordInputLog: true,
});

const getCommands =
  commandsFile !== undefined
    ? createCommandsFilePolicy(commandsFile)
    : policyName === 'heuristic'
      ? createHeuristicRatioPolicy()
      : createNoOpPolicy();

harness.runEpisode({ maxTicks, getCommands });

const recording = buildSessionRecording(harness);
console.log(JSON.stringify(recording));
