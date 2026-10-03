// core/bones.mjs — the Bone registry: reusable artifacts minted by a loop, loaded
// into the next attempt's environment. A bone is FIRST-CLASS: {id, kind, body,
// provenance, reuseCount, costSaved, useHistory}. Kinds: jig | lut | preset | validator | lexicon.
//
// costSaved is measured HONESTLY: at mint time a counterfactual replay actually
// executes the same subtask with and without the bone, on real op counters, and the
// difference is recorded. No estimates, no vibes.
//
// THE RETIREMENT RITE (WP-07: "a bone registry without a retirement rite becomes
// a junk drawer"): costSaved makes the rite mechanical. Every measured use appends
// to the bone's reuse ledger (the mint-time counterfactual counts as the first
// entry when present) and costSaved is refreshed as the ROLLING WINDOW view over
// the last `riteWindow` (default 3) entries. retireSweep() retires any bone whose
// EVERY one of the last riteWindow measured uses shows opsWith >= opsWithout —
// the bone stopped paying rent riteWindow times in a row. Retired bones STAY in
// the registry (never deleted, visible in all()/stats) but are excluded from
// forShape/byKind, so reshape never injects them and Env.bone refuses them.
// Un-retiring requires an explicit registry.revive(id, {reason}); the retirement
// snapshot is preserved on the bone (bone.revivals) — never delete data.

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
    if (!found || found.retired) return null; // retired bones are refused (byKind already hides them; belt and braces)
    if (this._counter) this._counter.op('bone.fetch');
    this._fetched.push(found.id);
    this.registry.markUsed(found.id);
    return found;
  }
  fetched() { return [...this._fetched]; }
}

// ─── BoneRegistry ───

export class BoneRegistry {
  constructor({ loopId = 'loop', riteWindow = 3 } = {}) {
    this.loopId = loopId;
    this.riteWindow = riteWindow; // retirement rite window: bad-entry streak length that retires a bone
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
    const bone = { id, kind, shape, body, provenance: dedupe(provenance), bodyHash, reuseCount: 0, costSaved: null, useHistory: [] };
    this.bones.set(id, bone);
    if (replay) {
      this.measure(bone, replay);
      // The mint-time counterfactual is the ledger's first entry (it is a real
      // measurement of rent): {seq, withoutOps, withOps, savedDelta, note}.
      bone.useHistory.push(ledgerEntry(1, bone.costSaved, 'mint'));
    }
    return { bone, minted: true };
  }

  // Verbatim re-instatement (library import round-trip). Tamper-checked: the id
  // binds kind + body hash, so an edited body cannot ride under the old id.
  restore(bone) {
    if (!bone || typeof bone.id !== 'string' || typeof bone.kind !== 'string' || !('body' in bone)) {
      throw Object.assign(new Error('restore: malformed bone record'), { code: 'E_BONE_MALFORMED' });
    }
    const hash = sha256Short(canon(bone.body));
    const id = `${bone.kind}:${hash}`;
    if (bone.id !== id) {
      throw Object.assign(new Error(`restore: bone ${bone.id} does not bind its body (expected ${id})`), { code: 'E_BONE_TAMPER' });
    }
    if (this.bones.has(id) && canon(this.bones.get(id)) !== canon(bone)) {
      throw Object.assign(new Error(`restore: bone ${id} already exists with different content`), { code: 'E_BONE_TAMPER' });
    }
    const restored = { reuseCount: 0, provenance: [], useHistory: [], costSaved: null, ...bone, bodyHash: hash };
    this.bones.set(id, restored);
    return restored;
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
  get(id) { return this.bones.get(id) || null; }

  // ── THE RITE: the reuse ledger ──
  // Append one measured use and refresh costSaved as the ROLLING WINDOW view
  // over the last riteWindow ledger entries (the mint counterfactual is entry
  // seq 1 when present). Entries are NEVER deleted — the ledger is the rite's
  // audit trail. byLabel maps are optional (a caller with real counters passes
  // them; the window's byLabel sums cover exactly the entries that carry maps).
  recordUse(boneId, { withoutOps, withOps, note = '', withoutByLabel = null, withByLabel = null } = {}) {
    const b = this.bones.get(boneId);
    if (!b) throw Object.assign(new Error(`recordUse: unknown bone ${boneId}`), { code: 'E_BONE_UNKNOWN' });
    if (b.retired) throw Object.assign(new Error(`recordUse: bone ${boneId} is retired (revive it explicitly first)`), { code: 'E_BONE_RETIRED' });
    const entry = { seq: b.useHistory.length + 1, withoutOps, withOps, savedDelta: withoutOps - withOps, note };
    if (withoutByLabel) entry.withoutByLabel = withoutByLabel;
    if (withByLabel) entry.withByLabel = withByLabel;
    b.useHistory.push(entry);
    this._refreshCostSaved(b);
    return entry;
  }

  // The rolling-window view: sums over the last min(riteWindow, len) entries.
  _refreshCostSaved(b) {
    const n = Math.min(this.riteWindow, b.useHistory.length);
    const win = b.useHistory.slice(-n);
    const sum = (k) => win.reduce((a, e) => a + e[k], 0);
    const sumLabels = (k) => {
      const out = {};
      for (const e of win) { const m = e[k]; if (!m) continue; for (const lab of Object.keys(m)) out[lab] = (out[lab] || 0) + m[lab]; }
      return out;
    };
    b.costSaved = {
      withoutOps: sum('withoutOps'),
      withOps: sum('withOps'),
      saved: sum('savedDelta'),
      withoutByLabel: sumLabels('withoutByLabel'),
      withByLabel: sumLabels('withByLabel'),
      window: n,            // how many measured entries this view sums over (grows to riteWindow)
      measuredAt: 'reuse',  // mint keeps the legacy shape; the rolling view names itself
    };
    return b.costSaved;
  }

  // ── THE RITE: the sweep ──
  // Deterministic: a bone is RETIRED iff it has at least `window` (default
  // riteWindow) ledger entries AND in EVERY one of the last `window` entries
  // opsWith >= opsWithout (it stopped paying rent `window` times in a row).
  // Retired bones stay in the registry (all()/stats include them) but are
  // excluded from byKind/forShape (reshape never injects them) and Env.bone
  // refuses them. Idempotent: already-retired bones are skipped.
  // Returns {swept, retired}: swept = count newly retired; retired = snapshots.
  retireSweep({ window = null } = {}) {
    const n = window ?? this.riteWindow;
    const retired = [];
    for (const b of this.bones.values()) {
      if (b.retired || b.useHistory.length < n) continue;
      const win = b.useHistory.slice(-n);
      if (!win.every(e => e.withOps >= e.withoutOps)) continue;
      b.retired = { at: win[win.length - 1].seq, reason: 'stopped-paying-rent', window: win.map(e => ({ ...e })) };
      retired.push({ id: b.id, ...b.retired });
    }
    return { swept: retired.length, retired };
  }

  // Un-retire — explicit only, for tests/operators, never automatic. The
  // retirement snapshot moves to bone.revivals (never deleted). The reuse
  // ledger is NOT cleared: a revived bone must start paying rent again, or the
  // next sweep retires it again — the rite is mechanical, revival changes
  // nothing about that.
  revive(id, { reason = '' } = {}) {
    const b = this.bones.get(id);
    if (!b) throw Object.assign(new Error(`revive: unknown bone ${id}`), { code: 'E_BONE_UNKNOWN' });
    if (!b.retired) return { id, revived: false, why: 'bone is not retired' };
    if (!b.revivals) b.revivals = [];
    b.revivals.push({ ...b.retired, revivedFor: reason });
    delete b.retired;
    return { id, revived: true, reason };
  }

  byKind(kind) { return [...this.bones.values()].filter(b => b.kind === kind && !b.retired); }
  forShape(shape) { return [...this.bones.values()].filter(b => b.shape === shape && !b.retired); }
  all() { return [...this.bones.values()]; }
  get size() { return this.bones.size; }
  stats() {
    const byKind = {};
    let totalSaved = 0, retiredCount = 0;
    for (const b of this.bones.values()) {
      byKind[b.kind] = (byKind[b.kind] || 0) + 1;
      totalSaved += b.costSaved ? b.costSaved.saved : 0;
      if (b.retired) retiredCount += 1;
    }
    return { count: this.bones.size, byKind, totalCostSaved: totalSaved, retiredCount };
  }
}

function ledgerEntry(seq, costSaved, note) {
  const e = { seq, withoutOps: costSaved.withoutOps, withOps: costSaved.withOps, savedDelta: costSaved.saved, note };
  if (costSaved.withoutByLabel) e.withoutByLabel = costSaved.withoutByLabel;
  if (costSaved.withByLabel) e.withByLabel = costSaved.withByLabel;
  return e;
}

export function sha256Short(s) {
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
