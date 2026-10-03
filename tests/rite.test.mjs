// tests/rite.test.mjs — the retirement rite: a bone that stops paying rent is
// retired by the sweep, excluded from injection, never deleted, revivable only
// explicitly. The rule is mechanical: opsWith >= opsWithout in EVERY entry of
// the last riteWindow measured uses (one good entry among the bad protects the
// bone until it scrolls out; exactly riteWindow-1 bad entries retire nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoneRegistry, Env, OpCounter } from '../core/bones.mjs';
import { Loop } from '../core/loop.mjs';
import { Purpose } from '../core/purpose.mjs';
import { ReceiptLog } from '../core/receipts.mjs';
import { TASK_SHAPE, flashcardStrategy, measureCapsule, flashcardExtractors } from '../strategies/flashcards.mjs';
import { TOPICS } from '../world/corpus.mjs';

const CLOCK = () => '2026-01-02T00:00:00.000Z';

const REPLAY_GOOD = ({ without, with: withC }) => {
  for (let i = 0; i < 10; i++) without.op('naive.work');
  for (let i = 0; i < 5; i++) withC.op('bone.work');
};
const GOOD_USE = (note = 'pays rent') => ({ withoutOps: 15, withOps: 6, note, withoutByLabel: { 'template.try': 15 }, withByLabel: { 'bone.fetch': 1, 'lut.dispatch': 5 } });
const BAD_USE = (note = 'stopped paying rent') => ({ withoutOps: 5, withOps: 6, note, withoutByLabel: { 'template.try': 5 }, withByLabel: { 'bone.fetch': 1, 'lut.dispatch': 5 } });

test('rite: a bone that keeps paying rent survives the sweep (EVERY window entry must be bad)', () => {
  const reg = new BoneRegistry({ loopId: 't' }); // riteWindow default 3
  const { bone } = reg.mint({ kind: 'lut', shape: 's', body: { m: 1 }, replay: REPLAY_GOOD }); // ledger: [mint, saved 5]
  assert.equal(bone.useHistory.length, 1, 'the mint counterfactual is the ledger\'s first entry');
  assert.equal(bone.useHistory[0].note, 'mint');

  reg.recordUse(bone.id, GOOD_USE()); // [g, g]
  reg.recordUse(bone.id, BAD_USE());  // [g, g, b] — one bad among good
  assert.equal(reg.retireSweep().retired.length, 0, 'one bad entry among good retires nothing');
  // rolling window refreshed: sums over the last min(3, len)=3 entries
  // ledger = [mint 10/5, use 15/6, use 5/6] → without 30, with 17, saved 13
  assert.deepEqual(
    { w: bone.costSaved.withoutOps, i: bone.costSaved.withOps, s: bone.costSaved.saved, n: bone.costSaved.window, at: bone.costSaved.measuredAt },
    { w: 30, i: 17, s: 13, n: 3, at: 'reuse' },
  );

  reg.recordUse(bone.id, BAD_USE()); // [g, g, b, b] — window [g, b, b]
  assert.equal(reg.retireSweep().retired.length, 0, 'one good entry in the window still protects the bone');

  reg.recordUse(bone.id, BAD_USE()); // [g, g, b, b, b] — window [b, b, b]
  const sweep = reg.retireSweep();
  assert.equal(sweep.retired.length, 1, 'EVERY entry in the window bad: retired');
  assert.equal(bone.retired.reason, 'stopped-paying-rent');
  assert.equal(bone.retired.at, 5, 'retired at the ledger seq of the last bad entry');
  assert.equal(bone.retired.window.length, 3);
});

test('rite: a bone whose last 3 measured uses are all bad is retired — and excluded from injection', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const { bone } = reg.mint({ kind: 'lut', shape: 'flashcard-capsule', body: { m: 1 } }); // minted WITHOUT a replay: no mint entry
  assert.equal(bone.useHistory.length, 0);
  for (let i = 0; i < 3; i++) reg.recordUse(bone.id, BAD_USE());

  const sweep = reg.retireSweep();
  assert.equal(sweep.swept, 1);
  assert.equal(sweep.retired[0].id, bone.id);
  assert.equal(reg.forShape('flashcard-capsule').length, 0, 'forShape excludes retired bones');
  assert.equal(reg.byKind('lut').length, 0, 'byKind excludes retired bones');

  const env = new Env({ registry: reg, enabled: true });
  const counter = new OpCounter();
  env.setCounter(counter);
  assert.equal(env.bone('lut'), null, 'Env.bone refuses a retired bone');
  assert.equal(counter.total, 0, 'the refusal spends no op');
  assert.throws(() => reg.recordUse(bone.id, GOOD_USE()), (e) => e.code === 'E_BONE_RETIRED', 'no measurements flow into a retired bone');
});

test('rite: retired bones are never deleted — all() and stats() keep them, revive is explicit', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const { bone } = reg.mint({ kind: 'jig', shape: 's', body: { j: 1 } });
  for (let i = 0; i < 3; i++) reg.recordUse(bone.id, BAD_USE());
  reg.retireSweep();

  assert.equal(reg.all().length, 1, 'the retired bone stays in the registry');
  const s = reg.stats();
  assert.equal(s.count, 1);
  assert.equal(s.retiredCount, 1, 'stats show retiredCount');
  assert.equal(bone.useHistory.length, 3, 'the reuse ledger is never deleted');

  const revive = reg.revive(bone.id, { reason: 'test: the world changed back' });
  assert.equal(revive.revived, true);
  assert.equal(reg.byKind('jig').length, 1, 'a revived bone is visible (and injectable) again');
  assert.ok(!bone.retired);
  assert.equal(bone.revivals.length, 1, 'the retirement snapshot is preserved, never deleted');
  assert.equal(bone.revivals[0].reason, 'stopped-paying-rent');
  assert.equal(bone.revivals[0].revivedFor, 'test: the world changed back');
  assert.equal(reg.revive(bone.id, { reason: 'again' }).revived, false, 'revive on a live bone is a no-op');
});

test('rite: loop remeasure wiring — ledger grows per iteration, costSaved refreshes, the trail is receipted and chain-verifies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-rite-'));
  const receiptPath = path.join(dir, 'rite.jsonl');
  const reg = new BoneRegistry({ loopId: 'rite' });
  // Pre-mint the LUT the flashcard strategy dispatches through, WITH its mint
  // counterfactual (rent paid at birth: 15 ops without, 5 with).
  const lutReplay = ({ without, with: withC }) => {
    const order = ['definition', 'process', 'quantity', 'location', 'example'];
    for (const s of order) { for (const t of order) { without.op('template.try'); if (t === s) break; } }
    for (const s of order) withC.op('lut.dispatch');
  };
  const { bone: lut } = reg.mint({ kind: 'lut', shape: TASK_SHAPE, body: { shapeToTemplate: { definition: 'definition', process: 'process', quantity: 'quantity', location: 'location', example: 'example' } }, replay: lutReplay });

  const purpose = new Purpose({ sentence: 'rite wiring: capsules while the registry polices its bones', stop: () => false, unitsFor: () => 1, deadband: 0, loopId: 'rite' });
  const measurements = [GOOD_USE('it1'), GOOD_USE('it2'), BAD_USE('it3'), BAD_USE('it4'), BAD_USE('it5')];
  const remeasure = (bone) => (bone.kind === 'lut' ? (measurements.shift() ?? null) : null); // only measured uses count
  const loop = new Loop({
    loopId: 'rite', purpose, taskShape: TASK_SHAPE, budget: 400,
    strategy: flashcardStrategy, strategyName: 'flashcards.v1', measure: measureCapsule,
    extractors: flashcardExtractors, bonesEnabled: true, remeasure, receiptPath, clock: CLOCK,
  }).attachRegistry(reg);

  for (let i = 0; i < 6; i++) loop.iterate({ topic: TOPICS[i % TOPICS.length] });

  // ledger: mint + 5 measured uses; window view = the 3 bad uses
  assert.equal(lut.useHistory.length, 6);
  assert.deepEqual(lut.costSaved, {
    withoutOps: 15, withOps: 18, saved: -3,
    withoutByLabel: { 'template.try': 15 },
    withByLabel: { 'bone.fetch': 3, 'lut.dispatch': 15 },
    window: 3, measuredAt: 'reuse',
  });
  assert.equal(lut.retired.reason, 'stopped-paying-rent');

  const receipts = new ReceiptLog({ path: receiptPath, clock: CLOCK });
  const all = receipts.all();
  const uses = all.filter(r => r.kind === 'bone.use');
  assert.equal(uses.length, 5, 'one bone.use receipt per measured use (iterations 1-5)');
  assert.ok(uses.every(u => u.payload.boneId === lut.id));
  const sweeps = all.filter(r => r.kind === 'bone.sweep');
  assert.equal(sweeps.length, 1);
  assert.equal(sweeps[0].payload.iteration, 6);
  assert.equal(sweeps[0].payload.swept, 1);
  assert.deepEqual(sweeps[0].payload.retired.map(r => r.id), [lut.id]);
  const retireds = all.filter(r => r.kind === 'bone.retired');
  assert.equal(retireds.length, 1);
  assert.equal(retireds[0].payload.boneId, lut.id);
  // seq chaining: last bone.use < bone.sweep < bone.retired < the iteration-6 reshape
  const seqOf = (r) => r.seq;
  const reshape6 = all.find(r => r.kind === 'reshape' && r.payload.iteration === 6);
  assert.ok(seqOf(uses[4]) < seqOf(sweeps[0]) && seqOf(sweeps[0]) < seqOf(retireds[0]) && seqOf(retireds[0]) < seqOf(reshape6), 'the trail is ordered: uses → sweep → retired → reshape');
  // the iteration-6 reshape injected WITHOUT the retired lut (iters 1-5 had it)
  const reshapes = all.filter(r => r.kind === 'reshape');
  for (let k = 0; k < 5; k++) assert.ok(reshapes[k].payload.injected.includes(lut.id), `iteration ${k + 1} injected the lut`);
  assert.ok(!reshape6.payload.injected.includes(lut.id), 'the rite retired it before the reshape: never injected again');
  assert.equal(receipts.verify().ok, true, 'the whole trail chain-verifies');
});

test('rite: negative control — bonesEnabled=false means no remeasure calls, no rite receipts, sweep no-ops', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-rite-ctl-'));
  const receiptPath = path.join(dir, 'control.jsonl');
  const reg = new BoneRegistry({ loopId: 'control' });
  let remeasureCalls = 0;
  const purpose = new Purpose({ sentence: 'control: the rite has nothing to police here', stop: () => false, unitsFor: () => 1, deadband: 0, loopId: 'control' });
  const loop = new Loop({
    loopId: 'control', purpose, taskShape: TASK_SHAPE, budget: 400,
    strategy: flashcardStrategy, strategyName: 'flashcards.v1', measure: measureCapsule,
    extractors: flashcardExtractors, bonesEnabled: false,
    remeasure: () => { remeasureCalls += 1; return GOOD_USE(); },
    receiptPath, clock: CLOCK,
  }).attachRegistry(reg);

  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(loop.iterate({ topic: TOPICS[i] }));
  assert.equal(remeasureCalls, 0, 'the control arm never remeasures');
  assert.ok(runs.every(r => r.injected.length === 0), 'no injection (the standing negative control)');
  assert.ok(reg.size > 0, 'bones are still minted');

  const receipts = new ReceiptLog({ path: receiptPath, clock: CLOCK }).all();
  assert.ok(!receipts.some(r => ['bone.use', 'bone.sweep', 'bone.retired'].includes(r.kind)), 'no rite receipts in the control arm');
  const sweep = reg.retireSweep();
  assert.deepEqual(sweep.retired, [], 'the sweep no-ops: mint-only ledgers (1 entry) never reach the window');
});

test('rite: riteWindow boundary — exactly riteWindow-1 bad entries is NOT retired (the off-by-one trap)', () => {
  const reg = new BoneRegistry({ loopId: 't', riteWindow: 3 });
  const { bone } = reg.mint({ kind: 'jig', shape: 's', body: { j: 1 } }); // no replay: no mint entry
  reg.recordUse(bone.id, BAD_USE());
  reg.recordUse(bone.id, BAD_USE());
  assert.equal(reg.retireSweep().retired.length, 0, '2 < 3 bad entries: the bone keeps its seat');
  reg.recordUse(bone.id, BAD_USE());
  assert.equal(reg.retireSweep().retired.length, 1, 'the riteWindow-th consecutive bad entry retires');

  // a tighter window override retires sooner (retireSweep({window}))
  const reg2 = new BoneRegistry({ loopId: 't', riteWindow: 3 });
  const { bone: b2 } = reg2.mint({ kind: 'jig', shape: 's', body: { k: 1 } });
  reg2.recordUse(b2.id, BAD_USE());
  reg2.recordUse(b2.id, BAD_USE());
  assert.equal(reg2.retireSweep({ window: 2 }).retired.length, 1, 'window=2 override: two bad entries suffice');
});

// ── receipt-of-record pin (D1, verifier finding): the committed rite.jsonl
// must regenerate from the committed tree. Two fixed-clock runs are
// byte-identical; the committed file is payload-identical (ts/hash/prev bind
// the clock, so byte-equality across clocks is not expected — payload
// identity is the seal).
test('rite receipt of record regenerates: fixed clock is byte-identical, committed file is payload-identical', async () => {
  const { runRiteDemo } = await import('../demo/rite-example.mjs');
  const os = await import('node:os');
  const pathM = await import('node:path');
  const dir = fs.mkdtempSync(pathM.join(os.tmpdir(), 'rite-pin-'));
  const fixed = () => '2026-10-03T00:00:00.000Z';
  const p1 = pathM.join(dir, 'a.jsonl');
  const p2 = pathM.join(dir, 'b.jsonl');
  runRiteDemo({ receiptPath: p1, clock: fixed });
  runRiteDemo({ receiptPath: p2, clock: fixed });
  assert.equal(
    fs.readFileSync(p1, 'utf8'), fs.readFileSync(p2, 'utf8'),
    'fixed clock: the rite demo is byte-identical across runs',
  );
  const strip = (p) => fs.readFileSync(p, 'utf8').trim().split('\n')
    .map((l) => { const r = JSON.parse(l); return JSON.stringify({ seq: r.seq, kind: r.kind, payload: r.payload }); });
  const committed = new URL('../demo/receipts/rite.jsonl', import.meta.url).pathname;
  assert.deepEqual(
    strip(p1), strip(committed),
    'the committed rite.jsonl regenerates payload-for-payload from the committed tree (only ts/hash/prev may differ)',
  );
});
