// core/library.mjs — Bridge 4 lite: the cross-shape bone library.
//
// Purposes share a bone economy instead of per-shape registries: ONE
// BoneRegistry behind a BoneLibrary, any number of loops attach to it, and
// ask() answers WP-11's Bridge 4 question — "which existing bones fit this
// fixture?" — across ALL shapes. Injection stays the Env/reshape decision:
// ask() only shows candidates (with their measured costSaved), it never loads
// anything. The rite travels with the economy: a bone retired in one shape is
// invisible to ask() unless the caller opts in explicitly.
//
// JSONL export/import carries the FULL bone — body, kind, shape, provenance,
// costSaved, the whole reuse ledger, retired status — byte-identically through
// a round-trip (canon-equal except key order), and the import is
// tamper-checked: a bone's id binds kind + body hash, so an edited body cannot
// ride under the old id (E_BONE_TAMPER, fail-closed).

import { BoneRegistry, sha256Short } from './bones.mjs';
import { canon } from './receipts.mjs';

export class BoneLibrary {
  constructor({ registry = null, loopId = 'library', riteWindow = 3 } = {}) {
    this.registry = registry ?? new BoneRegistry({ loopId, riteWindow });
  }

  // Sugar: point a loop's reshape/env at the shared economy.
  attachTo(loop) { return loop.attachRegistry(this.registry); }

  // "Which existing bones fit this fixture?" — searches ALL shapes (shape is
  // an optional narrowing filter, not the law). Returns candidate descriptors
  // with measured costSaved and rite status attached; NEVER injects.
  ask({ kind, shape = null, predicate = null, includeRetired = false } = {}) {
    if (!kind) throw Object.assign(new Error('ask: kind is required'), { code: 'E_ASK_KIND_REQUIRED' });
    const out = [];
    for (const b of this.registry.all()) {
      if (b.kind !== kind) continue;
      if (shape && b.shape !== shape) continue;
      if (b.retired && !includeRetired) continue; // the rite works across shapes: retired is opt-in
      if (predicate && !predicate(b)) continue;
      out.push({
        id: b.id, kind: b.kind, shape: b.shape, body: b.body,
        costSaved: b.costSaved ? { ...b.costSaved } : null,
        reuseCount: b.reuseCount,
        measuredUses: b.useHistory.length,
        retired: b.retired ? { ...b.retired } : null,
      });
    }
    return out;
  }

  // Export to JSONL lines: {bone, exportedAt}, one line per bone, every bone
  // verbatim (the registry is never mutated by exporting). Injectable clock
  // keeps exports deterministic under test.
  exportLines({ clock = () => new Date().toISOString() } = {}) {
    const at = clock();
    return this.registry.all().map(b => JSON.stringify({ bone: b, exportedAt: at }));
  }

  // Import JSONL lines (exportLines output or a hand-authored file in the same
  // shape). Bones are restored VERBATIM via registry.restore (id↔body binding
  // tamper-checked); history, costSaved and retired status survive exactly.
  importLines(lines) {
    let imported = 0;
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch {
        throw Object.assign(new Error('library import: unparseable line'), { code: 'E_BONE_LINE_CORRUPT' });
      }
      if (!rec || rec.bone !== Object(rec.bone)) {
        throw Object.assign(new Error('library import: line is not {bone, exportedAt}'), { code: 'E_BONE_MALFORMED' });
      }
      this.registry.restore(rec.bone);
      imported += 1;
    }
    return { imported, size: this.registry.size };
  }

  // Convenience: export → fresh library in one call.
  static fromLines(lines, { loopId = 'library-imported', riteWindow = 3 } = {}) {
    const lib = new BoneLibrary({ loopId, riteWindow });
    lib.importLines(lines);
    return lib;
  }

  // Id re-derivation for callers that want to check a candidate line without
  // importing (same binding law the import enforces).
  static boneId(bone) { return `${bone.kind}:${sha256Short(canon(bone.body))}`; }
}
