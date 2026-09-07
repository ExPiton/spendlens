import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { PaymentChallenge } from "./challenge";
import type { PaymentAuthorization, SignerFn } from "./guard";

/**
 * A ready-made signer for the common case: the agent holds a secp256k1 wallet
 * key and the paid service accepts a plain ECDSA signature over the payment
 * challenge (the shape most x402 / Nanopayment reference servers use).
 *
 * If your counterparty needs a different envelope (EIP-712 typed data, a
 * Circle-specific payload, etc.), pass your own `signer` to `guard()` instead —
 * this is a sensible default, not the only option.
 *
 *   const pay = guard({
 *     agentId: "research-crawler-01",
 *     signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY!),
 *   });
 */
export function createLocalSigner(privateKeyHex: string): SignerFn {
  const pk = hexToBytes(strip0x(privateKeyHex));
  if (pk.length !== 32) {
    throw new Error("createLocalSigner: private key must be 32 bytes of hex");
  }
  const address = deriveAddress(pk);

  return async (challenge: PaymentChallenge): Promise<PaymentAuthorization> => {
    const nonce = challenge.nonce ?? `nonce_${Date.now()}`;
    const message = canonicalChallenge(challenge, nonce);
    const digest = keccak_256(utf8ToBytes(message));

    // @noble/curves v2 "recovered" layout is recovery(1) || r(32) || s(32).
    // Re-pack as Ethereum-style r(32) || s(32) || v(1), v = recovery + 27.
    const recovered = secp256k1.sign(digest, pk, { format: "recovered" });
    const eth = new Uint8Array(65);
    eth.set(recovered.subarray(1, 65), 0);
    eth[64] = recovered[0] + 27;
    const signature = "0x" + bytesToHex(eth);

    return {
      // `Signature keyId="0x…", nonce="…", sig="0x…"` — a self-describing header
      // the reference servers parse; adjust in a custom signer if yours differs.
      paymentHeader: `Signature keyId="${address}", nonce="${nonce}", sig="${signature}"`,
      nonce,
      authorizationToken: signature,
    };
  };
}

/** Canonical string that both sides hash. Deliberately simple and stable. */
function canonicalChallenge(c: PaymentChallenge, nonce: string): string {
  return [
    "spendlens-payment-authorization",
    `payTo=${c.payTo}`,
    `amount=${c.maxAmountRequired}`,
    `currency=${c.currency ?? "USDC"}`,
    `chainId=${c.chainId ?? ""}`,
    `nonce=${nonce}`,
  ].join("\n");
}

function strip0x(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

/** Ethereum-style address: last 20 bytes of keccak256(uncompressed pubkey[1:]). */
function deriveAddress(pk: Uint8Array): string {
  const pub = secp256k1.getPublicKey(pk, false).slice(1); // drop 0x04 prefix
  const hash = keccak_256(pub);
  return "0x" + bytesToHex(hash.slice(-20));
}
