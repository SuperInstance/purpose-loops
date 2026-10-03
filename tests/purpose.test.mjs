// tests/purpose.test.mjs — the purpose ledger: cites on every iteration, the
// deadband gate refuses zero-surprise spend BEFORE any op is burned, and the
// pause is a receipt with a WHY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWorkedExample, makePurpose, PURPOSE_SENTENCE } from '../lib/run-experiment.mjs';
import { Purpose } from '../core/purpose.mjs';
import { ReceiptLog } from '../core/receipts.mjs';
import { Loop } from '../core/loop.mjs';
import { BoneRegistry, OpCounter } from '../core/bones.mjs';
import { TASK_SHAPE, flashcardStrategy, measureCapsule, flashcardExtractors } from '../strategies/flashcards.mjs';
import { TOPICS } from '../world/corpus.mjs';

const CLOCK = () => '2026-01-01T00:00:00.000Z';

test('purpose: every iteration cites how it served the standing sentence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-purpose-'));
  const r = runWorkedExample({ clock: CLOCK, mainPath: path.join(dir, 'm.jsonl'), controlPath: path.join(dir, 'c.jsonl') });
  const log = new ReceiptLog({ path: path.join(dir, 'm.jsonl'), clock: CLOCK });
  const cites = log.all().filter(x => x.kind === 'purpose.cite');
  assert.equal(cites.length, 3, 'one cite per completed iteration');
  for (const c of cites) {
    assert.ok(c.payload.sentence.includes(PURPOSE_SENTENCE.slice(0, 30)), 'the cite quotes the standing purpose');
    assert.ok(c.payload.units > 0 && c.payload.marginal > 0);
  }
  // marginal purpose-per-op RISES while the curve falls: the loop gets better at serving its purpose
  const marginals = cites.map(c => c.payload.marginal);
  assert.ok(marginals[1] > marginals[0], `marginal rose: ${marginals[0]} -> ${marginals[1]}`);
  assert.ok(marginals[2] > marginals[1], `marginal rose: ${marginals[1]} -> ${marginals[2]}`);
});

test('purpose: the deadband gate pauses a zero-unit iteration BEFORE any op is spent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-deadband-'));
  const mainPath = path.join(dir, 'm.jsonl');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath: path.join(dir, 'c.jsonl') });
  assert.ok(r.main.gate, 'the repeat iteration was refused at the gate');
  assert.equal(r.main.gate.opsSpent, 0, 'a pause spends nothing');
  assert.ok(r.main.gate.why.includes('No surprise, no spend'));
  const receipts = new ReceiptLog({ path: mainPath, clock: CLOCK }).all();
  const pause = receipts.find(x => x.kind === 'purpose.pause');
  assert.ok(pause, 'the pause is a receipt, not an exception');
  assert.ok(pause.payload.why.length > 20, 'the pause records WHY');
  assert.ok(!receipts.some(x => x.kind === 'attempt.record' && x.payload.iteration === 4), 'no attempt receipt exists for the refused iteration');
});

test('purpose: marginal math — improvement bonus is the falling-curve credit', () => {
  const p = makePurpose({ loopId: 't' });
  const a = p.record({ iteration: 1, ops: 100, coverageUnits: 1, cite: 'first capsule' });
  assert.equal(a.units, 1, 'no prior curve: no improvement bonus');
  const b = p.record({ iteration: 2, ops: 50, coverageUnits: 1, cite: 'second capsule' });
  assert.ok(Math.abs(b.improvement - 0.5) < 1e-9, '(100-50)/100 = 0.5');
  assert.ok(Math.abs(b.units - 1.5) < 1e-9);
  assert.ok(Math.abs(b.marginal - 1.5 / 50) < 1e-9);
  assert.equal(p.state.completed, 2);
});

test('purpose: a standing loop refuses to spend below the deadband even mid-stream', () => {
  const log = new ReceiptLog({ path: undefined, clock: CLOCK });
  const purpose = new Purpose({
    sentence: 'keep polishing while it pays',
    deadband: 0.1,
    stop: () => false,
    unitsFor: () => 0.01, // barely any purpose left in these tasks
    log, loopId: 't',
  });
  const noop = (env, task, counter) => { counter.op('noop'); return { artifact: { cards: [] }, trace: {} }; };
  const loop = new Loop({
    loopId: 't', purpose, taskShape: TASK_SHAPE, budget: 100,
    strategy: noop, strategyName: 'noop.v1', measure: () => ({ valid: true, quality: 0, note: '' }),
    extractors: [], clock: CLOCK,
  }).attachRegistry(new BoneRegistry({ loopId: 't' }));
  const out = loop.iterate({ topic: TOPICS[0] });
  assert.equal(out.paused, true);
  assert.equal(out.ops, 0);
  assert.ok(loop.purpose.state.lastOps === null, 'no accounting entry: nothing was attempted');
});

test('purpose: budget exhaustion closes the loop with a receipt', () => {
  const purpose = new Purpose({
    sentence: 'spend the whole budget if it serves',
    deadband: 0,
    stop: () => false,
    unitsFor: () => 1,
    log: null, loopId: 't',
  });
  const expensive = (env, task, counter) => { for (let i = 0; i < 60; i++) counter.op('grind'); return { artifact: { cards: [1, 2, 3, 4, 5] }, trace: {} }; };
  const loop = new Loop({
    loopId: 't', purpose, taskShape: TASK_SHAPE, budget: 100,
    strategy: expensive, strategyName: 'grind.v1', measure: () => ({ valid: true, quality: 1, note: '' }),
    extractors: [], clock: CLOCK,
  }).attachRegistry(new BoneRegistry({ loopId: 't' }));
  loop.iterate({ topic: 'a' });
  loop.iterate({ topic: 'b' });
  const third = loop.iterate({ topic: 'c' });
  assert.equal(third.budgetExhausted, true, '60 + 60 = 120 >= 100: refused');
  assert.equal(loop.closed, true);
});
