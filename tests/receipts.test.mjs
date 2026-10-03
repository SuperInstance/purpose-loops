// tests/receipts.test.mjs — the receipt chain: append-only, seal-verifiable,
// fail-closed on tamper, byte-deterministic under a fixed clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReceiptLog, canon } from '../core/receipts.mjs';

const CLOCK = () => '2026-01-01T00:00:00.000Z';
function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }

test('receipts: append grows the file and chains every seal', () => {
  const dir = tmp('pl-rcpt-');
  const p = path.join(dir, 'log.jsonl');
  const log = new ReceiptLog({ path: p, clock: CLOCK, meta: { loopId: 't' } });
  log.append('attempt.record', { ops: 99 });
  log.append('measure.record', { ops: 99, payoff: { valid: true } });
  log.append('compile.record', { minted: ['lexicon:x'] });
  const v = log.verify();
  assert.equal(v.ok, true);
  assert.equal(v.count, 4); // genesis + 3
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  const r2 = JSON.parse(lines[2]);
  const r3 = JSON.parse(lines[3]);
  assert.equal(r3.prev, r2.hash, 'each receipt seals to the previous one');
});

test('receipts: append-only across sessions (a reloaded log chains onto the tip)', () => {
  const dir = tmp('pl-rcpt2-');
  const p = path.join(dir, 'log.jsonl');
  const a = new ReceiptLog({ path: p, clock: CLOCK });
  a.append('iteration.begin', { n: 1 });
  const b = new ReceiptLog({ path: p, clock: CLOCK }); // fresh process, same file
  b.append('attempt.record', { n: 1 });
  const v = b.verify();
  assert.equal(v.ok, true);
  assert.equal(v.count, 3);
});

test('receipts: tampering is detected and names the seq (fail-closed)', () => {
  const dir = tmp('pl-rcpt3-');
  const p = path.join(dir, 'log.jsonl');
  const log = new ReceiptLog({ path: p, clock: CLOCK });
  log.append('attempt.record', { ops: 10 });
  log.append('attempt.record', { ops: 20 });
  log.append('attempt.record', { ops: 30 });
  // alter history: rewrite the middle payload after the fact
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  lines[2] = lines[2].replace('"ops":20', '"ops":999');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  assert.throws(() => new ReceiptLog({ path: p, clock: CLOCK }), (e) => {
    assert.equal(e.code, 'E_CHAIN_TAMPER');
    assert.equal(e.seq, 3);
    return true;
  });
  // and the standalone verifier reports the same break, without throwing
  const verifier = Object.create(ReceiptLog.prototype);
  verifier.path = p;
  const v = verifier.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 3);
});

test('receipts: canonical JSON is stable (same data in, same bytes out)', () => {
  const a = canon({ b: 1, a: { d: [2, 1], c: null } });
  const b = canon({ a: { c: null, d: [2, 1] }, b: 1 });
  assert.equal(a, b);
});

test('receipts: fixed clock makes hashes byte-identical across independent runs', () => {
  const dir = tmp('pl-rcpt5-');
  const p1 = path.join(dir, 'a.jsonl');
  const p2 = path.join(dir, 'b.jsonl');
  for (const p of [p1, p2]) {
    const log = new ReceiptLog({ path: p, clock: CLOCK });
    log.append('attempt.record', { ops: 42, labels: { scan: 28 } });
    log.append('measure.record', { valid: true });
  }
  assert.equal(fs.readFileSync(p1, 'utf8'), fs.readFileSync(p2, 'utf8'));
});
