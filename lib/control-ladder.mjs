// lib/control-ladder.mjs — the control rung must stay flat.
//
// The negative control (bones minted, NEVER injected) is the strongest artifact
// in the wave: same code, same tasks, flat cost curve. This tool makes that
// contract executable: it reads a summary JSON (default demo/summary.json) or
// a control receipts JSONL, asserts the control arm's per-iteration ops series
// is FLAT, and prints the ladder — control ops vs bones-enabled ops per
// iteration with the saved delta. Non-flat control → exit 1 with a diff-style
// message (bones leaked into the control arm, or the world drifted).
// assertFlatControl is exported so other repos can copy the pattern.
//
// Usage: node lib/control-ladder.mjs [demo/summary.json | control-receipts.jsonl]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertFlatControl(series, { name = 'control' } = {}) {
  if (!Array.isArray(series) || series.length === 0) {
    throw Object.assign(new Error(`${name}: no control series (need a non-empty array of per-iteration ops)`), { code: 'E_NO_CONTROL_SERIES' });
  }
  const base = series[0];
  for (let i = 1; i < series.length; i++) {
    if (series[i] !== base) {
      const d = series[i] - base;
      throw Object.assign(new Error(
        `${name} rung NOT FLAT at iteration ${i + 1}: ${base} → ${series[i]} (Δ${d > 0 ? '+' : ''}${d})\n` +
        `  expected: ${series.map(() => base).join(' → ')}\n` +
        `  found:    ${series.join(' → ')}\n` +
        `  the negative control moved: bones leaked into the control arm, or the world drifted.`,
      ), { code: 'E_CONTROL_DRIFT', at: i + 1, expected: base, found: series[i] });
    }
  }
  return { flat: true, rungs: series.length, value: base, name };
}

export function controlSeriesFromSummary(summary) {
  const c = summary && summary.control && (summary.control.curve || (summary.control.iterations || []).map(it => it.ops));
  return Array.isArray(c) && c.length ? [...c] : null;
}

export function controlSeriesFromReceipts(text) {
  const rows = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
    .filter(r => r.kind === 'attempt.record')
    .sort((a, b) => a.payload.iteration - b.payload.iteration);
  return rows.map(r => r.payload.ops);
}

function main(argv) {
  const file = argv[2] || 'demo/summary.json';
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`control-ladder: cannot read ${file}: ${e.message}`); process.exit(1); }
  let control = null, mainCurve = null, label = file;
  try {
    const summary = JSON.parse(text);
    control = controlSeriesFromSummary(summary);
    mainCurve = summary && summary.main && Array.isArray(summary.main.curve) ? summary.main.curve : null;
    if (!control) { // fall back to the receipts the summary was generated from
      const receiptsPath = path.join(path.dirname(file), 'receipts', 'control.jsonl');
      if (fs.existsSync(receiptsPath)) { control = controlSeriesFromReceipts(fs.readFileSync(receiptsPath, 'utf8')); label = receiptsPath; }
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    control = controlSeriesFromReceipts(text); // a receipts JSONL was passed directly
  }
  if (!control) { console.error(`control-ladder: no control series in ${file} (need summary.control.curve or attempt.record receipts)`); process.exit(1); }
  let flat;
  try { flat = assertFlatControl(control, { name: 'control' }); } catch (e) { console.error(`control-ladder: ${e.message}`); process.exit(1); }
  const rungs = Math.min(control.length, mainCurve ? mainCurve.length : control.length);
  console.log(`CONTROL LADDER — ${label}`);
  console.log('iteration  control (bones off)  bones on  saved by bones');
  for (let i = 0; i < rungs; i++) {
    const saved = mainCurve ? control[i] - mainCurve[i] : null;
    console.log(`${String(i + 1).padStart(9)}  ${String(control[i]).padStart(19)}  ${String(mainCurve ? mainCurve[i] : '—').padStart(8)}  ${saved === null ? '—' : String(saved).padStart(13)}`);
  }
  console.log(`control rung: FLAT at ${flat.value} ops across ${flat.rungs} iterations — the negative control stayed flat, the ladder is real.`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv);
