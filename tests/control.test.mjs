// tests/control.test.mjs — the strongest artifact in the wave, self-verifying:
// the committed demo's negative control (bones minted, never injected) has a
// FLAT per-iteration ops rung, a tampered rung fails loudly naming the
// iteration and the delta, and the receipts fallback derives the same rung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFlatControl, controlSeriesFromSummary, controlSeriesFromReceipts } from '../lib/control-ladder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const summary = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'summary.json'), 'utf8'));
const controlReceipts = fs.readFileSync(path.join(root, 'demo', 'receipts', 'control.jsonl'), 'utf8');

test('control: the committed rung is flat — 99 → 99 → 99, self-verified via assertFlatControl', () => {
  const series = controlSeriesFromSummary(summary);
  assert.deepEqual(series, [99, 99, 99], 'summary.control.curve is the machine-readable control series');
  const flat = assertFlatControl(series, { name: 'negative-control' });
  assert.equal(flat.flat, true);
  assert.equal(flat.rungs, 3);
  assert.equal(flat.value, 99);
});

test('control: a tampered rung fails loudly — names the iteration, the delta, and shows the diff', () => {
  assert.throws(() => assertFlatControl([99, 100, 99]), (e) => {
    assert.equal(e.code, 'E_CONTROL_DRIFT');
    assert.match(e.message, /iteration 2/);
    assert.match(e.message, /Δ\+1/);
    assert.match(e.message, /expected: 99 → 99 → 99/);
    assert.match(e.message, /found:    99 → 100 → 99/);
    return true;
  });
  assert.throws(() => assertFlatControl([99, 99, 98]), /iteration 3[\s\S]*Δ-1/, 'a downward bump is drift too');
  assert.throws(() => assertFlatControl([]), (e) => e.code === 'E_NO_CONTROL_SERIES', 'no series → no verdict');
});

test('control: the receipts fallback derives the same flat rung from demo/receipts/control.jsonl', () => {
  const series = controlSeriesFromReceipts(controlReceipts);
  assert.deepEqual(series, [99, 99, 99], 'attempt.record ops per iteration, in iteration order');
  assert.equal(assertFlatControl(series).flat, true);
  assert.deepEqual(controlSeriesFromSummary({ control: { iterations: summary.control.iterations } }), [99, 99, 99], 'iterations[] fallback works too');
  assert.equal(controlSeriesFromSummary({ control: {} }), null, 'no series in the summary → null (CLI falls back to receipts)');
});
