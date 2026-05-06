# Sim Agent Plan

Roadmap for a **headless agent interface** to teach models (RL, BC, LLM tool-use) to play Subterrans without driving the browser UI. The sim already exposes the right seam: **`tick(world, commands)`**, typed **`SimCommand`**, **`createScenario(seed)`**, deterministic replay, and **`GameOutcome`**.

**Related docs:** [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md). **Headless harness:** `src/sim-agent/harness.ts`, `src/sim-agent/types.ts`, `src/sim-agent/observation-channels.ts`, `src/sim-agent/session-recording.ts`, `src/sim-agent/replay-input-log.ts`, `src/sim-agent/episode-metrics.ts`, `src/sim-agent/policies.ts`, tests `src/sim-agent/*.test.ts`. **Curriculum worlds (sim):** `src/sim/training-scenarios.ts` + `src/sim/training-scenarios.test.ts`. **Episode NDJSON (CI / metrics sinks):** `npm run sim:episode` → `scripts/run-agent-episode.ts` (`--policy noop|heuristic`, `--commands-file`, `--scenario-id`, …). **Eval grid + pass/fail:** `npm run sim:eval-grid` → `scripts/run-eval-grid.ts`; thresholds in `src/sim-agent/scenario-thresholds.ts`, runner `src/sim-agent/eval-grid.ts`. **Command types:** `src/sim/commands.ts`. **Tick entry:** `src/sim/tick.ts`. **Scenario:** `src/sim/scenario.ts`. **Outcomes:** `src/sim/game-over.ts`. **Human enqueue pattern:** `src/input/*.ts` (`issuedAtTick: world.tick`). **Replay contract:** `appendInputLog` / save tests in `src/platform/save.test.ts`.

---

## 1. What “states” means (three layers)

Build for all three; they stack.

| Layer | Meaning | API surface |
|--------|---------|-------------|
| **Session** | Not playing vs playing vs terminal episode | **`SimAgentHarness`:** `reset`, `step`, **`runEpisode`** (bounded tick loop + episode metrics). Terminal short-circuit when `GameOutcome` ≠ `None`. *Not yet:* `loadSnapshot`, `pause`. |
| **World / MDP** | What the agent sees after each step | **`observationVersion` 3** — B1 **`scalars`**, **`affordances`**, B2 **`taskZone`**, B3 **`spatial`** (4×4 terrain patches), B4 **`opponent`** (see §3 + `observation-channels.ts`). *Not yet:* full `legalActions` bitmask; optional B3 pheromone slices. |
| **Curriculum** | Which scenario family (skill) is active | **`scenarioId`** selects a **`createTrainingWorld(scenarioId, seed)`** factory in `src/sim/training-scenarios.ts` (falls back to vanilla `createScenario` for unknown ids). Labels still work for LD without a named factory. |

Teaching the full game is teaching **skills across curriculum states** with one action vocabulary: **`SimCommand`**.

---

## 2. Phase A — Contract and harness (no UI)

**Goal:** One headless entry point an agent can call repeatedly (Node script, stdio JSONL, or small HTTP server).

| Item | Detail |
|------|--------|
| **Actions** | JSON matching `SimCommand` variants; harness stamps **`issuedAtTick: world.tick`** before push to `world.commandQueue` (mirror input layer). |
| **Step** | `step({ commands, repeatTicks? })` — drain queue per tick, call `tick(world, cmds)` once per tick (or fixed `N` ticks with `[]` for “wait”). |
| **Cap** | Respect **`MAX_COMMANDS_PER_TICK` (64)** in `src/sim/commands.ts`; document split across ticks. |
| **Terminal** | Return **`GameOutcome`** each step: `None`, `Victory`, `Defeat`, `MutualDestruction` (`src/sim/game-over.ts`). |
| **Opponent** | Mirror `GameScene`: before each tick, run **`runAIController(world, enemyColonyId)`** (or config: none / scripted / full AI). |
| **Determinism** | Log `(seed, inputLog)` or serialized state; replay must match existing save/replay tests. |

**Deliverable:** Typed request/response schema with `observationVersion`, `scenarioId`, `tick`, `outcome`.

**Implemented (code):** `SimAgentHarness` in `src/sim-agent/harness.ts` — `step()` returns `SimAgentStepResult` (`tick`, `outcome`, `terminal`, `observation`, `lastDrainedCommands`). Opponent modes: **`none`** | **`ai`** (runs `runAIController` for every non-player colony from `deriveAIColonyIds`, same order as `GameScene`). **Command cap:** if `world.commandQueue.length` would exceed **64** after the AI hook and stamped player commands, the harness **throws** (stricter than `tick`, which silently truncates); callers must split work across ticks — especially when `opponentMode: 'ai'` burns part of the budget. **Still open for Phase A:** HTTP transport, scripted opponent, `loadSnapshot`, pause. **Partial:** bidirectional **stdio JSONL** session via **`npm run sim:jsonl-session`** (`jsonl-session.ts` — `session` / `reset` / `step` / `observe` / `ping`); one-line **NDJSON episode export** via `npm run sim:episode` (see §11).

**Architecture note:** The harness lives under `src/sim-agent/` (not `src/sim/`) and imports **`src/render/ai-controller.ts`** for `runAIController` plus **`src/render/game-scene-logic.ts`** for `deriveAIColonyIds` / `appendInputLog`. That keeps `tick` single-sourced in sim while reusing the shipped AI; a future split could inject a `beforeTick` callback if we ever need a render-free Node binary.

---

## 3. Phase B — Observation design

Avoid dumping raw **`WorldState`** initially. Add channels as training needs them.

| Version | Contents |
|---------|----------|
| **B1 — Scalars** | Player colony: `foodStored`, worker/queen counts, behavior ratio, rally set/clear, entrance count, cheap dig/nest progress stats. **Shipped in obs v2+:** **`scalars`** + **`affordances`**. *Gap vs ideal B1:* no separate “cheap dig / nest progress” stats yet; `foodTotal` ≠ raw `colony.foodStored` alone — see `docs/sim-agent-commands.md`. |
| **B2 — Distributions** | Histograms of `AntTask`, `Zone`, etc. (`src/sim/enums.ts`). **Shipped (obs v3):** **`taskZone.taskByKind`** / **`taskZone.zoneByKind`** for alive player-colony ants (`observation-channels.ts`). |
| **B3 — Spatial** | Fixed windows around nest/queen/rally: downsampled surface tiles, player underground (open/solid/marked), optional pheromone slices (grid keys per colony/type/zone). **Shipped (obs v3):** clamped **4×4** surface + player-underground byte patches (`spatial.*`). **Open:** pheromone slices, larger / multi-scale windows. |
| **B4 — Opponent** | Enemy queen alive, coarse enemy presence — enough for combat/invasion without full symmetry. **Shipped (obs v3):** **`opponent`** block (multi-colony-safe via `deriveAIColonyIds`). |
| **B5 — Curriculum metrics** | Per-scenario success signals (food deposited, chamber done, enemy queen dead, …) in a **`metrics`** object. **v2 shipped (episode):** `metricsVersion: 2` — core fields as in v1 plus **`scenarioExtras`** (`Record<string, number>`), populated for known **`scenarioId`** values (e.g. `invasion_probe` → `playerSurfaceWorkerCount`, `economy_stress` → `playerEntranceFoodStored`, `combat_stance` → `playerFightRatioTarget`). Per-tick **observation** still has no embedded `metrics` (episode end only). |

**Rule:** Bump **`observationVersion`** when shapes or semantics change; add golden-vector tests.

---

## 4. Phase C — Action space completeness

| Command | Skill |
|---------|--------|
| `SetBehaviorRatio` | Macro allocation (forage / fight / dig / nurse). |
| `MarkDigTile` / `CancelDigMark` | Expansion, shafts. |
| `MarkFoodPile` | Forager direction. |
| `PlaceChamber` | Nest layout. |
| `DesignateEntrance` | Surface↔underground connectivity. |
| `SetRallyPoint` / `ClearRallyPoint` | Combat / invasion. |
| `NoOp` | Explicit wait / fixed-size action padding. |

**Phase C2:** Per-command validity hints shipped — **`evaluateCommandApplicability`** / **`peekApplicability`** (see `docs/sim-agent-commands.md`). A dense **`legalActions`** bitmask is still optional / future.

---

## 5. Phase D — Curriculum / scenario library

Default **`createScenario(seed)`** is the **full game** (two colonies, food piles, seeded entrances — see `src/sim/scenario.ts`). Add **named factories** that isolate mechanics (pattern: **`buildInvasionWorld`** in `src/sim/invasion-routing.test.ts`).

Suggested tracks:

1. **Survival / economy** — keep queen fed; ratio-focused; sparse commands.  
2. **Surface foraging** — `MarkFoodPile`, deposit loop.  
3. **Digging / connectivity** — dig marks, shaft completion, `DesignateEntrance`.  
4. **Chambers** — `PlaceChamber` with valid anchors.  
5. **Combat prep** — fight ratio + rally.  
6. **Invasion / cross-grid** — entrance adjacency, fighting, underground routing.  
7. **Full match** — vanilla `createScenario`, enemy AI on.

Each scenario exposes **`scenarioId`** in the observation; a scheduler can **mix** scenarios for curriculum.

**Current code:** `scenarioId` on **`SimAgentHarness`** selects **`createTrainingWorld`** (`default`, `invasion_probe`, `economy_stress`, `combat_stance`, …). Unknown ids still call **`createScenario(seed)`** so custom LD labels do not break. Episode **`metrics.scenarioExtras`** (see §3 B5 / `metricsVersion` 2) adds a few numeric fields per known scenario for richer experiments.

---

## 6. Phase E — Imitation and debugging

- Export **`(seed, inputLog)`** from saves or instrumented sessions → replay in harness for **behavioral cloning**.  
- **Replay parity:** match `serializeWorldState` / existing save tests.  
- **Episode logs:** optional `(observation, action, reward, outcome)` for analysis.

**Progress:** `SimAgentHarness.getInputLog()` mirrors the drained command stream (AI + player per tick) when `recordInputLog` is true (default). **`buildSessionRecording(harness)`** → **`SimAgentSessionRecording`** (`schema: sim-agent-session/1`): **`replaySessionRecording`** uses **`createTrainingWorld(scenarioId, seed)`** + **`buildTicksCommandLists`** + **`tick`** only — deterministic parity with **`serializeWorldState`** (tests cover **`opponentMode: 'none'`** and **`ai`**). **`npm run sim:export-session`** prints one JSON line (same flags as `sim:episode` policy-wise). Row-level `(observation, action, reward)` datasets are still up to trainers combining **`step`** observations with **`inputLog`** slices.

---

## 7. Phase F — Rewards

Define **reward modules per curriculum** in the harness (not inside `src/sim/`):

- Sparse: terminal `GameOutcome` only.  
- Dense: food delta, dig progress, damage avoided, illegal-command penalty, step cost.

---

## 8. Phase G — Hardening

- Fuzz / property tests: random valid command streams do not crash; determinism holds. **Progress:** **`harness-property.test.ts`** + seeded RNG **`harness-rng-fuzz.test.ts`** (random **`AgentSimCommand`** shapes + **`peekApplicability`** → **`NoOp`** fallback; **`opponentMode: ai`** lane).  
- Performance: optional batched stepping for self-play — **`step({ repeatTicks })`** (documented in **`docs/sim-agent-mdp.md`**).  
- Transport: stdio JSONL first → optional HTTP for remote trainers. **Progress:** **`npm run sim:jsonl-session`** (`jsonl-session.ts`); one JSON line per episode to stdout (`sim:episode`). HTTP not started.  
- **Agent MDP spec** (single doc or section): obs shapes, action JSON schema, scenarios, terminal rules. **Done:** **`docs/sim-agent-mdp.md`** (reference MDP contract + links).

---

## 9. Build order (recommended)

1. ~~Headless **reset + step + outcome + enemy tick hook** + replay check.~~ **Done** (`SimAgentHarness` + tests; replay test covers `opponentMode: 'none'`).  
2. ~~**Observation v1** (scalars + small patches).~~ **Done**; **v2** adds **`affordances`** (counts). Bump **`observationVersion`** when shapes change.  
3. ~~**Curriculum v1** (3–5 factories + richer per-scenario **metrics**).~~ **Partially done** — four named worlds in `training-scenarios.ts`, harness wiring, **`scenarioExtras`** on episode metrics, **`evaluateScenarioPass`** thresholds; still open: more tracks (§5 list), curriculum **scheduler** mixing scenarios per run.  
4. ~~**Legality hints** + command documentation.~~ **Done** — `evaluateCommandApplicability` + `SimAgentHarness.peekApplicability`; `docs/sim-agent-commands.md`.  
5. ~~**Observation v2+** (B2–B4 channels).~~ **Baseline done (obs v3)** — `taskZone`, `spatial` (4×4 patches), `opponent`; golden tests in `observation-channels.test.ts`. **Still open:** denser spatial / pheromone (§3 B3), golden vectors for full obs snapshots.  
6. ~~**Imitation pipeline** from `inputLog`.~~ **Done (baseline)** — `session-recording.ts`, `replay-input-log.ts`, **`buildSessionRecording`**, **`npm run sim:export-session`**, tests in **`session-recording.test.ts`**.  
7. ~~**Eval grid:** fixed seeds × scenarios × baselines (random, heuristic, no-op).~~ **Done (baseline)** — `runEvalGrid` + `npm run sim:eval-grid` (`noop` / `heuristic`); exit code **1** if any cell fails thresholds. Random policy not shipped; extend `eval-grid.ts` when needed.

---

## 10. Non-goals (v1)

- Pixel / Phaser-based observations (add only for visuomotor policies).  
- Driving the game via DOM automation (brittle; use `SimCommand` only).  
- Forking sim rules for agents (single source of truth: **`tick`**).

---

## 11. Experimentation export (LaunchDarkly–oriented)

**Goal:** Compare agent / AI Config iterations using numeric episode outcomes — **no LaunchDarkly SDK in this repo** (keys stay in your runner or bridge service).

**What we ship**

- **`SimAgentHarness.runEpisode({ maxTicks, seed?, getCommands?, launchDarkly? })`** → **`SimAgentEpisodeResult`**: stable `schema: "sim-agent-episode/1"`, `metricsVersion`, **`metrics`** (JSON-serializable numbers / booleans), `wallClockMs`, `seed`, `scenarioId`, `opponentMode`, `terminalReached`, `cappedAtMaxTicks`, optional **`launchDarkly`** echo (`experimentKey`, `variationKey`, `iterationId`) for attribution in your metric pipeline.
- **CLI:** `npm run sim:episode -- --seed 42 --max-ticks 2000 [--scenario-id ID] [--opponent ai|none] [--policy noop|heuristic] [--commands-file PATH] [--ld-experiment K] [--ld-variation K] [--ld-iteration K]` prints **one JSON line** to stdout. **`--policy heuristic`** toggles player `SetBehaviorRatio` on a fixed cadence (baseline smoke). **`--commands-file`** is a JSONL file: each **non-empty line** is a JSON **array** of `AgentSimCommand` (omit `issuedAtTick`); line `min(tickIndex, lastLine)` repeats the last line after EOF. Do not combine `--commands-file` with a non-`noop` **`--policy`**. For custom agents, call **`runEpisode({ getCommands })`** from TypeScript.
- **Session export (imitation):** `npm run sim:export-session -- …` prints **`sim-agent-session/1`** JSON (`buildSessionRecording`) — same policy flags as **`sim:episode`** without LD fields.
- **Interactive JSONL:** `npm run sim:jsonl-session -- [--seed …] [--scenario-id …] [--opponent …]` — stdin/stdout protocol (`jsonl-session.ts`).
- **`metricsVersion`:** `2` includes **`scenarioExtras`**; bump when adding keys or changing semantics (§3 rule).
- **Eval grid:** `runEvalGrid({ seeds, scenarioIds, policies, maxTicks, opponentMode? })` → `schema: "sim-agent-eval-grid/1"` with per-cell **`pass` / `reasons`** from **`evaluateScenarioPass(episode)`** (see `scenario-thresholds.ts` header for rules). **`npm run sim:eval-grid --`** defaults: seeds `1,2,3`, all `TRAINING_SCENARIO_IDS`, policies `noop,heuristic`, `maxTicks` 120, **`opponentMode: none`**.

**LaunchDarkly usage (outside this repo)**

1. Define **custom metrics** in LD that match fields you care about (e.g. `metrics.victory`, `metrics.finalTick`, `metrics.playerFoodTotal`, `wallClockMs`).
2. After each episode JSON line, your bridge calls **`track`** / metric events with the **same evaluation context** LD used to assign the variation (`variationKey` from AI Config or flag payload).
3. Keep **1–3 primary metrics** per experiment to avoid dilution.

**Bump `metricsVersion`** when adding or renaming `metrics` fields (see §3 rule).

---

## 12. Status

| Phase | State | Notes |
|-------|--------|--------|
| **A — Harness** | **Landed** | `SimAgentHarness`: `reset`, `step`, **`runEpisode`**, `getSeed`, `opponentMode`, command cap, `getInputLog`, … |
| **A — Transport** | **Partial** | **`sim:jsonl-session`** bidirectional stdin/stdout; **`sim:episode`** NDJSON. HTTP not started. |
| **B — Observation** | **v3 B1+B2+B3+B4 + affordances; episode metrics v2** | Per-step **`scalars`**, **`affordances`**, **`taskZone`**, **`spatial`**, **`opponent`**; **B5** episode `metrics` + **`scenarioExtras`**. Optional B3 pheromone / multi-scale spatial: not done. |
| **C — Actions** | **Legality preview** | Full `SimCommand` / **`AgentSimCommand`**; **`peekApplicability`** + `command-applicability.ts` aligned to `tick` step 1. |
| **D — Curriculum** | **Partial** | `createTrainingWorld` + ids + **`scenarioExtras`** + **`evaluateScenarioPass`**. Missing: more isolated tracks (§5), multi-scenario **scheduler**. |
| **E — Imitation** | **Baseline** | Session **`sim-agent-session/1`** + **`replaySessionRecording`** + export CLI; harness parity tests (`none` + **`ai`**). Per-row BC tables optional. |
| **F — Rewards** | Not started | Keep outside `src/sim/`. |
| **G — Hardening** | **Partial** | Property + RNG fuzz tests; **`docs/sim-agent-mdp.md`**; **`jsonl-session`**. Open: HTTP, heavier RNG coverage, `loadSnapshot`. |

**Quick links:** `src/sim-agent/harness.ts` · `src/sim-agent/types.ts` · `src/sim-agent/jsonl-session.ts` · `src/sim-agent/observation-channels.ts` · `src/sim-agent/session-recording.ts` · `src/sim-agent/replay-input-log.ts` · `src/sim/command-applicability.ts` · `docs/sim-agent-commands.md` · `docs/sim-agent-mdp.md` · `src/sim-agent/episode-metrics.ts` · `src/sim-agent/policies.ts` · `src/sim-agent/scenario-thresholds.ts` · `src/sim-agent/eval-grid.ts` · `src/sim/training-scenarios.ts` · tests · `scripts/run-agent-episode.ts` · `scripts/export-agent-session.ts` · `scripts/sim-agent-jsonl.ts` · `scripts/run-eval-grid.ts`

**Follow-ups:** LD bridge / CI wiring to **`sim:eval-grid`** JSON; **replay with `opponentMode: 'ai'`**; more **§5** factories; tighten **thresholds** per scenario as design locks; full **stdio JSONL** session; `export` from `src/main.ts` if needed; `loadSnapshot` / pause.
