// demo/worked-example.mjs — run the canonical worked example with the real
// clock and write the receipts + summary the visualization embeds.
//
//   main loop    : bones enabled  → curve 99 → 67 → 38 ops, then a refused repeat
//   control loop : bones disabled → curve 99 → 99 → 99 ops (minted, never loaded)
//
// The receipt files are REGENERATED here (demo artifacts; the committed copies
// are the record of the canonical run). Inside a run the log is append-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkedExample, ensureFreshFile } from '../lib/run-experiment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(here, 'receipts', 'main.jsonl');
const controlPath = path.join(here, 'receipts', 'control.jsonl');
const summaryPath = path.join(here, 'summary.json');

ensureFreshFile(mainPath);
ensureFreshFile(controlPath);

const r = runWorkedExample({ mainPath, controlPath });

fs.mkdirSync(path.dirname(mainPath), { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify(r, null, 2) + '\n');

const pc = (arr) => (100 * (1 - arr[arr.length - 1] / arr[0])).toFixed(0);
console.log('PURPOSE LOOPS — worked example (flashcard-capsule)');
console.log(`  main    curve: ${r.main.curve.join(' → ')} ops  (${pc(r.main.curve)}% cheaper by iteration 3)`);
console.log(`  control curve: ${r.control.curve.join(' → ')} ops  (flat: knowledge minted, world never reshaped)`);
console.log(`  bones minted: ${r.main.registry.count} (${Object.entries(r.main.registry.byKind).map(([k, v]) => k + '×' + v).join(', ')})`);
console.log(`  gate at iteration 4: ${r.main.gate ? 'PAUSED, 0 ops spent' : 'not paused'}`);
console.log(`  receipts: ${mainPath}`);
