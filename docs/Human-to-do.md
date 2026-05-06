# Human to-do — wiring Subterrans into your stack

This repo ships **deterministic simulations** and **JSON episode rows** you can consume from CI or an experimentation pipeline. Anything involving **secrets**, **LaunchDarkly SDK calls**, or **business logic about which variant runs next** lives **outside** this repository — that is what you still need to build or configure.

---

## 1. LaunchDarkly (AI Config, flags, experimentation)

| Task | Owner | Notes |
|------|--------|------|
| Create **custom metrics** in LaunchDarkly that match fields you will send from episode JSON | Human | Start from **`SIM_AGENT_METRICS_DOT_PATHS`** in `src/sim-agent/episode-metrics-catalog.ts` and the tables in **`docs/sim-agent-launchdarkly-bridge.md`**. Prefer **1–3 primary metrics** per experiment. |
| Ensure **evaluation context** used for **`variation` / AI Config** resolution is the **same context** you pass into **`track`** when recording outcomes | Human | If these diverge, attribution breaks and experiments lie. |
| Store **LD SDK keys** only in your orchestrator / secrets manager — **not** in this repo | Human | This codebase deliberately has **no** LaunchDarkly SDK. |
| Map **AI Config payload** (model id, parameters, policy knobs) → whatever actually drives the agent | Human | This repo exposes **`noop`**, **`heuristic`**, and **`--commands-file`** from CLI; **custom agents** use **`SimAgentHarness.runEpisode({ getCommands })`** from TypeScript in **your** package or service. |

**Reference:** **`docs/sim-agent-launchdarkly-bridge.md`**

---

## 2. Orchestrator / bridge service (you implement)

| Task | Notes |
|------|--------|
| After LD returns a **variation**, spawn runs with fixed **`scenarioId`**, **`maxTicks`**, **`opponentMode`**, and **explicit seeds** so comparisons are fair | Use **`npm run sim:episode`** with **`--seed`**, **`--repeat N`**, or **`--seeds a,b,c`** (NDJSON on stdout). |
| Parse **each stdout line** as **`sim-agent-episode/1`** (`schema` field); ignore stderr noise | Filter with **`schema === "sim-agent-episode/1"`** if your stream mixes logs. |
| Echo **`--ld-experiment`**, **`--ld-variation`**, **`--ld-iteration`** from the orchestrator into the CLI so **every JSON row** carries attribution | Already supported by **`scripts/run-agent-episode.ts`**. |
| Call LD **`track`** (or equivalent) per episode with numeric metrics + **same eval context** as step 1 | Map paths like **`metrics.victory`**, **`metrics.finalTick`**, **`wallClockMs`**, etc. |
| Decide **iteration schedules** (how many seeds per variant, when to advance “waves”) | Product/process — not defined in-repo. |

---

## 3. Infrastructure & ops

| Task | Notes |
|------|--------|
| **Node version** for CLI scripts | **`package.json`** `engines`: **>= 22**. CI uses **22**. Avoid relying on **`--experimental-strip-types`** quirks on untested Node majors. |
| **Where jobs run** | Your runner (GitHub Actions in *your* repo, Kubernetes, laptop, etc.) must invoke **`npm ci`** / **`npm run sim:episode`** (or import harness from a workspace that depends on this package). |
| **Secrets** | LD keys, API tokens, any model endpoints — only in your deployment environment. |

---

## 4. Regression vs experimentation (do not conflate)

| Mechanism | Purpose |
|-----------|---------|
| **`npm run sim:eval-grid`** | Fixed grid + thresholds — **CI / regression** in **this** repo’s workflow (`.github/workflows/ci.yml`). Exit **1** on failure. |
| **`npm run sim:episode`** | Per-row metrics for **variants** — feed to LD or a warehouse; **not** a substitute for eval-grid semantics. |

Humans maintaining **your** LD experiments should still keep **eval-grid green** when upgrading this dependency (or pin versions).

---

## 5. Optional follow-ups (human product choices)

| Task | When |
|------|------|
| **Warehouse / BI** — stream NDJSON to Snowflake, BigQuery, etc. | When you outgrow LD-only dashboards. |
| **HTTP wrapper** around **`sim:jsonl-session`** | When trainers cannot shell out to Node. Not shipped here yet (**SimAgentPlan** Phase A transport). |
| **Pin `metricsVersion`** in dashboards | When this repo bumps **`SIM_AGENT_METRICS_VERSION`** — see **`SimAgentPlan.md`** §3 / §11. |

---

## 6. Repo docs index (for humans)

| Doc | Use |
|-----|-----|
| **`docs/sim-agent-launchdarkly-bridge.md`** | LD loop, NDJSON, fairness, metric paths |
| **`docs/sim-agent-mdp.md`** | Harness MDP contract |
| **`docs/sim-agent-commands.md`** | Commands, CLI, legality |
| **`SimAgentPlan.md`** | Full roadmap and status |

---

*Subterrans stays a **simulation + metrics emitter**; humans wire **identity**, **experimentation**, **secrets**, and **scheduling** around it.*
