// colony-system.ts — PRD §4c food economy, starvation, death cleanup, reconcile
//
// Implements five exported tick-step functions:
//   withdrawFood          — chamberless food withdrawal helper (PRD §4c)
//   tickFoodConsumption   — PRD §8a steps 3 AND 4 combined (CLNY-04, CLNY-05)
//   tickStarvationCheck   — Phase 6 intentional no-op (PRD §8a step 4 slot)
//   tickDeathCleanup      — swap-remove dead entities from colony buckets (PRD §4b step 5)
//   tickReconcile         — drift-correction recount pass (PRD §2, CLNY-07)
//
// Key semantic invariant (PRD §4c lines 1052-1085):
//   tickFoodConsumption IS the concrete implementation of PRD §8a steps 3 AND 4.
//   Feed success/failure is evaluated inline per entity (queen first, then each live larva).
//   On success (withdrawFood returns true):  reset starvationTimer to STARVATION_GRACE_TICKS.
//   On failure (withdrawFood returns false): decrement timer by 1; kill entity when <= 0.
//   Both branches share the same if/else — the else IS step 4.
//   WORKER_FOOD_PER_TICK=0 in Phase 6 — no worker consumption loop.
//
// tickStarvationCheck is a named step slot for forward compatibility only.
// Phase 7+ may introduce non-food starvation sources (environmental hazards).
// Do NOT add an unconditional decrement — that would double-count step 4 and
// cause a fed queen to drift toward death.
//
// No Math.floor, no floats, no division operator.

import type { WorldState } from '../types.js';
import type { ColonyRecord } from './colony-store.js';
import {
  QUEEN_FOOD_PER_TICK,
  LARVA_FOOD_PER_TICK,
  STARVATION_GRACE_TICKS,
  RECONCILE_INTERVAL_TICKS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// withdrawFood — chamberless food withdrawal helper (PRD §4c)
//
// Phase 6 chamberless-fallback: unconditionally draws from colony.foodStored.
// Phase 7 adds chamber-aware routing (UNDR-07), replacing this path.
//
// Returns true if food was withdrawn, false if pool was empty.
// ---------------------------------------------------------------------------

/**
 * Attempt to withdraw `amount` food from `colony.foodStored`.
 *
 * Phase 6 chamberless fallback: draws directly from the colony pool.
 * Returns true on success (foodStored decremented by `amount`).
 * Returns false if foodStored < amount (no partial withdrawal — all-or-nothing).
 */
export function withdrawFood(colony: ColonyRecord, amount: number): boolean {
  if (colony.foodStored < amount) return false;
  colony.foodStored -= amount;
  return true;
}

// ---------------------------------------------------------------------------
// tickFoodConsumption — PRD §8a steps 3 AND 4 combined (CLNY-04, CLNY-05)
//
// This IS the concrete implementation of steps 3 and 4 evaluated inline per entity.
// Step 3 (reset-on-feed):    withdrawFood success → reset starvationTimer to STARVATION_GRACE_TICKS
// Step 4 (decrement-on-fail): withdrawFood failure → decrement timer; kill entity at <= 0
//
// Queen processed first (CLNY-04); larvae processed in order (CLNY-05).
// Workers: WORKER_FOOD_PER_TICK=0 in Phase 6 → skipped entirely.
// ---------------------------------------------------------------------------

/**
 * Feed queen and each live larva from the colony food pool.
 *
 * PRD §4c lines 1052-1085 verbatim implementation.
 *
 * Queen first (CLNY-04): on success reset queenStarvationTimer to STARVATION_GRACE_TICKS;
 * on failure decrement queenStarvationTimer and kill queen when <= 0.
 *
 * Each live larva (CLNY-05): same per-entity contract using ants.starvationTimer[id].
 *
 * Workers: WORKER_FOOD_PER_TICK=0 → no worker loop (Phase 6 scope; Phase 7+ may add one).
 */
export function tickFoodConsumption(world: WorldState, colony: ColonyRecord): void {
  const ants = world.ants;

  // Queen (CLNY-04) — reset on success, decrement + death-check on fail.
  const queenId = colony.queenEntityId;
  if (ants.alive[queenId] === 1) {
    if (withdrawFood(colony, QUEEN_FOOD_PER_TICK)) {
      colony.queenStarvationTimer = STARVATION_GRACE_TICKS;
    } else {
      colony.queenStarvationTimer -= 1;
      if (colony.queenStarvationTimer <= 0) {
        ants.alive[queenId] = 0;
      }
    }
  }

  // Larvae (CLNY-05) — same per-entity contract.
  for (let i = 0; i < colony.larvae.length; i++) {
    const id = colony.larvae[i]!;
    if (ants.alive[id] !== 1) continue;
    if (withdrawFood(colony, LARVA_FOOD_PER_TICK)) {
      ants.starvationTimer[id] = STARVATION_GRACE_TICKS;
    } else {
      // Non-null assertion: id is a valid entity index, bounds verified by colony.larvae membership.
      const timer = ants.starvationTimer[id]! - 1;
      ants.starvationTimer[id] = timer;
      if (timer <= 0) {
        ants.alive[id] = 0;
      }
    }
  }

  // Workers: WORKER_FOOD_PER_TICK === 0 in Phase 6 → skip.
  // Phase 7+ adds worker consumption here, identical pattern to the larva loop above.
}

// ---------------------------------------------------------------------------
// tickStarvationCheck — Phase 6 intentional no-op (PRD §8a step 4 slot)
//
// PRD §8a step 4's decrement-on-fail + death check is executed inline inside
// tickFoodConsumption's else-branch. This function is therefore a no-op in Phase 6.
// The function is kept in the dispatcher as a named step slot for forward compatibility
// (Phase 7+ may introduce non-food starvation sources such as environmental hazards).
// ---------------------------------------------------------------------------

/**
 * Phase 6 no-op — PRD §8a step 4 (decrement-on-fail + death check) is executed
 * inline inside tickFoodConsumption's else-branch (PRD §4c, lines 1052-1085).
 *
 * Do NOT add an unconditional decrement here — that would double-count step 4
 * and cause a fed queen to drift toward death (regression of PRD semantics).
 *
 * Phase 7+ may introduce non-food starvation sources here (environmental hazards).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tickStarvationCheck(_world: WorldState, _colony: ColonyRecord): void {
  // Intentionally empty in Phase 6. tickFoodConsumption IS the concrete implementation
  // of PRD §8a steps 3 AND 4, evaluated inline per entity (see PRD §4c, lines 1052-1085).
}

// ---------------------------------------------------------------------------
// tickDeathCleanup — swap-remove dead entities from colony buckets (PRD §4b step 5)
//
// Backwards iteration ensures swap-remove does not skip indices when multiple
// consecutive dead entities are encountered (PRD §4b line 388 pattern).
// Updates cached eggCount, larvaeCount, workerCount after removal.
// Sets colony.defeated = true when queen is dead (CLNY-08, CMBT-06 read-through).
// ---------------------------------------------------------------------------

/**
 * Remove dead entities from colony.eggs, colony.larvae, colony.workers via swap-remove.
 *
 * Backwards iteration prevents index-skip on consecutive dead entities.
 * Updates cached count fields (eggCount, larvaeCount, workerCount) after each removal.
 * Sets colony.defeated = true if queen entity has alive === 0 (CLNY-08).
 */
export function tickDeathCleanup(world: WorldState, colony: ColonyRecord): void {
  const ants = world.ants;

  // Eggs
  for (let i = colony.eggs.length - 1; i >= 0; i--) {
    if (ants.alive[colony.eggs[i]!] === 0) {
      colony.eggs[i] = colony.eggs[colony.eggs.length - 1]!;
      colony.eggs.pop();
      colony.eggCount -= 1;
    }
  }

  // Larvae
  for (let i = colony.larvae.length - 1; i >= 0; i--) {
    if (ants.alive[colony.larvae[i]!] === 0) {
      colony.larvae[i] = colony.larvae[colony.larvae.length - 1]!;
      colony.larvae.pop();
      colony.larvaeCount -= 1;
    }
  }

  // Workers
  for (let i = colony.workers.length - 1; i >= 0; i--) {
    if (ants.alive[colony.workers[i]!] === 0) {
      colony.workers[i] = colony.workers[colony.workers.length - 1]!;
      colony.workers.pop();
      colony.workerCount -= 1;
    }
  }

  // Defeated flag — set when queen is dead (CLNY-08, CMBT-06 read-through)
  if (ants.alive[colony.queenEntityId] === 0) {
    colony.defeated = true;
  }
}

// ---------------------------------------------------------------------------
// tickReconcile — drift-correction recount pass (PRD §2, CLNY-07)
//
// Decrements reconcileCountdown each tick. When it reaches 0, performs a
// full recount of alive entities in each bucket, correcting any drift between
// cached count fields (eggCount, larvaeCount, workerCount) and actual bucket
// contents. Resets reconcileCountdown to RECONCILE_INTERVAL_TICKS after the pass.
// ---------------------------------------------------------------------------

/**
 * Decrement reconcileCountdown; when it reaches 0, recount all colony buckets.
 *
 * The recount pass (PRD §2) filters alive===1 entities in each bucket and
 * corrects eggCount, larvaeCount, workerCount. Doubles as a cleanup pass —
 * dead slots found during recount are swap-removed from the bucket.
 * Resets reconcileCountdown to RECONCILE_INTERVAL_TICKS after recount.
 *
 * CLNY-07: cached fields are guaranteed accurate at most RECONCILE_INTERVAL_TICKS
 * ticks after the last recount. Plan 10's taskCensus write also benefits from
 * this drift correction.
 */
export function tickReconcile(world: WorldState, colony: ColonyRecord): void {
  colony.reconcileCountdown -= 1;
  if (colony.reconcileCountdown > 0) return;

  const ants = world.ants;

  // Recount eggs (filtering dead — also doubles as a cleanup pass)
  let eggCount = 0;
  for (let i = colony.eggs.length - 1; i >= 0; i--) {
    if (ants.alive[colony.eggs[i]!] === 1) {
      eggCount += 1;
    } else {
      colony.eggs[i] = colony.eggs[colony.eggs.length - 1]!;
      colony.eggs.pop();
    }
  }
  colony.eggCount = eggCount;

  // Recount larvae
  let larvaeCount = 0;
  for (let i = colony.larvae.length - 1; i >= 0; i--) {
    if (ants.alive[colony.larvae[i]!] === 1) {
      larvaeCount += 1;
    } else {
      colony.larvae[i] = colony.larvae[colony.larvae.length - 1]!;
      colony.larvae.pop();
    }
  }
  colony.larvaeCount = larvaeCount;

  // Recount workers
  let workerCount = 0;
  for (let i = colony.workers.length - 1; i >= 0; i--) {
    if (ants.alive[colony.workers[i]!] === 1) {
      workerCount += 1;
    } else {
      colony.workers[i] = colony.workers[colony.workers.length - 1]!;
      colony.workers.pop();
    }
  }
  colony.workerCount = workerCount;

  colony.reconcileCountdown = RECONCILE_INTERVAL_TICKS;
}
