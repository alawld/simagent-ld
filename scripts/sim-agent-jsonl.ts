// Bidirectional JSONL session on stdin/stdout — one JSON request per line, one JSON response per line.
// Protocol: `src/sim-agent/jsonl-session.ts` (`op`: session | reset | step | observe | ping).
//
//   npm run sim:jsonl-session
//   echo '{"op":"ping"}' | npm run sim:jsonl-session
//
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline';

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
const { dispatchJsonlRequest } = await import('../src/sim-agent/jsonl-session.js');

const args = parseArgs(process.argv.slice(2));
const seed = Number(args['seed'] ?? '1');
const scenarioId = args['scenario-id'] ?? 'default';
const opponentMode = args['opponent'] === 'none' ? 'none' : 'ai';

if (!Number.isFinite(seed)) {
  console.error(
    'Usage: npm run sim:jsonl-session -- [--seed N] [--scenario-id ID] [--opponent ai|none]',
  );
  process.exit(1);
}

const cell = {
  harness: new SimAgentHarness({
    seed,
    scenarioId,
    opponentMode,
    recordInputLog: false,
  }),
};

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const trimmed = line.trim();
  if (trimmed.length === 0) continue;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    console.log(JSON.stringify({ ok: false, error: 'invalid JSON' }));
    continue;
  }
  const response = dispatchJsonlRequest(cell, raw);
  console.log(JSON.stringify(response));
}
