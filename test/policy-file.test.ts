import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultPolicyYaml, parsePolicyYaml } from "@/lib/policy-file";
import { PolicyEngine } from "@/sdk/policy-engine";

describe("default policy template", () => {
  it("parses and validates against the policy schema", () => {
    const { config } = parsePolicyYaml(defaultPolicyYaml("research-crawler-01"));
    assert.equal(config.agent, "research-crawler-01");
    assert.equal(config.counterparties.mode, "denylist");
    assert.equal(config.perCall.maxUsdc, 0.05);
    assert.equal(config.budgets.length, 3);
  });

  it("is permissive: an allowed micro-payment to a fresh counterparty passes", async () => {
    const { config } = parsePolicyYaml(defaultPolicyYaml("agent-x"));
    const engine = new PolicyEngine(config);
    const verdict = await engine.evaluate({
      agentId: "agent-x",
      taskId: "t1",
      counterparty: "api.example.io",
      amount: 0.003,
      resource: "https://api.example.io/v1/data",
      now: Date.now(),
    });
    assert.equal(verdict.decision, "allow");
  });

  it("still enforces the per-call ceiling", async () => {
    const { config } = parsePolicyYaml(defaultPolicyYaml("agent-x"));
    const engine = new PolicyEngine(config);
    const verdict = await engine.evaluate({
      agentId: "agent-x",
      taskId: "t1",
      counterparty: "api.example.io",
      amount: 1.0, // over max_usdc 0.05
      resource: "https://api.example.io/v1/data",
      now: Date.now(),
    });
    assert.equal(verdict.decision, "block");
    assert.equal(verdict.ruleHit, "per_call.max_usdc");
  });

  it("rejects invalid YAML", () => {
    assert.throws(() => parsePolicyYaml("version: 1\nagent: x\n")); // missing required sections
  });
});
