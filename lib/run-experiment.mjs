// lib/run-experiment.mjs — the worked example driver, shared by the demo script
// and the tests (same code paths, injectable clock for byte-identical receipts).
//
// Design of the experiment:
//   MAIN LOOP   (bones enabled):  topics 1→2→3, then a repeat topic at the gate.
//   CONTROL LOOP(bones disabled): same topics, same order, same code. Bones are
//                 still MINTED (compile runs) but NEVER INJECTED — knowledge
//                 exists, the environment is never reshaped, the curve stays flat.
//
// All topics share one fact multiset, so cost deltas are attributable to bones.

import { Loop } from '../core/loop.mjs';
import { Purpose } from '../core/purpose.mjs';
import { BoneRegistry } from '../core/bones.mjs';
import {
  TASK_SHAPE, flashcardStrategy, measureCapsule, flashcardExtractors,
} from '../strategies/flashcards.mjs';
import { TOPICS } from '../world/corpus.mjs';
import fs from 'node:fs';

export const PURPOSE_SENTENCE =
  'Cultivate a capsule factory: every same-shaped capsule after the first must cost fewer operations than the last, funded only by bones the loop itself mints and loads.';

export const DEADBAND = 0.005;

export function makePurpose({ loopId, log = null }) {
  const seen = new Set();
  return new Purpose({
    sentence: PURPOSE_SENTENCE,
    deadband: DEADBAND,
    stop: (state) => state.completed >= 3,
    unitsFor: (task, state) => (seen.has(task.topic) || state.completed >= 3 ? 0 : 1),
    log, loopId,
  });
}

export function runWorkedExample({ clock = () => new Date().toISOString(), mainPath, controlPath } = {}) {
  // ── MAIN LOOP ──
  const mainPurpose = makePurpose({ loopId: 'main' });
  const mainRegistry = new BoneRegistry({ loopId: 'main' });
  const main = new Loop({
    loopId: 'main',
    purpose: mainPurpose,
    taskShape: TASK_SHAPE,
    budget: 400,
    strategy: flashcardStrategy,
    strategyName: 'flashcards.v1',
    measure: measureCapsule,
    extractors: flashcardExtractors,
    bonesEnabled: true,
    receiptPath: mainPath,
    clock,
  }).attachRegistry(mainRegistry);
  mainPurpose.log = main.log;

  const mainRuns = [];
  for (const topic of TOPICS.slice(0, 3)) mainRuns.push(main.iterate({ topic }));
  const gateRun = main.iterate({ topic: TOPICS[0] }); // repeat: the gate must refuse
  main.close('worked example complete (stop condition met; gate refused the repeat)');

  // ── CONTROL LOOP (same everything, bones never injected) ──
  const controlPurpose = makePurpose({ loopId: 'control' });
  const controlRegistry = new BoneRegistry({ loopId: 'control' });
  const control = new Loop({
    loopId: 'control',
    purpose: controlPurpose,
    taskShape: TASK_SHAPE,
    budget: 400,
    strategy: flashcardStrategy,
    strategyName: 'flashcards.v1',
    measure: measureCapsule,
    extractors: flashcardExtractors,
    bonesEnabled: false,
    receiptPath: controlPath,
    clock,
  }).attachRegistry(controlRegistry);
  controlPurpose.log = control.log;

  const controlRuns = [];
  for (const topic of TOPICS.slice(0, 3)) controlRuns.push(control.iterate({ topic }));
  control.close('negative control complete (curve flat: knowledge minted, world never reshaped)');

  const curve = (runs) => runs.filter(r => r && !r.paused).map(r => r.ops);
  const iterRows = (loop, runs) => runs.filter(r => r && !r.paused).map(r => ({
    iteration: r.iteration,
    topic: r.artifact.topic,
    ops: r.ops,
    opsByLabel: r.opsByLabel,
    injected: r.injected,
    minted: r.minted.map(b => ({ id: b.id, kind: b.kind, costSaved: b.costSaved })),
    reused: r.reused,
    valid: r.payoff.valid,
    cite: loop.purpose.state.served[r.iteration - 1] || null,
  }));

  return {
    generated: clock(),
    purpose: PURPOSE_SENTENCE,
    deadband: DEADBAND,
    main: {
      loopId: 'main',
      iterations: iterRows(main, mainRuns),
      curve: curve(mainRuns),
      gate: gateRun && gateRun.paused ? { iteration: gateRun.iteration, why: gateRun.why, opsSpent: gateRun.ops } : null,
      registry: mainRegistry.stats(),
    },
    control: {
      loopId: 'control',
      iterations: iterRows(control, controlRuns),
      curve: curve(controlRuns),
      registry: controlRegistry.stats(),
      note: 'bones minted but never injected: the environment was never reshaped',
    },
    bones: mainRegistry.all().map(b => ({
      id: b.id, kind: b.kind, shape: b.shape, reuseCount: b.reuseCount,
      provenance: b.provenance, costSaved: b.costSaved,
      body: b.kind === 'validator' && b.body.termSet ? { termSetCount: b.body.termSet.length } : b.body,
    })),
  };
}

export function ensureFreshFile(path) {
  // Demo artifacts are REGENERATED each run (the committed copies are the record
  // of the canonical run); the receipt log itself is append-only within a run.
  if (fs.existsSync(path)) fs.rmSync(path);
}
