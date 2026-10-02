import { ChallengeParseError } from "./errors";

export interface PaymentChallenge {
  payTo: string;
  maxAmountRequired: number; // in USDC (e.g. 0.003)
  currency?: string;
  scheme?: string;
  nonce?: string;
  chainId?: number;
  rawHeaders: Record<string, string>;
}

/** A payment amount must be a real, non-negative number. The challenge comes
 *  from the *paid server* — i.e. untrusted input — and a negative amount used
 *  to be accepted and booked as negative spend, refilling every budget; an
 *  `Infinity` or `NaN` slipped past the comparisons the same way. */
function isValidAmount(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * Parses HTTP 402 (Payment Required) headers according to the Nanopayments & x402 conventions.
 * Supports:
 * - x402 headers (x-payment-required, x-pay-to, x-amount, etc.)
 * - WWW-Authenticate headers (WWW-Authenticate: Nanopayment payTo="0x...", amount="0.003", currency="USDC")
 * - JSON body or custom Circle Gateway headers.
 */
export function parsePaymentChallenge(
  headers: Headers | Record<string, string>,
  bodyText?: string,
): PaymentChallenge {
  const headerMap: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      headerMap[key.toLowerCase()] = value;
    });
  } else {
    for (const [k, v] of Object.entries(headers)) {
      headerMap[k.toLowerCase()] = v;
    }
  }

  // 1. Check for x402 / custom x-pay-* headers
  const payTo =
    headerMap["x-pay-to"] ||
    headerMap["x402-pay-to"] ||
    headerMap["x-payment-recipient"] ||
    headerMap["x-payment-address"];

  const amountStr =
    headerMap["x-pay-amount"] ||
    headerMap["x402-amount"] ||
    headerMap["x-payment-amount"] ||
    headerMap["x-amount-usdc"];

  const nonce =
    headerMap["x-pay-nonce"] ||
    headerMap["x402-nonce"] ||
    headerMap["x-payment-nonce"];

  const chainIdStr =
    headerMap["x-pay-chain-id"] ||
    headerMap["x402-chain-id"] ||
    headerMap["x-chain-id"];

  let invalidAmount: string | null = null;

  if (payTo && amountStr) {
    const parsedAmount = parseFloat(amountStr);
    if (!isValidAmount(parsedAmount)) invalidAmount = amountStr;
    else {
      return {
        payTo,
        maxAmountRequired: parsedAmount,
        currency: headerMap["x-pay-currency"] || "USDC",
        scheme: "x402",
        nonce,
        chainId: chainIdStr ? parseInt(chainIdStr, 10) : undefined,
        rawHeaders: headerMap,
      };
    }
  }

  // 2. Check WWW-Authenticate header
  const authHeader = headerMap["www-authenticate"];
  if (authHeader) {
    const payToMatch = /payTo="([^"]+)"|pay_to=([^\s,]+)/i.exec(authHeader);
    const amountMatch = /amount="([^"]+)"|amount=([^\s,]+)/i.exec(authHeader);
    const nonceMatch = /nonce="([^"]+)"|nonce=([^\s,]+)/i.exec(authHeader);
    const currencyMatch = /currency="([^"]+)"|currency=([^\s,]+)/i.exec(authHeader);

    const extractedPayTo = payToMatch ? payToMatch[1] || payToMatch[2] : null;
    const extractedAmount = amountMatch ? parseFloat(amountMatch[1] || amountMatch[2]) : null;

    if (extractedPayTo && extractedAmount !== null && !isValidAmount(extractedAmount)) {
      invalidAmount ??= String(extractedAmount);
    } else if (extractedPayTo && extractedAmount !== null) {
      return {
        payTo: extractedPayTo,
        maxAmountRequired: extractedAmount,
        currency: (currencyMatch ? currencyMatch[1] || currencyMatch[2] : null) || "USDC",
        scheme: "nanopayment",
        nonce: nonceMatch ? nonceMatch[1] || nonceMatch[2] : undefined,
        rawHeaders: headerMap,
      };
    }
  }

  // 3. Check JSON body if available
  if (bodyText) {
    try {
      const parsedBody = JSON.parse(bodyText);
      const bPayTo = parsedBody.payTo || parsedBody.pay_to || parsedBody.recipient;
      const bAmount =
        parsedBody.maxAmountRequired ||
        parsedBody.amount ||
        parsedBody.amount_usdc ||
        parsedBody.price;

      if (bPayTo && (typeof bAmount === "number" || typeof bAmount === "string")) {
        const parsedAmount = typeof bAmount === "number" ? bAmount : parseFloat(bAmount);
        if (!isValidAmount(parsedAmount)) {
          invalidAmount ??= String(bAmount);
        } else {
          return {
            payTo: bPayTo,
            maxAmountRequired: parsedAmount,
            currency: parsedBody.currency || "USDC",
            scheme: "json_body",
            nonce: parsedBody.nonce,
            chainId: parsedBody.chainId,
            rawHeaders: headerMap,
          };
        }
      }
    } catch {
      // ignore JSON parse errors and continue to fallback/error
    }
  }

  throw new ChallengeParseError(
    invalidAmount !== null
      ? `the 402 response asked for an invalid payment amount (${invalidAmount}) — it must be a finite, non-negative number`
      : "Response did not contain valid x402 or WWW-Authenticate payment parameters (payTo and amount).",
  );
}
