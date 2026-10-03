// core/purpose.mjs — the Purpose ledger: a standing sentence + a measurable
// stop-condition + a deadband. Every iteration must CITE how it served the
// purpose; when marginal purpose-per-op falls below the deadband the loop PAUSES
// ITSELF and records WHY. This is the surprise-interrupt law inverted:
// no surprise, no spend.
//
//   marginal purpose-per-op = (unitsGained) / (opsSpent)
//   unitsGained = coverageUnits + improvementBonus
//     coverageUnits   : 1.0 for a genuinely new capsule toward the stop condition
//     improvementBonus: max(0, (prevOps − ops) / prevOps)  — the cost curve falling
//
// The gate runs BEFORE the attempt: predicted units / last observed ops. If the
// prediction is below deadband, zero ops are spent. The pause is a receipt, not
// an exception.

import { ReceiptLog } from './receipts.mjs';

export class Purpose {
  constructor({
    sentence,              // standing sentence — the purpose IS a sentence
    stop,                  // (state) => bool — measurable stop condition
    unitsFor,              // (task, state) => number — predicted purpose units
    deadband = 0.005,      // min marginal purpose-per-op to justify spend
    log = null,            // ReceiptLog
    loopId = 'loop',
  }) {
    this.sentence = sentence;
    this.stop = stop;
    this.unitsFor = unitsFor;
    this.deadband = deadband;
    this.log = log;
    this.loopId = loopId;
    this.state = { completed: 0, lastOps: null, curve: [], served: [] };
  }

  // Pre-attempt gate. Returns {verdict, why, predicted}. Zero spend on pause.
  plan(task) {
    const units = this.unitsFor(task, this.state);
    const predictedOps = this.state.lastOps ?? 1; // first attempt: unknown, assume 1 op floor
    const marginal = units / predictedOps;
    if (this.stop(this.state)) {
      return {
        verdict: 'pause',
        marginal,
        why: `stop condition already met: ${this._stopText()} — predicted units for this iteration is ${units} and the curve is receipted; marginal purpose-per-op ${marginal.toFixed(4)} would spend ops on nothing new. No surprise, no spend.`,
      };
    }
    if (marginal < this.deadband) {
      return {
        verdict: 'pause',
        marginal,
        why: `marginal purpose-per-op ${marginal.toFixed(4)} < deadband ${this.deadband} (predicted units ${units} / last observed ops ${predictedOps}); no surprise, no spend.`,
      };
    }
    return { verdict: 'go', marginal, why: `predicted ${units} units over ~${predictedOps} ops = ${marginal.toFixed(4)} per op, above deadband ${this.deadband}` };
  }

  // Post-iteration accounting: realized units, realized marginal, and the cite.
  record({ iteration, ops, coverageUnits, cite }) {
    const prev = this.state.curve[this.state.curve.length - 1] ?? null;
    const improvement = prev && prev > 0 ? Math.max(0, (prev - ops) / prev) : 0;
    const units = coverageUnits + improvement;
    const marginal = units / ops;
    this.state.completed += coverageUnits >= 1 ? 1 : 0;
    this.state.lastOps = ops;
    this.state.curve.push(ops);
    const sentence = `iteration ${iteration}: ${cite} — units ${units.toFixed(3)} (coverage ${coverageUnits.toFixed(1)} + improvement ${improvement.toFixed(3)}), marginal ${marginal.toFixed(4)} purpose/op; serves: "${this.sentence}"`;
    this.state.served.push(sentence);
    if (this.log) this.log.append('purpose.cite', { iteration, sentence, units, marginal, ops });
    return { units, marginal, improvement, sentence };
  }

  _stopText() {
    return `completed=${this.state.completed}, curve=[${this.state.curve.join(' → ')}]`;
  }

  met() { return this.stop(this.state); }
}
