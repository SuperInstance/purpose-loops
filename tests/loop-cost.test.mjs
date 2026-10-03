// tests/loop-cost.test.mjs — THE THESIS AS A TEST: the main loop's cost curve
// falls (99 -> 67 -> 38), the negative control's does not, and the difference
// is attributable to the bones because every topic shares one fact multiset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWorkedExample } from '../lib/run-experiment.mjs';
import { ReceiptLog } from '../core/receipts.mjs';

const CLOCK = () => '2026-01-01T00:00:00.000Z';

function inTemp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-loop-'));
  return {
    mainPath: path.join(dir, name + '-main.jsonl'),
    controlPath: path.join(dir, name + '-control.jsonl'),
    dir,
  };
}

test('loop: the cost curve falls iteration over iteration (the jig is working)', () => {
  const { mainPath, controlPath } = inTemp('fall');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath });
  const [c1, c2, c3] = r.main.curve;
  assert.ok(c1 > c2, `iteration 2 must be cheaper than 1 (${c1} > ${c2})`);
  assert.ok(c2 > c3, `iteration 3 must be cheaper than 2 (${c2} > ${c3})`);
  // the measured, canonical numbers (fail loudly if the world drifts)
  assert.deepEqual(r.main.curve, [99, 67, 38]);
});

test('loop: every iteration produced a valid 5-card capsule', () => {
  const { mainPath, controlPath } = inTemp('valid');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath });
  for (const it of r.main.iterations) {
    assert.equal(it.valid, true, `iteration ${it.iteration} capsule invalid`);
    assert.equal(it.ops > 0, true);
  }
  for (const it of r.control.iterations) assert.equal(it.valid, true);
});

test('loop: negative control — bones minted but never injected means the curve disappears', () => {
  const { mainPath, controlPath } = inTemp('ctrl');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath });
  const [k1, k2, k3] = r.control.curve;
  assert.equal(k1, k2, 'control iteration 2 must cost exactly what iteration 1 cost');
  assert.equal(k2, k3, 'control iteration 3 must cost exactly what iteration 2 cost');
  assert.ok(r.control.registry.count > 0, 'the control still MINTS bones (knowledge exists)...');
  for (const it of r.control.iterations) {
    assert.equal(it.injected.length, 0, '...but the environment is never reshaped: zero bones injected');
  }
  // and the loaded loop is strictly cheaper at every corresponding iteration
  assert.ok(r.main.curve[1] < r.control.curve[1]);
  assert.ok(r.main.curve[2] < r.control.curve[2]);
});

test('loop: the bone registry ends with the full taxonomy (lexicon, lut, preset, validators)', () => {
  const { mainPath, controlPath } = inTemp('bones');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath });
  assert.deepEqual(r.main.registry.byKind, { lexicon: 1, lut: 1, preset: 1, validator: 2 });
  for (const b of r.bones) {
    assert.ok(b.costSaved && b.costSaved.saved > 0, `bone ${b.id} has an honest, positive counterfactual saving`);
    assert.ok(b.provenance.length > 0, 'every bone cites the receipts it grew from');
  }
  // COMPILE law: structural bones mint from iteration 1; policy bones need 2 capsules
  const it1 = r.main.iterations[0], it2 = r.main.iterations[1];
  assert.deepEqual(it1.minted.map(b => b.kind).sort(), ['lexicon', 'lut']);
  assert.deepEqual(it2.minted.map(b => b.kind).sort(), ['preset', 'validator', 'validator']);
});

test('loop: receipts chain-verify for both loops and determinism is byte-exact', () => {
  const a = inTemp('det-a');
  const b = inTemp('det-b');
  runWorkedExample({ clock: CLOCK, mainPath: a.mainPath, controlPath: a.controlPath });
  runWorkedExample({ clock: CLOCK, mainPath: b.mainPath, controlPath: b.controlPath });
  for (const [p1, p2] of [[a.mainPath, b.mainPath], [a.controlPath, b.controlPath]]) {
    assert.equal(fs.readFileSync(p1, 'utf8'), fs.readFileSync(p2, 'utf8'), 'fixed clock: byte-identical receipt files');
    const v = new ReceiptLog({ path: p2, clock: CLOCK }).verify();
    assert.equal(v.ok, true);
  }
});

test('loop: reshape receipts show the world growing before each attempt', () => {
  const { mainPath, controlPath } = inTemp('reshape');
  const r = runWorkedExample({ clock: CLOCK, mainPath, controlPath });
  const log = new ReceiptLog({ path: mainPath, clock: CLOCK });
  const reshapes = log.all().filter(x => x.kind === 'reshape');
  assert.equal(reshapes[0].payload.injected.length, 0);
  assert.equal(reshapes[1].payload.injected.length, 2);
  assert.equal(reshapes[2].payload.injected.length, 5);
  const controlLog = new ReceiptLog({ path: controlPath, clock: CLOCK });
  assert.ok(controlLog.all().every(x => x.kind !== 'reshape' || x.payload.injected.length === 0));
});
