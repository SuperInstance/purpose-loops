// tests/bones.test.mjs — bone registry: mint dedupe, honest counterfactual
// costSaved, and injection determinism (same world in, byte-identical work out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoneRegistry, Env, OpCounter } from '../core/bones.mjs';
import { flashcardStrategy } from '../strategies/flashcards.mjs';
import { CORPUS, TOPICS } from '../world/corpus.mjs';

test('bones: mint is deduped by body hash — same body returns the same bone', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const a = reg.mint({ kind: 'lut', shape: 'flashcard-capsule', body: { shapeToTemplate: { definition: 'definition' } }, provenance: ['t:1'] });
  const b = reg.mint({ kind: 'lut', shape: 'flashcard-capsule', body: { shapeToTemplate: { definition: 'definition' } }, provenance: ['t:2'] });
  assert.equal(a.minted, true);
  assert.equal(b.minted, false);
  assert.equal(a.bone.id, b.bone.id);
  assert.deepEqual(b.bone.provenance, ['t:1', 't:2'], 'provenance accumulates on re-proof');
});

test('bones: costSaved is an EXECUTED counterfactual, not an estimate', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const index = {};
  for (const f of CORPUS.all()) (index[f.topic] ||= []).push(f.id);
  const { bone } = reg.mint({
    kind: 'lexicon', shape: 'flashcard-capsule', body: { index },
    replay: ({ without, with: withC }) => {
      for (const f of CORPUS.all()) without.op('corpus.scan');
      withC.op('lexicon.lookup');
      for (const id of index[TOPICS[0]]) withC.op('index.row');
    },
  });
  assert.ok(bone.costSaved, 'the replay ran at mint time');
  assert.equal(bone.costSaved.withoutOps, 28);
  assert.equal(bone.costSaved.withOps, 8); // 1 lookup + 7 rows: using the bone costs something too
  assert.equal(bone.costSaved.saved, 20);
  assert.equal(bone.costSaved.withoutByLabel['corpus.scan'], 28);
});

test('bones: injection determinism — the same env produces byte-identical attempts', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const index = {};
  for (const f of CORPUS.all()) (index[f.topic] ||= []).push(f.id);
  reg.mint({ kind: 'lexicon', shape: 'flashcard-capsule', body: { index } });
  reg.mint({ kind: 'lut', shape: 'flashcard-capsule', body: { shapeToTemplate: { definition: 'definition', process: 'process', quantity: 'quantity', location: 'location', example: 'example' } } });

  const run = () => {
    const env = new Env({ registry: reg, enabled: true });
    const counter = new OpCounter();
    env.setCounter(counter);
    const { artifact, trace } = flashcardStrategy(env, { topic: TOPICS[1] }, counter);
    return JSON.stringify({ artifact, trace, ops: counter.total, labels: counter.breakdown(), fetched: env.fetched() });
  };
  assert.equal(run(), run(), 'two attempts in the same world are byte-identical');
});

test('bones: an empty world drives the naive path (env is the difference, not the code)', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  const env = new Env({ registry: reg, enabled: true }); // enabled but EMPTY
  const counter = new OpCounter();
  env.setCounter(counter);
  const { artifact } = flashcardStrategy(env, { topic: TOPICS[0] }, counter);
  assert.equal(counter.breakdown()['corpus.scan'], 28, 'no lexicon in the world: full scan');
  assert.equal(counter.breakdown()['template.try'], 21, 'no lut in the world: hand fitting');
  assert.equal(artifact.cards.length, 5);
});

test('bones: disabling the env hides every bone (negative control lever)', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  reg.mint({ kind: 'lexicon', shape: 'flashcard-capsule', body: { index: { [TOPICS[0]]: ['f01'] } } });
  const env = new Env({ registry: reg, enabled: false });
  assert.equal(env.bone('lexicon'), null);
});

test('bones: registry stats count kinds and honest savings', () => {
  const reg = new BoneRegistry({ loopId: 't' });
  reg.mint({ kind: 'lut', shape: 's', body: { a: 1 }, replay: ({ without, with: withC }) => { without.op('x'); without.op('x2'); withC.op('y'); } });
  reg.mint({ kind: 'jig', shape: 's', body: { b: 2 } });
  const s = reg.stats();
  assert.equal(s.count, 2);
  assert.equal(s.byKind.lut, 1);
  assert.equal(s.byKind.jig, 1);
  assert.equal(s.totalCostSaved, 1);
});
