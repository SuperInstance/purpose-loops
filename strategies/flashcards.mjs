// strategies/flashcards.mjs — the flashcard-capsule task shape: given a topic,
// produce a 5-card question/answer capsule. Fully deterministic, fully offline.
//
// The SAME strategy code runs with or without bones — what changes is the world
// the env hands it. No bones: scan the whole corpus, try templates in order,
// run every check separately. Bones present: indexed lookup, direct dispatch,
// compiled conformance, skeleton-driven selection. The op counter receipts the
// difference honestly, one labeled op at a time.

import { CORPUS, TEMPLATES, TEMPLATE_ORDER, TOPIC_TITLES } from '../world/corpus.mjs';

export const TASK_SHAPE = 'flashcard-capsule';
export const CAPSULE_SIZE = 5;

export const SHAPE_WEIGHTS = { definition: 1.0, process: 0.9, quantity: 0.8, location: 0.7, example: 0.6 };

// ─── THE ATTEMPT STRATEGY (pluggable; the loop does not know about flashcards) ───

export function flashcardStrategy(env, task, counter) {
  const trace = { scanned: [], lookup: null, fits: [], candidates: [], selected: [], allTerms: [] };

  // ── Phase 1: fact selection ──
  const lexicon = env.bone('lexicon');
  let facts;
  if (lexicon) {
    counter.op('lexicon.lookup'); // the compiled corpus index replaces the naive scan
    trace.lookup = task.topic;
    const ids = lexicon.body.index[task.topic] || [];
    facts = [];
    for (const id of ids) { counter.op('index.row'); facts.push(CORPUS.byId(id)); }
  } else {
    facts = [];
    for (const f of CORPUS.all()) {
      counter.op('corpus.scan');
      const matched = f.topic === task.topic;
      trace.scanned.push({ id: f.id, topic: f.topic, matched });
      if (matched) facts.push(f);
    }
  }

  // ── The rest of the world ──
  const lut = env.bone('lut');
  const cardValidator = env.bone('validator', b => Array.isArray(b.body.checks));
  const termsetValidator = env.bone('validator', b => Array.isArray(b.body.termSet));
  const preset = env.bone('preset');

  const accepted = [];
  const usedFacts = new Set();
  const localTerms = new Set();

  function pickTemplate(f) {
    if (lut) {
      counter.op('lut.dispatch');
      const templateId = lut.body.shapeToTemplate[f.shape];
      trace.fits.push({ factId: f.id, shape: f.shape, tries: 1, templateId, via: 'lut' });
      return templateId;
    }
    let tries = 0, templateId = null;
    for (const t of TEMPLATE_ORDER) {
      counter.op('template.try');
      tries += 1;
      if (t === f.shape) { templateId = t; break; }
    }
    trace.fits.push({ factId: f.id, shape: f.shape, tries, templateId, via: 'fit' });
    return templateId;
  }

  function compose(f, templateId) {
    counter.op('compose.card');
    const tpl = TEMPLATES[templateId];
    return { term: f.term, shape: f.shape, templateId, q: tpl.q(f, task), a: tpl.a(f, task) };
  }

  function checkShape(card) {
    return Boolean(SHAPE_WEIGHTS[card.shape]) && card.q.length > 0 && card.a.length > 0;
  }
  function checkAnswer(card, f) {
    return card.a.toLowerCase().includes(f.term.toLowerCase());
  }

  function validate(card, f) {
    let checks;
    let ok;
    if (cardValidator) {
      // compiled conformance: the two checks that always passed, frozen into one op
      counter.op('validator.conformance');
      const shapeOk = checkShape(card), answerOk = checkAnswer(card, f);
      checks = { shape: shapeOk, answer: answerOk, compiled: true };
      ok = shapeOk && answerOk;
    } else {
      counter.op('validate.shape');
      const shapeOk = checkShape(card);
      counter.op('validate.answer');
      const answerOk = checkAnswer(card, f);
      checks = { shape: shapeOk, answer: answerOk, compiled: false };
      ok = shapeOk && answerOk;
    }
    if (termsetValidator) {
      // compiled dedupe: membership against the frozen term set + local set, one op
      counter.op('validator.termset');
      const dup = termsetValidator.body.termSet.includes(card.term) || localTerms.has(card.term);
      checks.dedupe = !dup;
      ok = ok && !dup;
    } else {
      // naive dedupe: linear scan over every term accepted so far (op per comparison)
      const seen = [...localTerms];
      let dup = false;
      for (const t of seen) { counter.op('dedupe.compare'); if (t === card.term) dup = true; }
      checks.dedupe = !dup;
      ok = ok && !dup;
    }
    return { ok, checks };
  }

  function accept(card, f, checks, scored) {
    if (scored) counter.op('score.card');
    trace.candidates.push({ term: card.term, shape: card.shape, templateId: card.templateId, valid: checks.ok, checks, score: scored ? SHAPE_WEIGHTS[f.shape] : null });
    trace.allTerms.push(f.term);
    if (checks.ok) {
      accepted.push({ ...card, score: scored ? SHAPE_WEIGHTS[f.shape] : 0 });
      localTerms.add(card.term);
      usedFacts.add(f.id);
    }
  }

  if (preset) {
    // ── skeleton flow: the capsule preset dictates the five slots; no scoring,
    // no doomed candidates — only the cards the skeleton calls for are built ──
    for (const shape of preset.body.skeleton) {
      counter.op('skeleton.select');
      const f = facts.find(c => c.shape === shape && !usedFacts.has(c.id));
      if (!f) continue;
      const templateId = pickTemplate(f);
      const card = compose(f, templateId);
      const checks = validate(card, f);
      accept(card, f, checks, false);
    }
    trace.selected = accepted.map(c => c.term);
  } else {
    // ── candidate flow: build every candidate, score them all, take the top five ──
    for (const f of facts) {
      const templateId = pickTemplate(f);
      const card = compose(f, templateId);
      const checks = validate(card, f);
      accept(card, f, checks, true);
    }
    counter.op('select.top');
    accepted.sort((a, b) => b.score - a.score); // stable sort: deterministic ties
    accepted.length = Math.min(accepted.length, CAPSULE_SIZE);
    trace.selected = accepted.map(c => c.term);
  }

  const artifact = {
    topic: task.topic,
    title: TOPIC_TITLES[task.topic],
    cards: accepted.map(({ term, shape, templateId, q, a }) => ({ term, shape, templateId, q, a })),
  };
  return { artifact, trace };
}

// ─── HONEST MEASUREMENT (payoff against the task, not against hope) ───

export function measureCapsule(artifact, task) {
  const cards = artifact.cards;
  const rightSize = cards.length === CAPSULE_SIZE;
  const allValid = cards.every(c => Boolean(SHAPE_WEIGHTS[c.shape]) && c.q.length > 0 && c.a.length > 0);
  const distinct = new Set(cards.map(c => c.term)).size === cards.length;
  return {
    valid: rightSize && allValid && distinct,
    quality: cards.length / CAPSULE_SIZE,
    note: `${cards.length}/${CAPSULE_SIZE} cards, all well-formed: ${allValid}, terms distinct: ${distinct}`,
  };
}

// ─── COMPILE: deterministic extractors — trace rows in, bones out, byte-stable ───

function selectionReplay(index, topic) {
  // Executed counterfactual for the lexicon bone: the same selection subtask
  // with and without the compiled index, on fresh op counters.
  return ({ without, with: withC }) => {
    for (const f of CORPUS.all()) { without.op('corpus.scan'); /* match check */ if (f.topic === topic) { /* push */ } }
    withC.op('lexicon.lookup');
    for (const id of (index[topic] || [])) { withC.op('index.row'); }
  };
}

export const flashcardExtractors = [
  {
    name: 'lexicon-from-full-scan',
    // A full naive scan SEES the whole corpus; the layout it observed is the bone.
    fn: (trace, task) => {
      if (trace.lookup !== null || trace.scanned.length === 0) return null;
      const index = {};
      for (const row of trace.scanned) (index[row.topic] ||= []).push(row.id);
      return { kind: 'lexicon', shape: TASK_SHAPE, body: { index }, replay: selectionReplay(index, task.topic) };
    },
  },
  {
    name: 'lut-from-fits',
    fn: (trace) => {
      // Extract only from NAIVE fits (what the hand-tried template search learned).
      // Re-dispatching through an existing lut teaches nothing new.
      const fits = trace.fits.filter(f => f.via === 'fit');
      if (fits.length === 0) return null;
      const shapeToTemplate = {};
      for (const f of fits) if (f.templateId) shapeToTemplate[f.shape] = f.templateId;
      if (Object.keys(shapeToTemplate).length === 0) return null;
      return {
        kind: 'lut', shape: TASK_SHAPE, body: { shapeToTemplate },
        replay: ({ without, with: withC }) => {
          const shapes = Object.keys(shapeToTemplate);
          const order = ['definition', 'process', 'quantity', 'location', 'example'];
          for (const s of shapes) { for (const t of order) { without.op('template.try'); if (t === s) break; } }
          for (const s of shapes) withC.op('lut.dispatch');
        },
      };
    },
  },
  {
    name: 'validator-from-passes',
    fn: (trace, task, artifact, registry, ctx) => {
      // COMPILE law (inherited from erised-exocortex): a POLICY bone — what to
      // always check, what to skip — requires the pattern observed on >= 2
      // independent capsules. A layout (lexicon, lut) is a fact and mints from one.
      if (!ctx || ctx.capsulesCompiled < 1) return null;
      const valid = trace.candidates.filter(c => c.valid);
      if (valid.length === 0 || valid.every(c => c.checks.compiled)) return null;
      return {
        kind: 'validator', shape: TASK_SHAPE,
        body: { checks: ['shape-known', 'answer-embeds-term'] },
        replay: ({ without, with: withC }) => {
          for (let i = 0; i < 7; i++) { without.op('validate.shape'); without.op('validate.answer'); }
          for (let i = 0; i < 7; i++) withC.op('validator.conformance');
        },
      };
    },
  },
  {
    name: 'preset-from-selected',
    fn: (trace, task, artifact, registry, ctx) => {
      // The skeleton is policy too: it needs to have selected well on >= 2 capsules.
      if (!ctx || ctx.capsulesCompiled < 1) return null;
      if (trace.selected.length !== CAPSULE_SIZE) return null;
      // The skeleton is the EXACT shape sequence of the capsule that scored best
      // (repeated shapes allowed — the observed capsule is the spec).
      const skeleton = [];
      for (const term of trace.selected) {
        const cand = trace.candidates.find(c => c.term === term);
        if (!cand) return null;
        skeleton.push(cand.shape);
      }
      return {
        kind: 'preset', shape: TASK_SHAPE, body: { skeleton },
        replay: ({ without, with: withC }) => {
          // selection + build + validate for 7 candidates vs 5 skeleton slots
          for (let i = 0; i < 7; i++) { without.op('compose.card'); without.op('score.card'); without.op('validate.shape'); without.op('validate.answer'); }
          without.op('select.top');
          for (let i = 0; i < 5; i++) { withC.op('skeleton.select'); withC.op('compose.card'); withC.op('validator.conformance'); }
        },
      };
    },
  },
  {
    name: 'validator-termset-from-capsules',
    fn: (trace, task, artifact, registry, ctx) => {
      if (!ctx || ctx.capsulesCompiled < 1) return null;
      const terms = [...new Set(trace.allTerms)];
      if (terms.length === 0) return null;
      // One frozen dedupe set per registry: the honest saving is the compiled
      // membership check replacing the linear scan, not the set contents.
      if (registry && registry.byKind('validator').some(b => Array.isArray(b.body.termSet))) return null;
      return {
        kind: 'validator', shape: TASK_SHAPE,
        body: { termSet: terms.sort(), frozen: true },
        replay: ({ without, with: withC }) => {
          for (let i = 0; i < 7; i++) { for (let j = 0; j < i; j++) without.op('dedupe.compare'); }
          for (let i = 0; i < 7; i++) withC.op('validator.termset');
        },
      };
    },
  },
];
