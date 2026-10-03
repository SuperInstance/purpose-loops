// demo/rite-example.mjs — the retirement rite, worked live.
// WP-07: "a bone registry without a retirement rite becomes a junk drawer."
//
// Task shape: note-capsule — produce a 3-card capsule (draft/revise/publish)
// for a topic. Demo-local corpus and strategy, so the world change below is
// REAL inside the demo's world and every remeasure number matches what the
// strategy actually pays. All steps receipted to demo/receipts/rite.jsonl:
//
//   it.1  naive attempt; COMPILE mints the lexicon + the LUT — the LUT's mint
//         counterfactual pays rent at birth (6 template tries → 3 dispatches)
//   it.2  LUT injected and used; remeasure: still paying (6 → 4, saved 2).
//         The bone has now paid rent twice (mint + first reuse). The
//         validator bone mints (COMPILE law: policy needs 2 capsules).
//   it.3  THE WORLD CHANGES: notes start carrying their template on their
//         face, so the naive fit costs ZERO ops. Remeasure: the LUT now costs
//         4 ops (fetch + dispatches) to save nothing (0 → 4, saved −4).
//   it.4-5  two more measured uses, both bad. The window is riteWindow=3 and
//         the rule is EVERY entry in the window bad: the two rent-paying
//         entries protect the bone until they scroll out (the rite's own
//         hysteresis — one good entry among the bad retires nothing).
//   it.6  at RESHAPE the sweep finds the last 3 measured uses all bad →
//         bone.retired 'stopped-paying-rent'. The reshape injects WITHOUT the
//         LUT and the attempt's cost FALLS (16 → 12 ops): the bone had truly
//         stopped paying rent. Retired ≠ deleted — it stays in the registry
//         with its full ledger.
//
// Run: node demo/rite-example.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from '../core/loop.mjs';
import { Purpose } from '../core/purpose.mjs';
import { BoneRegistry, OpCounter } from '../core/bones.mjs';
import { ReceiptLog } from '../core/receipts.mjs';
import { ensureFreshFile } from '../lib/run-experiment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ritePath = path.join(here, 'receipts', 'rite.jsonl');
ensureFreshFile(ritePath);

// ── the demo world: 4 topics × 3 notes, one per template category ──
export const TASK_SHAPE = 'note-capsule';
const CATEGORIES = ['draft', 'revise', 'publish'];
const NOTE_TOPICS = ['harbor', 'atlas', 'compass', 'beacon'];
const NOTE_TEXTS = {
  harbor: ['mooring fees are posted at the harbor office', 'the quay widening was drafted in spring', 'sail dates freeze once the harbor publishes'],
  atlas: ['the atlas draft folds at the spine', 'the revise pass re-projects the poles', 'publication binds the plates in order'],
  compass: ['the compass draft swings the needle', 'the revise pass declinates the rose', 'publication engraves the bearings'],
  beacon: ['the beacon draft raises the mast', 'the revise pass trims the wick', 'publication lights the lamp'],
};
const NOTES = [];
for (const topic of NOTE_TOPICS) {
  CATEGORIES.forEach((category, i) => {
    NOTES.push({ id: `${topic}-${category}`, topic, category, text: NOTE_TEXTS[topic][i] });
  });
}
const TEMPLATES = {
  draft: (n) => `Draft — ${n.text}`, revise: (n) => `Revise — ${n.text}`, publish: (n) => `Publish — ${n.text}`,
};

// The world the strategy AND the remeasure see. After iteration 2 it changes:
// notes carry their template on their face, so naive fitting costs zero ops.
const world = { notesCarryTemplate: false };

// ── the attempt strategy: same code with or without bones; the env decides ──
export function noteStrategy(env, task, counter) {
  const trace = { scanned: [], lookup: null, fits: [], candidates: [] };

  const lexicon = env.bone('lexicon');
  let notes;
  if (lexicon) {
    counter.op('lexicon.lookup'); // the compiled index replaces the naive scan
    trace.lookup = task.topic;
    notes = (lexicon.body.index[task.topic] || []).map(id => { counter.op('index.row'); return NOTES.find(n => n.id === id); });
  } else {
    notes = [];
    for (const n of NOTES) {
      counter.op('note.scan');
      const matched = n.topic === task.topic;
      trace.scanned.push({ id: n.id, topic: n.topic, matched });
      if (matched) notes.push(n);
    }
  }

  const lut = env.bone('lut');
  const validator = env.bone('validator', b => Array.isArray(b.body.checks));

  const cards = [];
  for (const n of notes) {
    let templateId, tries = 0, via;
    if (lut) {
      counter.op('lut.dispatch');
      templateId = lut.body.categoryToTemplate[n.category]; tries = 1; via = 'lut';
    } else if (world.notesCarryTemplate) {
      templateId = n.category; tries = 0; via = 'on-face'; // the changed world: the fit is read, not tried
    } else {
      for (const t of CATEGORIES) { counter.op('template.try'); tries += 1; if (t === n.category) { templateId = t; break; } }
      via = 'fit';
    }
    trace.fits.push({ noteId: n.id, category: n.category, tries, templateId, via });
    counter.op('compose.card');
    let checks, ok;
    if (validator) {
      counter.op('validator.conformance'); // compiled conformance: one op
      checks = { category: true, text: true, compiled: true }; ok = templateId != null;
    } else {
      counter.op('validate.category');
      counter.op('validate.text');
      checks = { category: templateId != null, text: Boolean(n.text), compiled: false }; ok = checks.category && checks.text;
    }
    trace.candidates.push({ noteId: n.id, category: n.category, templateId, valid: checks.category && checks.text && ok, checks });
    if (ok) cards.push({ note: n.id, category: n.category, templateId, text: TEMPLATES[templateId](n) });
  }
  return { artifact: { topic: task.topic, cards }, trace };
}

export function measureCapsule(artifact) {
  const cards = artifact.cards;
  const rightSize = cards.length === CATEGORIES.length;
  const onePerCategory = new Set(cards.map(c => c.category)).size === CATEGORIES.length;
  return { valid: rightSize && onePerCategory && cards.every(c => c.text.length > 0), quality: cards.length / CATEGORIES.length, note: `${cards.length}/3 cards, one per category: ${onePerCategory}` };
}

// ── COMPILE: deterministic extractors (same laws as the flashcard shape) ──
const extractors = [
  {
    name: 'lexicon-from-full-scan',
    fn: (trace, task) => {
      if (trace.lookup !== null || trace.scanned.length === 0) return null;
      const index = {};
      for (const row of trace.scanned) (index[row.topic] ||= []).push(row.id);
      return {
        kind: 'lexicon', shape: TASK_SHAPE, body: { index },
        replay: ({ without, with: withC }) => {
          for (const n of NOTES) without.op('note.scan');
          withC.op('lexicon.lookup');
          for (const id of index[task.topic]) withC.op('index.row');
        },
      };
    },
  },
  {
    name: 'lut-from-fits',
    fn: (trace) => {
      const fits = trace.fits.filter(f => f.via === 'fit'); // only NAIVE fits teach the lut
      if (fits.length === 0) return null;
      const categoryToTemplate = {};
      for (const f of fits) if (f.templateId) categoryToTemplate[f.category] = f.templateId;
      if (Object.keys(categoryToTemplate).length === 0) return null;
      return {
        kind: 'lut', shape: TASK_SHAPE, body: { categoryToTemplate },
        replay: ({ without, with: withC }) => {
          for (const c of CATEGORIES) { for (const t of CATEGORIES) { without.op('template.try'); if (t === c) break; } }
          for (const c of CATEGORIES) withC.op('lut.dispatch');
        },
      };
    },
  },
  {
    name: 'validator-from-passes',
    fn: (trace, task, artifact, registry, ctx) => {
      if (!ctx || ctx.capsulesCompiled < 1) return null; // COMPILE law: policy needs >= 2 capsules
      if (trace.candidates.length === 0 || trace.candidates.every(c => c.checks.compiled)) return null;
      return {
        kind: 'validator', shape: TASK_SHAPE, body: { checks: ['category-known', 'text-nonempty'] },
        replay: ({ without, with: withC }) => {
          for (let i = 0; i < 3; i++) { without.op('validate.category'); without.op('validate.text'); }
          for (let i = 0; i < 3; i++) withC.op('validator.conformance');
        },
      };
    },
  },
];

// ── the honest remeasure hook: re-run the LUT's counterfactual on fresh
// counters, in the CURRENT world. Only the LUT is measured (other fetched
// bones return null — unmeasured uses do not advance the rite window).
const remeasure = (bone) => {
  if (bone.kind !== 'lut') return null;
  const withoutC = new OpCounter();
  const withC = new OpCounter();
  if (!world.notesCarryTemplate) {
    for (const c of CATEGORIES) { for (const t of CATEGORIES) { withoutC.op('template.try'); if (t === c) break; } }
  } // the changed world: zero ops to fit — the bone saves nothing
  withC.op('bone.fetch');
  for (const c of CATEGORIES) withC.op('lut.dispatch');
  return {
    withoutOps: withoutC.total, withOps: withC.total,
    note: world.notesCarryTemplate ? 'world changed: templates ride on the notes (fit = 0 ops)' : 'canonical world',
    withoutByLabel: withoutC.breakdown(), withByLabel: withC.breakdown(),
  };
};

// ── the loop ──
const registry = new BoneRegistry({ loopId: 'rite', riteWindow: 3 });
const purpose = new Purpose({
  sentence: 'Demonstrate the rite: keep producing capsules while the registry polices its own bones.',
  stop: () => false, unitsFor: () => 1, deadband: 0, loopId: 'rite',
});
const loop = new Loop({
  loopId: 'rite', purpose, taskShape: TASK_SHAPE, budget: 400,
  strategy: noteStrategy, strategyName: 'notes.v1', measure: measureCapsule,
  extractors, bonesEnabled: true, remeasure, receiptPath: ritePath,
}).attachRegistry(registry);

console.log('RITE EXAMPLE — a lut bone that stops paying rent (WP-07 retirement rite)');
const runs = [];
for (let i = 1; i <= 6; i++) {
  if (i === 3) world.notesCarryTemplate = true; // the world changes before iteration 3
  const r = loop.iterate({ topic: NOTE_TOPICS[(i - 1) % NOTE_TOPICS.length] });
  runs.push(r);
  const uses = r.measuredUses.map(u => `use lut: ${u.withoutOps} → ${u.withOps} ops (saved ${u.savedDelta})`);
  console.log(`  it.${i}: ${r.ops} ops, valid ${r.payoff.valid}, injected ${r.injected.length}, ${uses.length ? uses.join('; ') : 'no measured uses'}`);
}
loop.close('rite demonstration complete: the lut was retired and the world runs without it');

const receipts = new ReceiptLog({ path: ritePath });
const all = receipts.all();
const kinds = (k) => all.filter(r => r.kind === k);
const lut = registry.get(kinds('bone.sweep')[0]?.payload.retired[0].id);

console.log('\n  the rite trail (seq-chained receipts):');
for (const r of all) {
  if (!['compile.record', 'bone.use', 'bone.sweep', 'bone.retired', 'reshape'].includes(r.kind)) continue;
  if (r.kind === 'compile.record') {
    if (r.payload.minted.length) console.log(`    seq ${r.seq}  mint        : ${r.payload.minted.map(b => `${b.id} (saved ${b.costSaved ? b.costSaved.saved : 'n/a'})`).join(', ')}`);
  } else if (r.kind === 'bone.use') {
    console.log(`    seq ${r.seq}  bone.use    : ${r.payload.boneId} seq#${r.payload.seq} ${r.payload.withoutOps} → ${r.payload.withOps} (saved ${r.payload.savedDelta}, "${r.payload.note}")`);
  } else if (r.kind === 'bone.sweep') {
    console.log(`    seq ${r.seq}  bone.sweep  : iteration ${r.payload.iteration}, swept ${r.payload.swept}, retired ${r.payload.retired.map(b => b.id).join(', ')}`);
  } else if (r.kind === 'bone.retired') {
    console.log(`    seq ${r.seq}  bone.retired: ${r.payload.boneId} reason=${r.payload.reason} at=ledger#${r.payload.at} window=[${r.payload.window.map(e => `#${e.seq} ${e.withoutOps}/${e.withOps}`).join(', ')}]`);
  } else if (r.kind === 'reshape' && r.payload.iteration >= 5) {
    console.log(`    seq ${r.seq}  reshape     : iteration ${r.payload.iteration} injected [${r.payload.injected.map(id => id.split(':')[0]).join(', ')}]`);
  }
}

console.log(`\n  the lut ledger (${lut.useHistory.length} entries, never deleted):`);
for (const e of lut.useHistory) console.log(`    #${e.seq} ${e.note.padEnd(56)} without ${e.withoutOps}  with ${e.withOps}  saved ${e.savedDelta}`);
console.log(`  rolling costSaved now: without ${lut.costSaved.withoutOps}, with ${lut.costSaved.withOps}, saved ${lut.costSaved.saved} (window ${lut.costSaved.window}, ${lut.costSaved.measuredAt})`);
console.log(`  retired: ${JSON.stringify({ at: lut.retired.at, reason: lut.retired.reason })}`);
const s = registry.stats();
console.log(`  registry: ${s.count} bones, retiredCount ${s.retiredCount} (retired ≠ deleted: still in all()/stats)`);
console.log(`  cost curve: ${runs.map(r => r.ops).join(' → ')} ops — it FALLS when the retired bone leaves the world: it had stopped paying rent`);
const reSweep = registry.retireSweep();
console.log(`  re-sweep is idempotent: retired ${reSweep.retired.length}`);
console.log(`  receipts: ${ritePath} (chain verifies: ${receipts.verify().ok}, ${all.length} receipts)`);
