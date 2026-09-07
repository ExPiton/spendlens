/**
 * Generates a throwaway secp256k1 wallet for testing the SDK's real signer
 * (`createLocalSigner`). EVM-style address derivation, so it matches the
 * `keyId` the signer presents and is fundable on Arc (EVM-compatible).
 *
 *   node scripts/new-wallet.mjs
 *
 * TESTNET ONLY. The private key is printed once — put it in `.env` as
 * AGENT_PRIVATE_KEY (already gitignored). Never fund this with real value.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

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
