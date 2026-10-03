// core/receipts.mjs — hash-chained JSONL receipt log (append-only, fail-closed).
// Fleet law: never delete data; every receipt seals to the previous one;
// tampering is detectable and names its location (E_CHAIN_TAMPER @ seq).
import fs from 'node:fs';
import crypto from 'node:crypto';

export function canon(v) {
  // Canonical JSON: sorted keys, recursive. Same data in, same bytes out, forever.
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const ks = Object.keys(v).sort();
  return '{' + ks.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const GENESIS = '0'.repeat(64);

export class ReceiptLog {
  // path: JSONL file (one receipt per line). clock: () => ISO string (injectable for
  // determinism). meta: sealed into the genesis receipt (loopId, purpose, mode...).
  constructor({ path, clock = () => new Date().toISOString(), meta = {} }) {
    this.path = path;
    this.clock = clock;
    this.seq = 0;
    this.tip = GENESIS;
    if (path && fs.existsSync(path)) {
      this._load(path);
    } else {
      this._genesis(meta);
    }
  }

  _genesis(meta) {
    this.append('$genesis', meta);
  }

  _load(path) {
    const lines = fs.readFileSync(path, 'utf8').split('\n').filter(l => l.trim().length);
    for (const line of lines) {
      let r;
      try { r = JSON.parse(line); } catch (e) {
        throw Object.assign(new Error('receipt log is corrupt (unparseable line)'), { code: 'E_CHAIN_TAMPER', seq: this.seq + 1 });
      }
      this._checkAgainstChain(r, line);
      this.seq = r.seq;
      this.tip = r.hash;
    }
  }

  _checkAgainstChain(r) {
    const expect = this._seal(r.seq, r.prev, r.kind, r.ts, r.payload);
    if (r.seq !== this.seq + 1) {
      throw Object.assign(new Error(`chain break: expected seq ${this.seq + 1}, found ${r.seq}`), { code: 'E_CHAIN_TAMPER', seq: r.seq });
    }
    if (r.prev !== this.tip) {
      throw Object.assign(new Error(`chain break at seq ${r.seq}: prev does not match tip`), { code: 'E_CHAIN_TAMPER', seq: r.seq });
    }
    if (r.hash !== expect) {
      throw Object.assign(new Error(`seal mismatch at seq ${r.seq}: payload was altered after the fact`), { code: 'E_CHAIN_TAMPER', seq: r.seq });
    }
  }

  _seal(seq, prev, kind, ts, payload) {
    return sha256(`${seq}|${prev}|${kind}|${ts}|${canon(payload)}`);
  }

  append(kind, payload = {}) {
    const seq = this.seq + 1;
    const ts = this.clock();
    const hash = this._seal(seq, this.tip, kind, ts, payload);
    // The envelope is {seq, ts, kind, payload}; only the sealed fields enter the hash.
    const receipt = { seq, ts, kind, payload, prev: this.tip, hash };
    if (this.path) fs.appendFileSync(this.path, JSON.stringify(receipt) + '\n', 'utf8');
    this.seq = seq;
    this.tip = hash;
    return receipt;
  }

  verify() {
    // Re-walk the whole chain from the file (or memory) and confirm every seal.
    if (!this.path) return { ok: true, count: this.seq, tip: this.tip };
    const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(l => l.trim().length);
    let seq = 0, tip = GENESIS;
    for (const line of lines) {
      const r = JSON.parse(line);
      if (r.seq !== seq + 1 || r.prev !== tip || r.hash !== this._seal(r.seq, r.prev, r.kind, r.ts, r.payload)) {
        return { ok: false, count: lines.length, brokenAt: r.seq, tip };
      }
      seq = r.seq; tip = r.hash;
    }
    return { ok: true, count: seq, tip };
  }

  all() {
    if (!this.path) return [];
    return fs.readFileSync(this.path, 'utf8').split('\n').filter(l => l.trim().length).map(l => JSON.parse(l));
  }
}
