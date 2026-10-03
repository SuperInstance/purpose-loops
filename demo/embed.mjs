// demo/embed.mjs — compile the single-file visualization: reads the canonical
// summary + receipt logs (+ the LLM demo result, whatever it was) and inlines
// them into demo/template.html → demo/index.html. No network, no CDN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReceiptLog } from '../core/receipts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const summary = JSON.parse(read('summary.json'));

function receiptsOf(file, loopId) {
  const lines = read(file).trim().split('\n').map(l => JSON.parse(l));
  return lines.map(r => ({ loop: loopId, seq: r.seq, kind: r.kind, hash: r.hash.slice(0, 12), gist: gist(r) }));
}

function trunc(s, n = 150) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function gist(r) {
  const p = r.payload || {};
  switch (r.kind) {
    case '$genesis': return 'chain sealed: ' + trunc(JSON.stringify(p));
    case 'loop.open': return `loop "${p.loopId}" opened · ${p.taskShape} · budget ${p.budget} ops · ${p.mode}`;
    case 'iteration.begin': return `iteration ${p.iteration}: ${p.why}`;
    case 'reshape': return `world reshaped before attempt ${p.iteration}: ${p.injected.length} bone(s) injected ${JSON.stringify(p.injected)}`;
    case 'attempt.record': return `${p.strategy} on "${p.artifact && p.artifact.topic}" — ${p.ops} ops`;
    case 'measure.record': return `payoff: valid=${p.payoff && p.payoff.valid}, quality=${p.payoff && p.payoff.quality}, ${p.payoff && p.payoff.note}`;
    case 'compile.record': return `compiled: minted [${p.minted.map(b => b.id).join(', ') || '—'}] reused [${p.reused.join(', ') || '—'}]`;
    case 'purpose.cite': return trunc(p.sentence);
    case 'purpose.pause': return trunc(p.why);
    case 'purpose.stopmet': return `stop condition met after iteration ${p.iteration}`;
    case 'budget.exhausted': return `budget ${p.budget} exhausted at ${p.opsSpent} ops`;
    case 'loop.close': return `loop closed: ${p.reason} (${p.iterations} iterations, ${p.opsSpent} ops)`;
    case 'llm.open': return `${p.model} · ${p.callsBudget} calls · cost unit: ${p.costUnit}`;
    case 'llm.iteration.begin': return `call ${p.iteration} (${p.topic}) · bones: [${p.bonesInjected.join(', ')}] · prompt ${p.promptChars} chars`;
    case 'llm.attempt': return `call ${p.iteration}: ${p.promptChars} chars in, ${p.cardsParsed} cards, valid=${p.valid}, ${p.latencyMs}ms`;
    case 'llm.compile': return `bones from call ${p.iteration}: ${p.minted.join(' + ')}`;
    case 'llm.failure': return trunc(p.error || p.reason, 120);
    case 'llm.diagnosis': return trunc(p.verdict);
    case 'llm.close': return `closed after ${p.calls} calls · curve ${JSON.stringify(p.curve)} · falling=${p.falling}`;
    default: return trunc(JSON.stringify(p));
  }
}

const mainLog = receiptsOf('receipts/main.jsonl', 'main');
const controlLog = receiptsOf('receipts/control.jsonl', 'control');
const mainTip = mainLog[mainLog.length - 1].hash;
const controlTip = controlLog[controlLog.length - 1].hash;

let llm = null;
const llmPath = path.join(here, 'llm-receipts', 'llm-summary.json');
if (fs.existsSync(llmPath)) llm = JSON.parse(fs.readFileSync(llmPath, 'utf8'));

const stopText = '3 distinct-topic capsules produced, each cheaper than the last';
const DATA = {
  purpose: { sentence: summary.purpose, deadband: summary.deadband, stop: stopText },
  main: {
    curve: summary.main.curve,
    iterations: summary.main.iterations.map(it => ({
      iteration: it.iteration, topic: it.topic, ops: it.ops, opsByLabel: it.opsByLabel,
      injected: it.injected, minted: it.minted, reused: it.reused, valid: it.valid, cite: it.cite,
    })),
    gate: summary.main.gate ? { ...summary.main.gate, topic: 'repeat: ' + (summary.main.iterations[0] ? summary.main.iterations[0].topic : '') } : null,
    registry: summary.main.registry,
    tip: mainTip,
  },
  control: {
    curve: summary.control.curve,
    iterations: summary.control.iterations.map(it => ({ iteration: it.iteration, topic: it.topic, ops: it.ops })),
    registry: summary.control.registry,
    note: summary.control.note,
    tip: controlTip,
  },
  bones: summary.bones,
  receipts: [...mainLog, ...controlLog],
  llm,
};

const template = read('template.html');
const json = JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = template.replace('/*__DATA_JSON__*/', json);
fs.writeFileSync(path.join(here, 'index.html'), html);
console.log(`demo/index.html written (${(html.length / 1024).toFixed(1)} KB) · main tip ${mainTip} · control tip ${controlTip} · ${DATA.receipts.length} receipts embedded`);
