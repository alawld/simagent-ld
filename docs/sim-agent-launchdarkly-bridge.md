# LaunchDarkly bridge — AI Config, experimentation, and Subterrans

This repo emits **deterministic episode JSON** so an **external orchestrator** can pair LaunchDarkly (**AI Config**, flags, experimentation) with simulations. **Do not embed the LaunchDarkly SDK in game code** — keep keys and evaluation context in your bridge service or batch runner.

## End-to-end loop

1. **Build evaluation context** — Whatever your LD integration uses (`user`, `anonymous`, targeting key, etc.).
2. **Resolve variation** — AI Config / flag evaluation returns payload (model id, temperature, policy weights, …) and **`variationKey`** (or equivalent).
3. **Run simulations** — For each variation assignment, run one or more episodes with **fixed** `scenarioId`, `maxTicks`, `opponentMode`, and **documented seeds** so comparisons are fair.
4. **Emit metrics** — Parse each **`sim-agent-episode/1`** JSON line; call LD **`track`** (custom metrics) using the **same evaluation context** from step 1. Map numeric fields you care about (see tables below).
5. **Experimentation** — LD aggregates results; you promote winners or schedule the next iteration.
6. **Repeat** — Next batch resolves fresh assignments; pass **`--ld-iteration`** (or your own id) so rows remain attributable across waves.

Fairness rule: **never** compare episodes that differ only by undocumented RNG unless that is intentional — control **`seed`** explicitly (`seed`, **`--repeat`**, or **`--seeds`**).

## CLI: one line vs NDJSON

| Invocation | Stdout |
|------------|--------|
| Default single episode | **One** JSON object |
| **`--repeat N`** (`N > 1`) | **N** lines — seeds `seed`, `seed+1`, … |
| **`--seeds a,b,c`** | **One line per seed** (overrides **`--repeat`**) |

Same **`--ld-*`** echo is attached to **every** line in a batch so all rows share attribution for that orchestrator run.

Example (statistical batch, same LD attribution):

```bash
npm run sim:episode -- --repeat 50 --seed 100 --max-ticks 800 --scenario-id default \
  --ld-experiment subterrans-policy-v3 --ld-variation cfg-7b --ld-iteration run-2026-05-06a
```

Example (explicit seed list for an A/B matrix you manage elsewhere):

```bash
npm run sim:episode -- --seeds 1,5,9,13 --max-ticks 500 --policy noop \
  --ld-variation baseline-smoke
```

## Episode JSON shape (`sim-agent-episode/1`)

Filter NDJSON streams with **`schema === "sim-agent-episode/1"`** (constant **`SIM_AGENT_EPISODE_SCHEMA_VALUE`** in `src/sim-agent/episode-metrics-catalog.ts`).

Stable identifiers:

| Field | Meaning |
|-------|---------|
| **`metricsVersion`** | Bump when **`metrics`** semantics change — gate dashboards when upgrading this repo. |
| **`seed`** | World RNG / scenario instance for this row. |
| **`scenarioId`** | Curriculum label (`createTrainingWorld`). |
| **`launchDarkly`** | Optional echo of **`experimentKey`**, **`variationKey`**, **`iterationId`** from CLI / harness. |

## Suggested custom metrics (LaunchDarkly)

Register **1–3 primary** metrics per experiment to avoid dilution. Starting points:

| JSON path | Typical use |
|-----------|-------------|
| `metrics.victory` | Win rate |
| `metrics.defeat` | Loss rate |
| `metrics.finalTick` | Shorter can mean faster win or faster loss — interpret with `outcome` |
| `metrics.playerFoodTotal` | Economy quality |
| `wallClockMs` | Runner cost (not sim time) |
| `terminalReached` | Did the episode end naturally vs cap |
| `metrics.cappedAtMaxTicks` | Hung / stalemate indicator |

**`metrics.scenarioExtras.*`** — sparse curriculum signals (`playerSurfaceWorkerCount`, …). Keys depend on **`scenarioId`**; see `src/sim-agent/episode-metrics.ts`. Register only for scenarios you train on.

Full leaf list under **`metrics.*`**: **`SIM_AGENT_METRICS_DOT_PATHS`** in **`episode-metrics-catalog.ts`**.

## What stays outside this repository

- LaunchDarkly **SDK**, API keys, **secure mode**, and **evaluation context** construction.
- Deciding **which** `variationKey` to run next (LD experimentation UI / API vs your scheduler).
- **HTTP** service wrapping **`npm run sim:jsonl-session`** or **`runEpisode`** — optional; not required for metrics export.

## Regression vs experimentation

| Tool | Role |
|------|------|
| **`npm run sim:eval-grid`** | Fixed grid of seeds × scenarios × policies — **CI / no regression**. Exit **1** if thresholds fail. |
| **`npm run sim:episode`** | **Variation comparison** — feed rows to LD or a warehouse; use **`--ld-*`** for joins. |

Do not treat eval-grid cells as a substitute for episode-level LD attribution — different goals.

## Related

- Roadmap: **`SimAgentPlan.md`** §11  
- MDP / harness: **`docs/sim-agent-mdp.md`**  
- Metric keys (machine-readable): **`src/sim-agent/episode-metrics-catalog.ts`**
