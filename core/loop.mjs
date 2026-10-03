// core/loop.mjs — the Loop engine. The unit of work is a LOOP, not a run.
//
//   iterate(task):
//     1. GATE     — the purpose ledger plans the iteration (pause = zero spend)
//     2. RESHAPE  — the environment is rebuilt with the registry's bones injected
//                   (first the RETIREMENT RITE sweeps: bones that stopped paying
//                   rent for the whole rite window are retired, never injected)
//     3. ATTEMPT  — a pluggable strategy works the task, on an honest op counter
//     4. MEASURE  — payoff measured against the task requirements (no self-grading)
//     5. COMPILE  — deterministic extractors mint BONES from what worked
//     6. CITE     — the iteration cites how it served the standing purpose
//
// The loop's success metric is NOT iteration quality alone — it is the delta
// cost of the same-shaped task. Every event is a hash-chained JSONL receipt.
// If `bonesEnabled` is false, the same code runs in an empty world (the
// negative control): bones may still be minted, but nothing is ever injected —
// minting without loading changes nothing. That is the thesis, falsifiable.

import { ReceiptLog } from './receipts.mjs';
import { OpCounter, Env } from './bones.mjs';

export class Loop {
  constructor({
    loopId,
    purpose,               // Purpose instance
    taskShape,             // 'flashcard-capsule' etc.
    budget = 400,          // max total ops across the loop
    strategy,              // (env, task, counter) => {artifact, trace}
    measure,               // (artifact, task) => {valid, quality, note}
    extractors = [],       // [{name, fn: (trace, task) => {kind, shape, body, replay} | null}]
    strategyName = 'v1',
    bonesEnabled = true,   // false = negative control (inject nothing, ever)
    remeasure = null,      // (bone, env, task, counter) => {withoutOps, withOps, note, withoutByLabel?, withByLabel?} | null
                           // opt-in per loop: a measured use appends to the bone's reuse ledger
                           // (the retirement rite's window). null = unmeasured use: the window is
                           // NOT advanced — a bone that is never re-measured is never retired.
    receiptPath = null,
    clock = () => new Date().toISOString(),
  }) {
    this.loopId = loopId;
    this.purpose = purpose;
    this.taskShape = taskShape;
    this.budget = budget;
    this.strategy = strategy;
    this.measure = measure;
    this.extractors = extractors;
    this.strategyName = strategyName;
    this.bonesEnabled = bonesEnabled;
    this.remeasure = remeasure;
    this.clock = clock;
    this.iteration = 0;
    this.opsSpent = 0;
    this._capsulesCompiled = 0; // successful capsules fed to extractors (COMPILE law: policy bones need >= 2)
    this.closed = false;
    this.closeReason = null;
    this._registry = null; // attached by the driver (shared or per-loop)
    this.log = new ReceiptLog({ path: receiptPath, clock, meta: { loopId, taskShape, budget, mode: bonesEnabled ? 'bones-enabled' : 'control' } });
    this.log.append('loop.open', { loopId, taskShape, budget, bonesEnabled, purpose: purpose.sentence, deadband: purpose.deadband });
    this.purpose.log = this.log; // cites and pauses seal into this loop's chain
  }

  attachRegistry(registry) { this._registry = registry; return this; }
  get registry() { return this._registry; }

  iterate(task) {
    if (this.closed) throw Object.assign(new Error('loop is closed'), { code: 'E_LOOP_CLOSED' });
    const i = ++this.iteration;

    // ── 1. GATE: purpose plans before any op is spent ──
    const plan = this.purpose.plan(task);
    if (plan.verdict === 'pause') {
      this.log.append('purpose.pause', { iteration: i, task, marginal: plan.marginal, deadband: this.purpose.deadband, why: plan.why, opsSpent: 0 });
      this.close(`paused at gate: ${plan.why}`);
      return { iteration: i, paused: true, why: plan.why, ops: 0 };
    }
    if (this.opsSpent >= this.budget) {
      this.log.append('budget.exhausted', { iteration: i, task, opsSpent: this.opsSpent, budget: this.budget });
      this.close('budget exhausted');
      return { iteration: i, paused: false, budgetExhausted: true, ops: 0 };
    }
    this.log.append('iteration.begin', { iteration: i, task, predictedMarginal: plan.marginal, why: plan.why });

    // ── 2. RESHAPE: the world the attempt starts in already contains the bones ──
    // First the RETIREMENT RITE (WP-07: a registry without a rite becomes a junk
    // drawer): bones whose last riteWindow measured uses all show opsWith >=
    // opsWithout are retired BEFORE the injection set is computed. The rite is
    // silent when it retires nothing; when it acts, the action is receipted.
    const env = new Env({ registry: this._registry, enabled: this.bonesEnabled });
    if (this.bonesEnabled && this._registry && typeof this._registry.retireSweep === 'function') {
      const sweep = this._registry.retireSweep();
      if (sweep.retired.length > 0) {
        this.log.append('bone.sweep', { iteration: i, swept: sweep.swept, retired: sweep.retired });
        for (const r of sweep.retired) {
          this.log.append('bone.retired', { iteration: i, boneId: r.id, at: r.at, reason: r.reason, window: r.window });
        }
      }
    }
    const available = this.bonesEnabled && this._registry ? this._registry.forShape(this.taskShape).map(b => b.id) : [];
    this.log.append('reshape', { iteration: i, injected: available, worldSize: available.length, bonesEnabled: this.bonesEnabled });

    // ── 3. ATTEMPT ──
    const counter = new OpCounter();
    env.setCounter(counter);
    const { artifact, trace } = this.strategy(env, task, counter);
    this.opsSpent += counter.total;
    const attemptReceipt = this.log.append('attempt.record', {
      iteration: i, strategy: this.strategyName, ops: counter.total,
      opsByLabel: counter.breakdown(), artifact, trace,
    });

    // ── 3b. REMEASURE (opt-in): fetched bones can append a measured use to their
    // reuse ledger — the honest hook that feeds the retirement rite. Only
    // MEASURED uses advance the rite window; a null return means the strategy
    // fetched the bone but the caller cannot honestly price this use.
    const measuredUses = [];
    if (this.bonesEnabled && this.remeasure && this._registry) {
      for (const id of env.fetched()) {
        const bone = this._registry.get(id);
        if (!bone || bone.retired) continue;
        const m = this.remeasure(bone, env, task, counter);
        if (!m) continue; // unmeasured use: window not advanced
        const entry = this._registry.recordUse(bone.id, m);
        measuredUses.push({ boneId: bone.id, seq: entry.seq, withoutOps: entry.withoutOps, withOps: entry.withOps, savedDelta: entry.savedDelta, note: entry.note });
        this.log.append('bone.use', { iteration: i, boneId: bone.id, seq: entry.seq, withoutOps: entry.withoutOps, withOps: entry.withOps, savedDelta: entry.savedDelta, note: entry.note, costSaved: bone.costSaved });
      }
    }

    // ── 4. MEASURE: honest payoff, against the task, not against hope ──
    const payoff = this.measure(artifact, task);
    this.log.append('measure.record', {
      iteration: i, ops: counter.total, payoff,
      deltaVsPrev: this.purpose.state.lastOps ? counter.total - this.purpose.state.lastOps : null,
    });

    // ── 5. COMPILE: deterministic extractors mint bones from what worked ──
    const minted = [], reused = [];
    if (payoff.valid && this._registry) {
      const prov = [`${this.loopId}:${attemptReceipt.seq}`];
      const ctx = { capsulesCompiled: this._capsulesCompiled };
      for (const ex of this.extractors) {
        const spec = ex.fn(trace, task, artifact, this._registry, ctx);
        if (!spec) continue;
        const { bone, minted: isNew } = this._registry.mint({ ...spec, provenance: prov });
        if (isNew) {
          minted.push({ id: bone.id, kind: bone.kind, costSaved: bone.costSaved });
        } else {
          reused.push(bone.id);
        }
      }
      this._capsulesCompiled += 1;
    }
    this.log.append('compile.record', { iteration: i, minted, reused, payoffValid: payoff.valid, note: this.bonesEnabled ? 'bones loadable into the next reshape' : 'control: bones minted but NEVER injected (no channel to pay off)' });

    // ── 6. CITE: how this iteration served the standing purpose ──
    const coverage = this.purpose.unitsFor(task, this.purpose.state) >= 1 ? 1 : 0;
    const cite = this._cite(task, artifact, counter.total, available);
    this.purpose.record({ iteration: i, ops: counter.total, coverageUnits: coverage, cite });

    if (this.purpose.met()) {
      this.log.append('purpose.stopmet', { iteration: i, state: this.purpose.state });
    }
    return { iteration: i, paused: false, ops: counter.total, opsByLabel: counter.breakdown(), artifact, payoff, minted, reused, injected: available, measuredUses, cite };
  }

  _cite(task, artifact, ops, injected) {
    const trend = this.purpose.state.lastOps == null ? 'first observation' : `${this.purpose.state.lastOps} → ${ops} ops`;
    return `produced a ${artifact.cards.length}-card capsule on "${task.topic}" (${trend}); ${injected.length} bone(s) were in the world`;
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    this.log.append('loop.close', { reason, iterations: this.iteration, opsSpent: this.opsSpent });
  }
}
