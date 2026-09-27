/**
 * Generates a throwaway secp256k1 wallet for testing the SDK's real signer
 * (`createLocalSigner`). EVM-style address derivation, so it matches the
 * `keyId` the signer presents and is fundable on Arc (EVM-compatible).
 *
 *   node scripts/new-wallet.mjs
 *
 * TESTNET ONLY. The private key is printed once — put it in `.env` as
 * AGENT_PRIVATE_KEY (already gitignored). Never fund this with real value:
 * a plaintext key in a file is fine for faucet USDC and nothing else. For Arc
 * mainnet use a key held by a KMS/HSM or a Circle Wallets (developer-
 * controlled) wallet, and give Spendlens only the address — reconciliation
 * is keyless and never needs the key.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

if (process.env.ARC_NETWORK === "mainnet" && !process.argv.includes("--i-understand-this-is-plaintext")) {
  console.error(
    "\n  Refusing: ARC_NETWORK=mainnet. This script prints a raw private key meant for\n" +
      "  testnet faucet funds. Use a KMS/HSM-backed key or a Circle Wallets wallet for\n" +
      "  real USDC, and register only its address in Spendlens.\n" +
      "  (Override with --i-understand-this-is-plaintext.)\n",
  );
  process.exit(1);
}

const priv = secp256k1.utils.randomSecretKey();
const pubUncompressed = secp256k1.getPublicKey(priv, false).slice(1); // drop 0x04
const address = "0x" + bytesToHex(keccak_256(pubUncompressed).slice(-20));

console.log("");
console.log("  Address (fund this at the faucet):");
console.log("    " + address);
console.log("");
console.log("  Private key (add to .env, keep secret, testnet only):");
console.log("    AGENT_PRIVATE_KEY=0x" + bytesToHex(priv));
console.log("");
