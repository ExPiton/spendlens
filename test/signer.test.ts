import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLocalSigner } from "@/sdk/signer";
import type { PaymentChallenge } from "@/sdk/challenge";

const challenge: PaymentChallenge = {
  payTo: "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12",
  maxAmountRequired: 0.003,
  currency: "USDC",
  nonce: "nonce-123",
  chainId: 5042,
  rawHeaders: {},
};

describe("createLocalSigner", () => {
  it("derives the well-known address for private key 0x01", async () => {
    const sign = createLocalSigner("0x" + "00".repeat(31) + "01");
    const auth = await sign(challenge);
    assert.match(
      auth.paymentHeader,
      /keyId="0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"/i,
    );
  });

  it("returns a 65-byte (r||s||v) signature with an Ethereum v", async () => {
    const sign = createLocalSigner("11".repeat(32));
    const auth = await sign(challenge);
    const m = /sig="0x([0-9a-f]+)"/i.exec(auth.paymentHeader);
    assert.ok(m, auth.paymentHeader);
    assert.equal(m![1].length, 130); // 65 bytes
    const v = parseInt(m![1].slice(128), 16);
    assert.ok(v === 27 || v === 28, `v=${v}`);
    assert.equal(auth.nonce, "nonce-123");
  });

  it("is deterministic for the same key + challenge", async () => {
    const a = await createLocalSigner("22".repeat(32))(challenge);
    const b = await createLocalSigner("22".repeat(32))(challenge);
    assert.equal(a.paymentHeader, b.paymentHeader);
  });

  it("rejects a bad key length", () => {
    assert.throws(() => createLocalSigner("abcd"));
  });
});
