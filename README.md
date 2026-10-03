# purpose-loops

> **Loops, not runs — and the loops are RSI for a purpose.** The unit of work
> is not an attempt; it is the cultivator. Each iteration leaves BONES (jigs,
> lookup tables, presets, validators) so the next same-shaped task starts in a
> world already shaped by the last one. We are not saving the decision tree;
> we are shaping the environment that cultivated the decision.

## The Jig Law (stated plainly)

A result that only answers a question is spent the moment it is read. A result
that leaves the **bones of a solution to another problem** makes the next
build cheaper — that is what a jig is in a machine shop: not better, faster,
or cheaper at its own task, but it makes every future task of that shape
cheaper to fixture. This repo operationalizes the law: the loop's success
metric is not iteration quality alone, it is the **delta cost of the same
task shape** — if iteration k+1 is cheaper because of bones minted by
iteration k, the loop is working, and the receipt proves it.

## Anatomy of a purpose-loop

```
purpose (standing sentence + measurable stop-condition)
  └─ iterate():
       1. ATTEMPT  — run the task shape with the current environment
       2. MEASURE  — honest payoff + operation cost, receipted
       3. COMPILE  — mint bones from what worked (only on surprise/deadband breach)
       4. RESHAPE  — inject bones; the next attempt inherits the world they shape
```

- **Bone registry** (`core/bones.mjs`): every bone carries provenance (the
  receipts that minted it), a reuse count, and an honest `costSaved` measured
  as ops-without vs ops-with.
- **Purpose ledger** (`core/purpose.mjs`): every iteration cites how it served
  the purpose; the loop PAUSES itself when marginal purpose-per-token falls
  below a deadband — the inverse of the exocortex surprise-interrupt: no
  surprise, no spend.
- **Receipts** (`core/receipts.mjs`): append-only JSONL, sha-chained tips.

## The receipted result (offline, deterministic)

Task shape `flashcard-capsule` (5 Q/A cards on a topic), lexicon-based
strategy, zero network, three topics of the same shape:

| loop | iteration 1 | iteration 2 | iteration 3 |
|---|---|---|---|
| **main (bones injected)** | 99 ops | **67 ops** | **38 ops** |
| **control (bones disabled)** | 99 ops | 99 ops | 99 ops |

The bones did the work: a compiled **lexicon** (subject blanks + observed
question forms) and a **question-shape LUT** cut corpus scans and template
tries to near zero by iteration 3, while the control loop — same code, bones
withheld — stayed flat at 99. The bone registry records per-bone `costSaved`
(e.g. the lexicon bone: 28 ops without, 8 with, saved 20, reused twice).

## The receipted result (live LLM, 3 real calls)

`demo/llm-loop.mjs` runs the same shape through a real model
(`Qwen/Qwen3-Next-80B-A3B-Instruct` via DeepInfra). Iteration 1 carries the
full verbose style paragraph (679 prompt chars). After iteration 1 the loop
compiles the style into a **frozen bone** (a compact LUT + one example card)
and — per the deadband law — does NOT recompile it unless an invalid capsule
breaches the band. Prompt chars fell **679 → 653 → 646** with all three
iterations producing 5 valid cards. A first honest failure is preserved in
the git history: recompiling every iteration let the LUT accrete and the
curve rose (679 → 655 → 693) — bones that fatten are the opposite of the
thesis. Compile-once-freeze-until-surprise is the fix, and it is the same law
the erised exocortex runs on.

## What the loop leaves behind (the jig inventory)

- `strategies/flashcards.mjs` — the capsule strategy with pluggable attempt +
  deterministic bone extractors.
- `core/` — loop, bones, purpose, receipts (ESM, zero deps).
- `tests/` — 22 tests: append-only receipts, bone-injection determinism, the
  cost-decreasing property, the negative control, purpose-deadband pause.
- `demo/index.html` — self-contained loop visualizer (no network): purpose
  banner, falling cost bars, the bone registry growing, the ghosted control
  loop beside it for contrast, receipts strip. 45 receipts embedded.
- `demo/llm-receipts/` — the live 3-call curve, raw.

## Run it

```bash
node lib/run-experiment.mjs     # offline worked example (writes demo/summary.json)
node demo/llm-loop.mjs          # live 3-call LLM loop (keys never printed)
node demo/embed.mjs             # rebuild the demo page from receipts
node --test tests/              # 22/22 (run per-file: node --test tests/<f>.mjs)
```

## Honest limits

- The cost metric is operation counts (deterministic, receipted), not wall
  time or dollars — chosen so the offline proof needs no network; the LLM
  demo adds prompt chars as a second currency.
- Bone extractors are shape-specific. The flashcard shape ships; other shapes
  need their own compile rules — which is the point: each new shape pays one
  jig-building cost, and every later task of that shape rides it.
- The purpose deadband pauses on low marginal purpose; it does not yet
  re-direct to a different purpose (no portfolio of purposes).
