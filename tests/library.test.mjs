// tests/library.test.mjs — Bridge 4 lite: the cross-shape bone library. Two
// loops with different task shapes share ONE registry (a shared bone economy);
// reshape stays shape-scoped (the law unchanged); ask() finds fitting bones
// across ALL shapes without injecting; JSONL export/import round-trips the
// full bone (body, provenance, costSaved, reuse ledger, retired status)
// canon-identically and fail-closed on tamper; the rite works across shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoneLibrary } from '../core/library.mjs';
import { Loop } from '../core/loop.mjs';
import { Purpose } from '../core/purpose.mjs';
import { canon } from '../core/receipts.mjs';
import { TASK_SHAPE, flashcardStrategy, measureCapsule, flashcardExtractors } from '../strategies/flashcards.mjs';
import { TOPICS } from '../world/corpus.mjs';

const CLOCK = () => '2026-01-03T00:00:00.000Z';
const BAD_USE = (note = 'stopped paying rent') => ({ withoutOps: 5, withOps: 6, note });

function alwaysGoPurpose(loopId) {
  return new Purpose({ sentence: `library test: ${loopId}`, stop: () => false, unitsFor: () => 1, deadband: 0, loopId });
}

test('library: two loops with different task shapes share one registry — reshape stays shape-scoped', () => {
  const lib = new BoneLibrary({ loopId: 'shared' });

  // Loop A: the flashcard shape — mints measured bones from a real iteration.
  const loopA = new Loop({
    loopId: 'flash', purpose: alwaysGoPurpose('flash'), taskShape: TASK_SHAPE, budget: 400,
    strategy: flashcardStrategy, strategyName: 'flashcards.v1', measure: measureCapsule,
    extractors: flashcardExtractors, bonesEnabled: true, clock: CLOCK,
  });
  lib.attachTo(loopA);
  const a = loopA.iterate({ topic: TOPICS[0] });
  assert.ok(a.minted.length >= 2, 'loop A minted the lexicon + lut');
  assert.equal(a.minted[0].costSaved.saved > 0, true, 'the minted bones carry measured costSaved');

  // Loop B: a DIFFERENT shape on the same economy.
  const loopB = new Loop({
    loopId: 'quiz', purpose: alwaysGoPurpose('quiz'), taskShape: 'quiz-capsule', budget: 400,
    strategy: (env, task, counter) => { counter.op('quiz.work'); return { artifact: { cards: [] }, trace: {} }; },
    strategyName: 'quiz.v1', measure: () => ({ valid: true, quality: 0, note: '' }),
    extractors: [], bonesEnabled: true, clock: CLOCK,
  });
  lib.attachTo(loopB);
  const b = loopB.iterate({ q: 'what is a quiz capsule' });

  assert.equal(lib.registry, loopA.registry, 'attachTo shares the one registry object');
  assert.equal(loopB.registry, loopA.registry);
  assert.deepEqual(b.injected, [], 'the shape-scoped law is unchanged: loop B\'s reshape injects none of loop A\'s bones');
  assert.equal(lib.registry.forShape('quiz-capsule').length, 0);
  assert.equal(lib.registry.forShape(TASK_SHAPE).length >= 2, true, '...while loop A\'s shape still sees them');
});

test('library: ask() finds fitting bones across shapes, with measured costSaved attached — and never injects', () => {
  const lib = new BoneLibrary({ loopId: 'ask' });
  const loopA = new Loop({
    loopId: 'flash', purpose: alwaysGoPurpose('flash'), taskShape: TASK_SHAPE, budget: 400,
    strategy: flashcardStrategy, strategyName: 'flashcards.v1', measure: measureCapsule,
    extractors: flashcardExtractors, bonesEnabled: true, clock: CLOCK,
  });
  lib.attachTo(loopA);
  loopA.iterate({ topic: TOPICS[0] });

  const hits = lib.ask({ kind: 'lexicon' }); // no shape filter: search ALL shapes
  assert.equal(hits.length, 1);
  assert.equal(hits[0].shape, TASK_SHAPE, 'found from outside its shape — the cross-shape read');
  assert.equal(hits[0].costSaved.saved, 20, 'the measured counterfactual travels with the candidate');
  assert.ok(hits[0].costSaved.withoutOps === 28 && hits[0].costSaved.withOps === 8);
  assert.ok(hits[0].measuredUses >= 1, 'the reuse ledger size comes too');

  assert.deepEqual(lib.ask({ kind: 'lexicon', shape: 'quiz-capsule' }), [], 'shape narrowing works');
  assert.deepEqual(lib.ask({ kind: 'jig' }), [], 'no kind match, no candidates');
  assert.throws(() => lib.ask({}), (e) => e.code === 'E_ASK_KIND_REQUIRED', 'ask without a kind refuses');
});

test('library: JSONL export/import round-trips bones canon-identically — ledger and retired status survive; tamper fails closed', () => {
  const lib = new BoneLibrary({ loopId: 'export-src' });
  lib.registry.mint({
    kind: 'lut', shape: 's1', body: { m: { a: 1 } },
    replay: ({ without, with: withC }) => { for (let i = 0; i < 10; i++) without.op('w'); for (let i = 0; i < 4; i++) withC.op('b'); },
  });
  const { bone: jig } = lib.registry.mint({ kind: 'jig', shape: 's2', body: { list: [3, 1, 2] } });
  for (let i = 0; i < 3; i++) lib.registry.recordUse(jig.id, BAD_USE('it broke'));
  lib.registry.retireSweep(); // the jig is retired before export

  const lines = lib.exportLines({ clock: CLOCK });
  assert.equal(lines.length, 2);
  for (const l of lines) assert.deepEqual(Object.keys(JSON.parse(l)).sort(), ['bone', 'exportedAt'], 'each line is {bone, exportedAt}');

  const fresh = BoneLibrary.fromLines(lines, { loopId: 'imported' });
  assert.equal(fresh.registry.size, lib.registry.size, 'same size');
  const orig = lib.registry.all(), imp = fresh.registry.all();
  assert.deepEqual(imp.map(b => b.id), orig.map(b => b.id), 'same bone ids, same order');
  for (let i = 0; i < orig.length; i++) {
    assert.equal(canon(imp[i]), canon(orig[i]), `bone ${orig[i].id} round-trips canon-identically (key order excepted)`);
  }
  const importedJig = imp.find(b => b.kind === 'jig');
  assert.equal(importedJig.retired.reason, 'stopped-paying-rent', 'retired status survives');
  assert.equal(importedJig.useHistory.length, 3, 'the reuse ledger survives');
  assert.equal(importedJig.useHistory[0].seq, 1, 'ledger seqs survive');
  assert.equal(fresh.ask({ kind: 'jig' }).length, 0, 'the imported retirement binds: ask hides it by default');
  assert.equal(fresh.ask({ kind: 'lut' })[0].costSaved.saved, 6, 'imported measured costSaved is intact');

  // tamper: an edited body cannot ride under the old id
  const rec = JSON.parse(lines[0]);
  rec.bone.body.m.a = 999;
  assert.throws(() => BoneLibrary.fromLines([JSON.stringify({ bone: rec.bone, exportedAt: CLOCK() })]), (e) => e.code === 'E_BONE_TAMPER');
  // corrupt line
  assert.throws(() => BoneLibrary.fromLines(['{not json']), (e) => e.code === 'E_BONE_LINE_CORRUPT');
});

test('library: the rite works across shapes — retired in one shape, invisible to ask() unless includeRetired', () => {
  const lib = new BoneLibrary({ loopId: 'cross' });
  const { bone } = lib.registry.mint({ kind: 'preset', shape: 'flashcard-capsule', body: { skeleton: ['definition'] } });
  for (let i = 0; i < 3; i++) lib.registry.recordUse(bone.id, BAD_USE());
  lib.registry.retireSweep();

  assert.deepEqual(lib.ask({ kind: 'preset' }), [], 'a bone retired in A\'s shape is invisible to the cross-shape read');
  const shown = lib.ask({ kind: 'preset', includeRetired: true }); // explicit, receipted opt-in
  assert.equal(shown.length, 1);
  assert.equal(shown[0].retired.reason, 'stopped-paying-rent', 'the retirement record travels with the candidate');
  assert.equal(shown[0].shape, 'flashcard-capsule');

  // live bones in OTHER shapes remain findable — the economy is shared, the rite is per-bone
  lib.registry.mint({ kind: 'preset', shape: 'quiz-capsule', body: { skeleton: ['process'] } });
  assert.equal(lib.ask({ kind: 'preset' }).length, 1);
  assert.equal(lib.ask({ kind: 'preset', includeRetired: true }).length, 2);
});
