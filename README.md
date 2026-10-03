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
  receipts that minted it), a reuse count, a reuse ledger, and an honest
  `costSaved` measured as ops-without vs ops-with — and a **retirement rite**
  that sweeps out bones which stopped paying rent.
- **Purpose ledger** (`core/purpose.mjs`): every iteration cites how it served
  the purpose; the loop PAUSES itself when marginal purpose-per-token falls
  below a deadband — the inverse of the exocortex surprise-interrupt: no
  surprise, no spend.
- **Receipts** (`core/receipts.mjs`): append-only JSONL, sha-chained tips.

## The retirement rite (WP-07)

> "a bone registry without a retirement rite becomes a junk drawer" — WP-07

costSaved makes the rite mechanical. Every measured use of a bone appends to
its reuse ledger (the mint-time counterfactual is the first entry when
present) and refreshes `costSaved` as the rolling window over the last
**N = `riteWindow`** entries (default 3). The sweep — run by the loop at every
RESHAPE — retires any bone whose **every one of its last N measured uses shows
opsWith ≥ opsWithout**: the bone stopped paying rent N times in a row. One
good entry in the window protects the bone (hysteresis); exactly N−1 bad
entries retire nothing (that off-by-one is a pinned test). Retirement is not
deletion: retired bones stay in the registry (`stats().retiredCount`) but are
excluded from `forShape`/`byKind`, so reshape never injects them and
`Env.bone` refuses them; only an explicit `registry.revive(id, {reason})`
un-retires (the snapshot is kept in `bone.revivals` and the ledger is not
cleared — a revived bone must pay rent again or the next sweep re-retires it).
When the rite acts, the trail is receipted: `bone.use` → `bone.sweep` →
`bone.retired` → the next reshape without the bone (`node
demo/rite-example.mjs` runs it live; the cost curve falls when the retired
bone leaves the world). Honest limit: re-measurement is opt-in per loop (the
`remeasure` hook) — unmeasured uses do not advance the window, so a bone that
is never re-measured is never retired. Stated, not hidden.

**Bridge 4 lite — the cross-shape bone library** (`core/library.mjs`): one
shared registry any loop can attach to, plus `ask({kind, shape?, predicate?})`
— "which existing bones fit this fixture?" across ALL shapes, candidates
returned with measured `costSaved` attached, never injected (injection stays
the Env/reshape decision, which stays shape-scoped) — plus JSONL
export/import that round-trips the full bone (provenance, costSaved, reuse
ledger, retired status) canon-identically and fail-closed on tamper. Purposes
share a bone economy; a bone retired in one shape is invisible to `ask()`
unless `includeRetired: true`.

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
- `core/` — loop, bones (with the retirement rite), library (Bridge 4 lite),
  purpose, receipts (ESM, zero deps).
- `tests/` — 35 tests: append-only receipts, bone-injection determinism, the
  cost-decreasing property, the negative control, purpose-deadband pause, the
  retirement rite (window rule, off-by-one, exclusion, revive), the cross-shape
  library, and the self-verifying flat control rung.
- `lib/control-ladder.mjs` — the control-rung check as a CLI + reusable
  `assertFlatControl(series)` for other repos.
- `demo/index.html` — self-contained loop visualizer (no network): purpose
  banner, falling cost bars, the bone registry growing, the ghosted control
  loop beside it for contrast, receipts strip. 45 receipts embedded.
- `demo/llm-receipts/` — the live 3-call curve, raw.

## Run it

```bash
node lib/run-experiment.mjs     # offline worked example (writes demo/summary.json)
node demo/rite-example.mjs      # the retirement rite, worked live (writes demo/receipts/rite.jsonl)
node lib/control-ladder.mjs     # the negative control's rung must stay flat (exit 1 if it moves)
node demo/llm-loop.mjs          # live 3-call LLM loop (keys never printed)
node demo/embed.mjs             # rebuild the demo page from receipts
npm test                        # 38/38 (vendor + rite + control + bones + loop + purpose)
```

## Tests & CI

`npm test` (38 tests) plus the standing control check
`node lib/control-ladder.mjs demo/summary.json`: the negative control's rung
must stay FLAT (99 → 99 → 99 ops) — if the control arm moves, bones leaked
into it or the world drifted, and the tool exits 1 naming the iteration and
the delta; otherwise it prints the ladder (control ops vs bones-enabled ops
and the saved delta per iteration: 0, 32, 61). `.github/workflows/ci.yml`
runs both on node 20/24.

## The Band Law (WP-12, vendored)

The purpose gate is one instantiation of a mechanism the fleet derived three
times (see `SuperInstance/quilt-whitepapers` WP-12): `decide(x, region) ->
REST | ESCALATE`. Here `x` is the predicted marginal purpose-per-op and the
region is the value floor `[0, deadband)` — rest (pause, zero ops) while
nothing worth thought is predicted; spend the moment value appears
(`marginal === deadband` already spends). The canonical module lives in
`madlibs-jev/band-law.mjs`; `vendor/band-law.mjs` is a byte-identical copy
with the sha256 pinned in `tests/vendor.test.mjs`, and that test proves the
comparator reproduces EVERY receipted gate decision in both demo ledgers
(main: 3 goes + 1 pause; control: 3 goes). The flat control rung and the
band are complementary views: the band sees marginal value, the ladder sees
the cost curve. Vendor drift fails CI.

## Honest limits

- The cost metric is operation counts (deterministic, receipted), not wall
  time or dollars — chosen so the offline proof needs no network; the LLM
  demo adds prompt chars as a second currency.
- Bone extractors are shape-specific. The flashcard shape ships; other shapes
  need their own compile rules — which is the point: each new shape pays one
  jig-building cost, and every later task of that shape rides it.
- The purpose deadband pauses on low marginal purpose; it does not yet
  re-direct to a different purpose (no portfolio of purposes).
- The retirement rite only sees MEASURED uses: `remeasure` is opt-in per loop,
  and unmeasured uses do not advance the window — a bone that is never
  re-measured is never retired. The library's `ask()` reads the economy;
  whether a cross-shape candidate actually fits is still the borrowing
  strategy's to prove.
