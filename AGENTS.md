# Subterrans — Contributor Guide

A modern ant colony simulation game — a spiritual successor to SimAnt (1991) with a retro pixel aesthetic and contemporary design.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Rendering:** Phaser 3
- **Testing:** Vitest (unit/integration), Playwright (browser/E2E)
- **Build:** Vite (tentative, finalized during PRD)
- **Target:** Web browsers (Chrome, Firefox, Safari, Edge — latest two versions)

## Directory Layout

```
src/
  sim/        # Pure TypeScript simulation. SACRED BOUNDARY — no Phaser, no DOM, no browser APIs.
  render/     # Phaser-specific rendering. Reads sim state, never writes to it.
  input/      # Translates browser/device input into simulation commands.
  platform/   # Platform abstractions: storage, audio stubs, feature detection.
assets/
  sprites/    # Sprite sheets and tilesets (Phase 2; Phase 1 uses Graphics API).
  audio/      # Sound effects and music (Phase 2).
  fonts/      # Custom fonts.
docs/         # Additional documentation for contributors.
```

## Architectural Principles (Summary)

These are non-negotiable. See [ARCHITECTURE.md](ARCHITECTURE.md) for full explanations and code examples.

1. **Strict sim/render separation** — `src/sim/` has zero dependencies on Phaser, the DOM, or any browser API. It must run in Node.js unchanged.
2. **Fixed 20 Hz timestep** — Simulation advances exactly 50ms per tick. Rendering interpolates at display framerate. Variable delta time is forbidden.
3. **Lightweight ECS-flavored architecture** — Entities are integer IDs, components are typed arrays or maps, systems are pure functions. No classes for entities. No ECS library in Phase 1.
4. **Seeded deterministic PRNG** — Single Mulberry32 instance per world. `Math.random()` is banned in `src/sim/`.
5. **No wall-clock time in simulation** — `Date`, `performance.now()`, and all real-time APIs are banned in `src/sim/`. Time = tick count.
6. **Fixed-point integer math** — All simulation quantities are integers (1 tile = 256 units). Floats are banned in `src/sim/`.
7. **Snapshot saves with replay logging** — JSON world snapshots + input log. Same seed + same inputs = same output.

## Multi-Platform Constraints

Phase 1 targets web only. The architecture preserves portability for native wrappers (Capacitor, Tauri) in later phases.

**Banned in `src/sim/`:** Any browser API, any rendering API, `Math.random()`, `Date`/`performance.now()`, floating-point arithmetic.

**Banned in `src/render/` and `src/input/`:** Direct writes to simulation state. These layers read sim state and produce commands; they never mutate it.

**Abstraction boundary:** Platform-specific concerns (storage, audio, input devices) go through `src/platform/`, which exposes a stable interface that `src/sim/` never imports. Only `src/render/`, `src/input/`, and the top-level game loop import from `src/platform/`.

## Testing Requirements

- **`src/sim/`**: Full test coverage. Every system function, every component store operation, every edge case. These are pure functions operating on data — they are trivially testable.
- **`src/render/`, `src/input/`, `src/platform/`**: Smoke tests. Verify initialization, basic rendering, input translation.
- **Deterministic replay tests**: A recorded input sequence + seed must always produce the same final world state. These tests catch non-determinism bugs.
- **All tests run in CI** on every push and PR.

## PR Review Process

Every PR is reviewed by two AI agents independently:

1. **Claude Code** — Reviews via the `subterrans-pr-review` skill (architectural compliance, principle violations, code quality).
2. **Codex** — Independent review for a second perspective.

Either reviewer can block; both must approve for merge (or owner override). The review checklist includes:

- [ ] No imports crossing the `src/sim/` boundary
- [ ] No `Math.random()`, `Date`, `performance.now()` in `src/sim/`
- [ ] No floating-point arithmetic in `src/sim/`
- [ ] No classes for simulation entities
- [ ] No variable timestep usage
- [ ] Tests cover new simulation logic
- [ ] Deterministic replay is not broken (replay tests pass)

## Building and Running

```bash
cd code/
npm install
npm run dev       # Start dev server (once scaffold is in place)
npm run test      # Run Vitest
npm run test:e2e  # Run Playwright
```

## Note

This repository is the public, open-source portion of a larger project. Research, planning, and internal design documents live in a separate private repository.
