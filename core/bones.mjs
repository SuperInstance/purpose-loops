// core/bones.mjs — the Bone registry: reusable artifacts minted by a loop, loaded
// into the next attempt's environment. A bone is FIRST-CLASS: {id, kind, body,
// provenance, reuseCount, costSaved}. Kinds: jig | lut | preset | validator | lexicon.
//
// costSaved is measured HONESTLY: at mint time a counterfactual replay actually
// executes the same subtask with and without the bone, on real op counters, and the
// difference is recorded. No estimates, no vibes.

import { canon } from './receipts.mjs';

export const BONE_KINDS = ['jig', 'lut', 'preset', 'validator', 'lexicon'];

// ─── OpCounter: the honest cost unit. One op = one discrete unit of task work
// (a scan step, a template try, a composition, a check). Every op is labeled so
// receipts can show WHICH work disappeared when bones loaded. ───

export class OpCounter {
  constructor() { this.n = 0; this.labels = new Map(); }
  op(label) {
    this.n += 1;
    this.labels.set(label, (this.labels.get(label) || 0) + 1);
  }
  get total() { return this.n; }
  breakdown() {
    const o = {};
    for (const [k, v] of [...this.labels.entries()].sort()) o[k] = v;
    return o;
  }
}

// ─── Env: the world an attempt starts in. Bones are INJECTED here; a strategy
// that consults the env sees a world already containing them. With enabled=false
// or no registry, the same strategy code sees an empty world (negative control:
// identical code path, no affordances). Fetching a bone that exists costs 1 op —
// bones are not free to USE, only cheaper than re-deriving. ───

export class Env {
  constructor({ registry = null, enabled = true } = {}) {
    this.registry = registry;
    this.enabled = enabled && registry !== null;
    this._counter = null;
    this._fetched = [];
  }
  setCounter(c) { this._counter = c; return this; }
  bone(kind, predicate = () => true) {
    if (!this.enabled) return null;
    const found = this.registry.byKind(kind).find(b => predicate(b));
    if (!found) return null;
    if (this._counter) this._counter.op('bone.fetch');
    this._fetched.push(found.id);
    this.registry.markUsed(found.id);
    return found;
  }
  fetched() { return [...this._fetched]; }
}

// ─── BoneRegistry ───

export class BoneRegistry {
  constructor({ loopId = 'loop' } = {}) {
    this.loopId = loopId;
    this.bones = new Map(); // id -> bone
  }

  // Mint (or dedupe). Deterministic id from kind + body hash: same body minted
  // twice returns the SAME bone with minted:false (registry saturation is honest).
  mint({ kind, shape, body, provenance = [], replay = null }) {
    const bodyHash = sha256Short(canon(body));
    const id = `${kind}:${bodyHash}`;
    if (this.bones.has(id)) {
      const existing = this.bones.get(id);
      existing.provenance = dedupe([...existing.provenance, ...provenance]);
      return { bone: existing, minted: false };
    }
    const bone = { id, kind, shape, body, provenance: dedupe(provenance), bodyHash, reuseCount: 0, costSaved: null };
    this.bones.set(id, bone);
    if (replay) this.measure(bone, replay);
    return { bone, minted: true };
  }

  // Honest counterfactual: actually RUN the subtask both ways, count ops both ways.
  measure(bone, replay) {
    const withoutC = new OpCounter();
    const withC = new OpCounter();
    replay({ without: withoutC, with: withC });
    bone.costSaved = {
      withoutOps: withoutC.total,
      withOps: withC.total,
      saved: withoutC.total - withC.total,
      withoutByLabel: withoutC.breakdown(),
      withByLabel: withC.breakdown(),
    };
    return bone.costSaved;
  }

  markUsed(id) { const b = this.bones.get(id); if (b) b.reuseCount += 1; }
  byKind(kind) { return [...this.bones.values()].filter(b => b.kind === kind); }
  forShape(shape) { return [...this.bones.values()].filter(b => b.shape === shape); }
  all() { return [...this.bones.values()]; }
  get size() { return this.bones.size; }
  stats() {
    const byKind = {};
    let totalSaved = 0;
    for (const b of this.bones.values()) {
      byKind[b.kind] = (byKind[b.kind] || 0) + 1;
      totalSaved += b.costSaved ? b.costSaved.saved : 0;
    }
    return { count: this.bones.size, byKind, totalCostSaved: totalSaved };
  }
}

function sha256Short(s) {
  // FNV-1a 64-bit, hex — cheap deterministic body fingerprint (same shape family
  // as madlibs-gan-turbovec's paradigm markers; full sha256 lives in the receipts).
  let h = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(s, 'utf8')) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

function dedupe(a) { return [...new Set(a)]; }
