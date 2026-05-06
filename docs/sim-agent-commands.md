# Sim agent — command shapes and legality

Headless trainers issue the same **`SimCommand`** union the game feeds into **`tick(world, commands)`** (see [`src/sim/commands.ts`](../src/sim/commands.ts)). The harness accepts **`AgentSimCommand`**: the same variants with **`issuedAtTick` omitted** — the harness stamps `issuedAtTick: world.tick` before enqueue + drain.

## Limits

- **`MAX_COMMANDS_PER_TICK`** (64) — at most this many commands run in step 1 per tick. Extra commands are **silently dropped** (FIFO cap). The harness throws if the queue would exceed this after AI + player commands; split work across ticks.

## Variants (omit `issuedAtTick` in JSON / `AgentSimCommand`)

| `type` | Fields (besides stamped `issuedAtTick`) |
|--------|----------------------------------------|
| `NoOp` | — |
| `SetBehaviorRatio` | `colonyId`, `ratio: { forage, fight }` (legacy `{ dig }` shapes are migrated in `tick`; applicability mirrors those guards) |
| `MarkDigTile` | `colonyId`, `tileX`, `tileY` |
| `MarkFoodPile` | `colonyId`, `tileX`, `tileY` (surface pile coords) |
| `CancelDigMark` | `colonyId`, `tileX`, `tileY` |
| `PlaceChamber` | `colonyId`, `chamberType`, `anchorTileX`, `anchorTileY` |
| `DesignateEntrance` | `colonyId`, `surfaceTileX`, `surfaceTileY` |
| `SetRallyPoint` | `colonyId`, `tileX`, `tileY` |
| `ClearRallyPoint` | `colonyId` |

## Legality hints (no gameplay fork)

**`evaluateCommandApplicability(world, cmd)`** in [`src/sim/command-applicability.ts`](../src/sim/command-applicability.ts) returns **`{ applicable: true }`** or **`{ applicable: false, code: string }`**, mirroring the **read-only** guards in **`tick`** step 1 (silent drops). It does **not** mutate the world and does **not** call **`allocateEntityId`**.

**`SimAgentHarness.peekApplicability(cmd)`** stamps `issuedAtTick` and calls **`evaluateCommandApplicability`** on the current world — same outcome as legality for that tick’s command stream, aside from ordering when multiple commands compete (each is still evaluated against the **pre-tick** world in `tick`; the harness preview is **current** queue state + world before your next `step`).

When **`evaluateCommandApplicability`** is false, **`tick`** does not apply that command’s effects for step 1. **`MarkFoodPile`** remains “applicable” when the pile exists even if the handler toggles priority off (same as `tick`).

## Observations (`SimAgentObservation`)

- **`observationVersion: 3`** — `scalars` (B1), **`affordances`** (marked dig / food piles / entrances), **`taskZone`** (B2: `taskByKind`, `zoneByKind` for alive player-colony ants), **`opponent`** (B4: enemy colony count, queen alive, worker sum, fighting-ant sum — uses all non-player colonies in the world), **`spatial`** (B3: row-major 4×4 **`surfaceTiles4x4`** and **`undergroundTiles4x4`** around rally → entrance → PRD start, and queen-underground → else shaft focal; raw terrain state bytes). **Not included yet:** pheromone slices, larger/downsampled maps.
- Builders: `src/sim-agent/observation-channels.ts`.

## JSONL session (stdin/stdout)

Line-delimited JSON RPC over **`npm run sim:jsonl-session`** — see **`src/sim-agent/jsonl-session.ts`** and **`docs/sim-agent-mdp.md`**. Request **`op`**: **`session`**, **`reset`**, **`step`**, **`observe`**, **`ping`**, **`pause`**, **`resume`**, **`loadSnapshot`** (body: **`snapshot`**: serialized world), **`exportSnapshot`**.

## Episode metrics CLI (`npm run sim:episode`)

One JSON object per episode on stdout; **`--repeat N`** or **`--seeds a,b,c`** prints **NDJSON**. Optional **`--ld-experiment`**, **`--ld-variation`**, **`--ld-iteration`** echo on every line for external experimentation sinks — see **`docs/sim-agent-launchdarkly-bridge.md`**.

## Session recording (imitation / replay)

- **`SimAgentSessionRecording`** (`schema: sim-agent-session/1`) — JSON bundle: `seed`, `scenarioId`, `opponentMode`, `playerColonyId`, **`finalTick`** (`world.tick` after the run), **`inputLog`** (full drained stream). Built with **`buildSessionRecording(harness)`** after **`step`** / **`runEpisode`**.
- **`replaySessionRecording`** (`src/sim-agent/replay-input-log.ts`) — **`resetFlowFieldCaches`**, **`createTrainingWorld`**, then **`tick(world, cmds[t])`** for `t ∈ [0, finalTick)`. Does not re-run AI; opponent behavior is already encoded in **`inputLog`** when you recorded with **`opponentMode: 'ai'`**.
- **CLI:** **`npm run sim:export-session`** — same policy wiring as **`npm run sim:episode`** (`--policy`, `--commands-file`, `--opponent`, …); prints **one JSON line** suitable for datasets or offline replay validation.

## MDP reference

See **`docs/sim-agent-mdp.md`** for state / action / transition / terminal semantics.

## Related types

- **`SimCommand`** / **`MAX_COMMANDS_PER_TICK`** — `src/sim/commands.ts`
- **`AgentSimCommand`**, **`SimAgentObservation`** — `src/sim-agent/types.ts`
