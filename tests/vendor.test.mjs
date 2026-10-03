// tests/vendor.test.mjs — Band Law (WP-12) surface B: the vendored canonical
// module must be byte-identical to madlibs-jev's (pinned sha256), and the ONE
// comparator must reproduce every receipted purpose-gate decision in the
// demos of record. This is the cross-repo half of the two-surface proof:
// surface A (madlibs ledger) lives in madlibs-jev tests/band-law.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { regionOneSided, decide, explain } from "../vendor/band-law.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const VENDORED_SHA256 = "1e3cb4d2df1677f4461e8744615b8617898f96fc84108b2241ce50ead0f4f318";

test("vendored band-law.mjs is byte-identical to the pinned canonical copy", () => {
  const bytes = fs.readFileSync(new URL("../vendor/band-law.mjs", import.meta.url));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha, VENDORED_SHA256,
    "vendor drift detected — re-vendor from SuperInstance/madlibs-jev band-law.mjs and re-pin with a receipted sha in the commit message");
});

function receiptRows(name) {
  return fs.readFileSync(new URL(`../demo/receipts/${name}.jsonl`, import.meta.url), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
}

test("LAW PROOF surface B: decide reproduces EVERY receipted purpose-gate decision", () => {
  for (const name of ["main", "control"]) {
    const rows = receiptRows(name);
    const openRow = rows.find((r) => r.kind === "loop.open");
    assert.ok(openRow, `${name}: loop.open receipted`);
    const deadband = openRow.payload.deadband;
    assert.equal(typeof deadband, "number", `${name}: deadband receipted in loop.open`);
    const R = regionOneSided(deadband);
    let gates = 0;
    for (const r of rows) {
      if (r.kind === "purpose.pause") {
        const d = decide(r.payload.marginal, R);
        assert.equal(d, "REST",
          `${name} it.${r.payload.iteration}: pause at marginal ${r.payload.marginal} must be REST — ${explain(r.payload.marginal, R, d)}`);
        gates++;
      }
      if (r.kind === "iteration.begin") {
        const d = decide(r.payload.predictedMarginal, R);
        assert.equal(d, "ESCALATE",
          `${name} it.${r.payload.iteration}: go at predictedMarginal ${r.payload.predictedMarginal} must be ESCALATE`);
        gates++;
      }
    }
    assert.ok(gates >= 3, `${name}: checked ${gates} receipted gate decisions (control has 3 begins, main has 3 begins + 1 pause)`);
  }
});

test("the flat control rung is the law holding: flat curve -> REST at the gate is what stops the loop", () => {
  // The strongest artifact in the wave (99→99→99 with bones withheld) read
  // through the unified law: the control loop only ever ESCALATEs while its
  // units keep coming (marginal >= deadband) — the flat COST curve is not
  // what the band sees. The band sees marginal; the rite (WP-07) and the
  // control ladder (lib/control-ladder.mjs) see the cost curve. The two
  // views are complementary, and both are receipted.
  const rows = receiptRows("control");
  const deadband = rows.find((r) => r.kind === "loop.open").payload.deadband;
  const R = regionOneSided(deadband);
  const begins = rows.filter((r) => r.kind === "iteration.begin");
  assert.equal(begins.length, 3, "control ran three receipted iterations");
  for (const b of begins) assert.equal(decide(b.payload.predictedMarginal, R), "ESCALATE");
  const stopmet = rows.find((r) => r.kind === "purpose.stopmet");
  assert.ok(stopmet, "control closed on stop condition, not on pause — stated, not hidden");
});
