# Sim agent — MDP contract (reference)

Single-page summary for RL / planners: how **`SimAgentHarness`** exposes a Markov decision process **without changing sim rules** (`tick` remains the only transition).

## State

**Partial observability** from the trainer’s perspective is whatever **`SimAgentObservation`** exposes after each **`step`** (`observationVersion`, **`scalars`**, **`affordances`**, **`taskZone`**, **`opponent`**, **`spatial`** — see `src/sim-agent/types.ts` and `observation-channels.ts`). The underlying **`WorldState`** is richer; agents should not rely on hidden fields unless you extend observations.

**Session metadata:** **`scenarioId`** (curriculum label → **`createTrainingWorld`**), **`tick`** (integer time index).

## Actions

**Atomic decisions** per **`step`** call: a batch **`AgentSimCommand[]`** (omit **`issuedAtTick`**). The harness stamps **`issuedAtTick: world.tick`** and concatenates after optional opponent commands.

**Action space** is the **`SimCommand`** union (`src/sim/commands.ts`): **`NoOp`**, **`SetBehaviorRatio`**, **`MarkDigTile`**, **`MarkFoodPile`**, **`CancelDigMark`**, **`PlaceChamber`**, **`DesignateEntrance`**, **`SetRallyPoint`**, **`ClearRallyPoint`**. Invalid commands are **silently dropped** inside **`tick`** step 1 (same as the game); **`peekApplicability`** / **`evaluateCommandApplicability`** preview those gates.

**Constraints:** at most **`MAX_COMMANDS_PER_TICK`** (64) commands queued before drain per tick (harness throws if exceeded).

## Transition

One **`step`** advances one or more **simulation ticks** via **`repeatTicks`** (default **1**): the same **`commands`** batch is applied only on the **first** tick of the batch; remaining ticks run with **no** additional player commands (useful for cheap “wait” / batched self-play). Ordering matches **`GameScene`**: optional **`runAIController`** per enemy colony, then player stamp + **`tick(world, drained)`**. Dynamics are **deterministic** given **`seed`**, **`scenarioId`**, and the command stream.

## Remote control (JSONL)

**`npm run sim:jsonl-session`** reads **stdin** one JSON object per line and prints one JSON response per line (`dispatchJsonlRequest` in **`jsonl-session.ts`**). Operations: **`session`** (replace harness), **`reset`**, **`step`** (optional **`repeatTicks`**), **`observe`** ( **`getObservation()`** without ticking ), **`ping`**, **`pause`** / **`resume`**, **`loadSnapshot`** ( **`SerializedWorldState`** from **`platform/save.ts`** ), **`exportSnapshot`**. Same observation schema as **`step`** responses.

## Pause & snapshots

**`setPaused(true)`** makes **`step`** a no-op (observation only); **`runEpisode`** throws until **`resume`**. **`loadSnapshot(serialized)`** replaces **`world`** from **`serializeWorldState` / `deserializeWorldState`** (clears input log, recomputes **`terminal`** via **`checkQueenDeath`**). **`getSerializedWorldState()`** exports the current world JSON shape.

## Reward

**Not defined in `src/sim/`** (SimAgentPlan Phase F). Trainers define **`reward(obs, cmds, nextObs, outcome)`** outside the harness or wrap **`runEpisode`**.

## Terminal states

**`GameOutcome`** from **`step`** / **`runEpisode`**: **`None`** (continue), **`Victory`**, **`Defeat`**, **`MutualDestruction`**. When not **`None`**, the harness sets **`terminal`** and stops advancing unless **`reset(seed)`**.

## Scenario

**Initial state distribution:** **`createTrainingWorld(scenarioId, seed)`** (`src/sim/training-scenarios.ts`). Unknown **`scenarioId`** falls back to **`createScenario(seed)`**.

## Replay equivalence

**`(seed, scenarioId, inputLog)`** from **`buildSessionRecording`** / **`sim:export-session`** reproduces final **`WorldState`** via **`replaySessionRecording`** (group **`inputLog`** by **`issuedAtTick`** then **`tick`** only). See **`docs/sim-agent-commands.md`**.

## Related

- Command shapes & legality: **`docs/sim-agent-commands.md`**
- LaunchDarkly / experimentation bridge (orchestrator outside repo): **`docs/sim-agent-launchdarkly-bridge.md`**
- Roadmap: **`SimAgentPlan.md`**
