// demo/llm-loop.mjs — the LLM-flavored demonstration of the same thesis:
// a loop where each attempt is a real model call and the bones are a style LUT
// plus example cards. The cost unit is PROMPT CHARACTERS: if the bones do their
// job, iteration 2's prompt is shorter than iteration 1's for the same task shape.
//
//   max 3 calls total. Reads GROQ_API_KEY from the keys file (never printed,
//   never committed). On any failure: an honest failure receipt, then skip —
//   the offline curve already proves the thesis.
//
// Usage: node demo/llm-loop.mjs [--keys /path/to/.env.keys]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReceiptLog } from '../core/receipts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'llm-receipts');
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, 'llm.jsonl');
if (fs.existsSync(logPath)) fs.rmSync(logPath); // demo artifact; regenerated per run

const log = new ReceiptLog({ path: logPath });
const MODEL = 'Qwen/Qwen3-Next-80B-A3B-Instruct';
const URL = 'https://api.deepinfra.com/v1/openai/chat/completions';
const MAX_CALLS = 3;

// ─── keys: read, never print ───
function readKey(keysPath) {
  if (!keysPath || !fs.existsSync(keysPath)) return null;
  const line = fs.readFileSync(keysPath, 'utf8').split('\n').find(l => l.startsWith('DEEPINFRA_API_KEY='));
  if (!line) return null;
  return line.slice('DEEPINFRA_API_KEY='.length).trim().replace(/^["']|["']$/g, '') || null;
}
const args = process.argv.slice(2);
const keysPath = args.includes('--keys') ? args[args.indexOf('--keys') + 1] : '/home/z/my-project/.env.keys';
const key = readKey(keysPath);

function scrub(msg) {
  return key ? String(msg).split(key).join('[redacted]') : String(msg);
}

// ─── the world: three topics of the same task shape ───
const TASKS = ['black holes', 'plate tectonics', 'the Moon'];

const BASELINE_PROMPT = (t) => `You are building a study capsule. Write exactly five flashcards about ${t}.

Formatting rules:
- Each card is exactly two lines. The first line starts with "Q:", the second with "A:".
- Questions must vary in form: some definitions ("What is X?"), some processes ("How does X work?"), some quantities ("How large is X?" or "How many ...?"), some locations ("Where is X found?"), and at least one concrete example ("What is an example of X?").
- Every answer must be a single self-contained sentence that names the card's subject explicitly.
- Do not number the cards. No markdown, no headings, no commentary before or after.
- Separate consecutive cards with a blank line.`;

const BONES_PROMPT = (t, lutLines, examples) => `Write five flashcards about ${t}. Use this compiled style exactly.

STYLE LUT
${lutLines}

EXAMPLE CARD${examples.length > 1 ? 'S' : ''}
${examples.join('\n')}

Output only cards: two lines each, first "Q:" then "A:", one self-contained sentence per answer, no numbering or commentary.`;

// ─── parse + compile: the same COMPILE discipline as the offline loop ───
function parseCards(text) {
  const lines = text.split('\n').map(l => l.trim());
  const cards = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^Q:/i.test(lines[i])) {
      const a = lines.slice(i + 1).find(l => /^A:/i.test(l));
      if (a) cards.push({ q: lines[i].replace(/^Q:\s*/i, ''), a: a.replace(/^A:\s*/i, '') });
    }
  }
  return cards;
}

function classify(q) {
  const s = q.toLowerCase();
  if (/^what is an example|^give an example|^name an example/.test(s)) return 'example';
  if (/^what is|^what are|^define/.test(s)) return 'definition';
  if (/^how does|^how do/.test(s)) return 'process';
  if (/^how (large|much|many|far|long)/.test(s)) return 'quantity';
  if (/^where/.test(s)) return 'location';
  return 'other';
}

function compileBones(cards) {
  // style LUT: question form per kind (first observed phrasing, subject blanked)
  const lut = {};
  for (const c of cards) {
    const kind = classify(c.q);
    if (kind !== 'other' && !lut[kind]) lut[kind] = c.q.replace(/^(what is|what are|how does|how do|how large is|how much|how many|how far|how long|where is|where does)\b/i, m => m).replace(/[?.]$/, '') ;
  }
  const lutLines = Object.entries(lut).map(([k, v]) => `${k} → ${v} ...?`);
  return { lut, lutLines, examples: cards.slice(0, 1).map(c => `Q: ${c.q}\nA: ${c.a}`) };
}

async function callLLM(key, prompt) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return { text, latencyMs };
}

// ─── the loop ───
log.append('llm.open', { model: MODEL, callsBudget: MAX_CALLS, costUnit: 'prompt chars', endpoint: 'api.deepinfra.com/v1/openai' });

const summary = { model: MODEL, available: Boolean(key), iterations: [], curve: [], failure: null };

if (!key) {
  summary.failure = 'no GROQ_API_KEY found in keys file; offline curve stands as the proof';
  log.append('llm.failure', { reason: 'no key on disk; honest skip' });
} else {
  let bones = { lutLines: [], examples: [], frozen: false };
  let calls = 0;
  for (let i = 0; i < TASKS.length && calls < MAX_CALLS; i++) {
    const topic = TASKS[i];
    const injected = i === 0 ? [] : ['lut(style)', 'preset(example cards)'];
    const prompt = i === 0 ? BASELINE_PROMPT(topic) : BONES_PROMPT(topic, bones.lutLines, bones.examples);
    log.append('llm.iteration.begin', { iteration: i + 1, topic, bonesInjected: injected, promptChars: prompt.length });
    try {
      calls += 1;
      const { text, latencyMs } = await callLLM(key, prompt);
      const cards = parseCards(text);
      const valid = cards.length === 5 && cards.every(c => c.q.length > 2 && c.a.length > 15);
      log.append('llm.attempt', {
        iteration: i + 1, topic, promptChars: prompt.length, completionChars: text.length,
        cardsParsed: cards.length, valid, latencyMs, model: MODEL,
      });
      summary.iterations.push({ iteration: i + 1, topic, promptChars: prompt.length, completionChars: text.length, cardsParsed: cards.length, valid, latencyMs, bonesInjected: injected });
      summary.curve.push(prompt.length);
      if (valid && calls < MAX_CALLS && !bones.frozen) {
        // DEADBAND LAW: compile once, then freeze the bone. It is re-minted
        // only on surprise (an invalid capsule breaches the band). Recompiling
        // every iteration let the LUT accrete — the bone got FATTER, the
        // opposite of the thesis. Frozen bones keep the next prompts honest
        // and short: same shape, no surprise, no re-think.
        bones = compileBones(cards);
        bones.frozen = true;
        log.append('llm.compile', { iteration: i + 1, minted: ['lut(style LUT)', 'preset(example card)'], lutKinds: Object.keys(bones.lut), frozenUntilSurprise: true, nextPromptWillCarry: 'style LUT + example instead of the full rules paragraph' });
      }
    } catch (e) {
      const msg = scrub(e?.message || String(e)).slice(0, 300);
      summary.failure = msg;
      log.append('llm.failure', { iteration: i + 1, error: msg, callsSoFar: calls });
      break;
    }
  }
  log.append('llm.close', { calls, curve: summary.curve, falling: summary.curve.length > 1 && summary.curve[summary.curve.length - 1] < summary.curve[0] });
}

fs.writeFileSync(path.join(outDir, 'llm-summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (summary.curve.length > 1) {
  console.log(`LLM demo: prompt chars ${summary.curve.join(' → ')} (${summary.iterations.map(i => 'iter' + i.iteration + ': ' + (i.valid ? '5 valid cards' : 'invalid')).join(', ')})`);
} else {
  console.log('LLM demo: honest failure —', summary.failure || 'no calls made');
}
