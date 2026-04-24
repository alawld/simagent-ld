# Roadmap

Subterrans is an ant colony simulation in the spirit of SimAnt (1991). This document sketches where the project is today, what's next, and what's probably never going to happen. It is deliberately vague about timing — this is a small project and real schedules are written by reality, not documents.

If something on this list excites you, [CONTRIBUTING.md](CONTRIBUTING.md) explains how to get involved. If something you want is *not* on this list, please read the "Non-Goals" section before opening a PR — and talk to us first for anything significant.

---

## Where We Are Today

The simulation foundation is in place and the game is playable end-to-end at a rough level. Working today:

- **Deterministic simulation** — fixed 20 Hz tick, integer math, seeded PRNG. Same seed + same inputs = same result, every time.
- **Colony lifecycle** — queens, eggs, larvae, workers. Food economy with starvation consequences.
- **Pheromone trails** — food and danger trails with decay; workers follow gradients.
- **Behavior allocation** — the classic SimAnt behavior triangle (forage / dig / nurse) with an auto-nursing floor so broods don't die of neglect.
- **Underground & surface** — per-colony underground grids with excavation, chambers, and nest entrances; a shared surface grid with food piles and foragers crossing the boundary.
- **Dig pathing** — multi-source BFS flow-field so any worker with dig priority converges on the nearest marked tile.
- **Rendering** — Phaser-based surface view, underground view, toggle between them, HUD, minimap, pheromone overlay, behavior triangle widget.
- **Combat** — colony-vs-colony fights on the surface, rally points, fighter AI.
- **Cross-grid invasion** — rallying fighters on an enemy nest entrance sends them underground into the enemy colony.
- **Save/load** — full JSON snapshots preserving determinism; replay from a recorded seed + input log reproduces a session exactly.

The full architectural rules (determinism, sim/render separation, banned APIs) are documented in [ARCHITECTURE.md](ARCHITECTURE.md). They are non-negotiable and apply to all future work.

---

## Near-Term

Concrete work we expect to tackle next. Items here are "next up," not promises.

- **Session flow & win/lose conditions.** Players can start, play, and save — but the game doesn't yet announce a winner or route you back to a new match cleanly.
- **Audio pass.** Platform stubs exist; real SFX and music don't.
- **Sprite art.** Most rendering uses Phaser's Graphics API placeholder shapes. Proper sprites and tilesets are queued.
- **Onboarding & tutorial.** The behavior triangle is opaque if you've never played SimAnt. A first-run tutorial is high-value.
- **UX polish.** Selection feedback, command discoverability, tooltip system, better cursor affordances.
- **Enemy AI variety.** One archetype today; several are planned.
- **Balance pass.** Numbers are sensible, not tuned. Needs playtesting.

---

## Mid-Term

Themes we intend to explore once the near-term work stabilizes. Scope and shape may change.

- **Ant castes.** Soldiers, majors, scouts — giving the behavior triangle more dimensions without making it a spreadsheet.
- **Environmental variety.** Weather, day/night cycles, seasons — things that modulate ant behavior and create rhythm within a session.
- **Scenario editor.** Tools for players (and us) to author custom maps and starting conditions.
- **Replay viewer.** The simulation is deterministic and logs inputs, so a viewer is mostly a UI problem rather than an engineering one.
- **Accessibility.** Colorblind-friendly palettes, key rebinding, reduced-motion options.
- **Touch / mobile support.** The architecture is built to allow a Capacitor wrapper. The input layer would need rework.

---

## Long-Term / Vision

Directions we find interesting but haven't committed to. Don't build against these without a conversation first.

- **Multiplayer.** The simulation is designed to be server-authoritative and deterministic precisely so this is possible someday. That "someday" is not soon.
- **Mod / plugin API.** A stable surface for community extensions.
- **User-generated content.** Scenario sharing, workshop-style distribution.
- **Native desktop packaging** via Tauri.

---

## Non-Goals

These are **out of scope, by design**. PRs in these directions will be declined regardless of quality.

- **Real-time RTS-style micromanagement.** Subterrans is about *indirect* control via allocation, pheromone placement, and colony-level decisions. Click-to-move individual ants is not the game we want to make.
- **Monetization mechanics.** No microtransactions, loot boxes, battle passes, energy systems, or artificial wait-gates.
- **3D rendering.** The 2D retro aesthetic is part of the identity, not a shortcut.
- **Required always-online.** Single-player works offline forever, full stop. Optional online features (leaderboards, multiplayer) are additive, never gates.
- **Forked copies of SimAnt.** We are an *independent* spiritual successor. No original Maxis code, art, or data.

---

## How to Influence the Roadmap

- **Open a discussion or issue** before starting work on anything not listed here or in an existing issue.
- **Small fixes and improvements** that align with the near-term themes are welcome unannounced.
- **The project lead is opinionated** about how the game should feel. That's the point of having a lead. If your idea is great and off-roadmap, it still benefits from a conversation — either we realign the roadmap, or we save you a rejected PR.

This document will drift over time. The authoritative current-state answer is always the code and the open issues; this page is the map of intent.
