import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePolicyStateStore, PolicyEngine } from "@/sdk";

const dirs: string[] = [];
function tmpFile() {
  const d = mkdtempSync(join(tmpdir(), "spendlens-state-"));
  dirs.push(d);
  return join(d, "state.json");
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("FilePolicyStateStore", () => {
  it("persists spend + seen counterparties and restores them in a new instance", async () => {
    const path = tmpFile();

    const s1 = new FilePolicyStateStore(path, 0);
    s1.recordCall(
      { agentId: "a1", taskId: "task-1", counterparty: "api.example.io", amount: 2, resource: "r" },
      { decision: "allow", ruleHit: null, qualityRules: {} as never, escalation: {} as never, counterparty: "api.example.io", policyHash: "", policyVersion: null },
    );
    s1.recordCall(
      { agentId: "a1", taskId: "task-1", counterparty: "api.example.io", amount: 1.5, resource: "r" },
      { decision: "allow", ruleHit: null, qualityRules: {} as never, escalation: {} as never, counterparty: "api.example.io", policyHash: "", policyVersion: null },
    );
    s1.flush();
    assert.ok(existsSync(path), "state file written");

    const s2 = new FilePolicyStateStore(path, 0);
    assert.equal(s2.getTaskSpend("a1", "task-1"), 3.5, "task spend restored");
    assert.equal(s2.isCounterpartySeen("a1", "api.example.io"), true, "seen set restored");
    assert.equal(s2.getTotalAuthorizationsCount("a1"), 2, "call count restored");
    assert.equal(s2.getDaySpend("a1", Date.now()), 3.5, "day spend restored");
  });

  it("restores the EWMA baseline so a restart doesn't reset burn-rate detection", () => {
    const path = tmpFile();
    const s1 = new FilePolicyStateStore(path, 0);
    s1.setEwmaState("a1", { mu: 0.5, sigma2: 0.01, lastTs: 1_700_000_000_000 });
    s1.flush();

    const s2 = new FilePolicyStateStore(path, 0);
    assert.deepEqual(s2.getEwmaState("a1"), {
      mu: 0.5,
      sigma2: 0.01,
      lastTs: 1_700_000_000_000,
    });
  });

  it("survives a missing / corrupt file by starting empty", () => {
    const path = tmpFile();
    const store = new FilePolicyStateStore(path, 0); // file doesn't exist yet
    assert.equal(store.getTotalAuthorizationsCount("a1"), 0);

    writeFileSync(path, "{ not json");
    const store2 = new FilePolicyStateStore(path, 0);
    assert.equal(store2.getTotalAuthorizationsCount("a1"), 0);
  });

  it("plugs into PolicyEngine as the state store", async () => {
    const path = tmpFile();
    const policy = {
      version: 1,
      agent: "a1",
      budgets: [{ scope: "task" as const, limitUsdc: 3 }],
      perCall: { maxUsdc: 10, maxCallsPerMinute: 600 },
      counterparties: {
        mode: "denylist" as const,
        allow: [],
        deny: [],
        firstSeen: { action: "allow" as const, autoAllowBelowUsdc: 0 },
        newCounterpartyRate: { maxPerHour: 100, action: "alert" as const },
      },
      anomaly: {
        burnRate: { baseline: "ewma" as const, halflifeMinutes: 15, zThreshold: 8, action: "alert" as const },
        newCounterpartyRate: { maxPerHour: 100, action: "alert" as const },
      },
      quality: { failureStatusCodes: [500], emptyBodyIsFailure: true, jsonSchema: null, maxLatencyMs: 8000 },
      escalation: { webhook: "https://example.com/x", timeoutSeconds: 30, onTimeout: "block" as const },
    };

    const store = new FilePolicyStateStore(path, 0);
    const engine = new PolicyEngine(policy as never, store);
    const base = { agentId: "a1", taskId: "task-1", counterparty: "api.x", resource: "r" };

    assert.equal((await engine.evaluate({ ...base, amount: 2 })).decision, "allow");
    // task budget is 3; the second $2 call pushes cumulative spend to 4 > 3
    assert.equal((await engine.evaluate({ ...base, amount: 2 })).decision, "block");
    store.flush();

    // A fresh store reading the same file still knows task-1 is near its cap.
    const reopened = new FilePolicyStateStore(path, 0);
    assert.ok(reopened.getTaskSpend("a1", "task-1") >= 2);
  });
});
