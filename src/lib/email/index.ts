import "server-only";

export interface SendEmailInput {
  to: string;
  subject: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
}

const FROM = process.env.EMAIL_FROM ?? "Spendlens <no-reply@localhost>";

function renderHtml({ heading, body, cta }: SendEmailInput): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block">${cta.label}</a></p>
       <p style="color:#666;font-size:13px;word-break:break-all">Or paste this link into your browser:<br>${cta.url}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px">
      <div style="font-weight:700;font-size:18px;letter-spacing:-0.01em;color:#111">spend<span style="color:#3fae5a">lens</span></div>
      <div style="background:#fff;border:1px solid #e6e6e3;border-radius:10px;padding:28px;margin-top:16px">
        <h1 style="margin:0 0 12px;font-size:20px;color:#111">${heading}</h1>
        <p style="margin:0;color:#333;line-height:1.55">${body}</p>
        ${button}
      </div>
      <p style="color:#999;font-size:12px;margin-top:16px">Spendlens · agent spend oversight</p>
    </div></body></html>`;
}

function renderText({ body, cta }: SendEmailInput): string {
  return cta ? `${body}\n\n${cta.label}: ${cta.url}` : body;
}

async function sendViaResend(input: SendEmailInput, apiKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: renderHtml(input),
      text: renderText(input),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}

async function sendViaSmtp(input: SendEmailInput): Promise<void> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  await transport.sendMail({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: renderHtml(input),
    text: renderText(input),
  });
}

/**
 * Sends a transactional e-mail via Resend or SMTP, whichever is configured.
 * With neither set, the message (and any action link) is logged to the server
 * console — enough to click through in local development.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  try {
    if (process.env.RESEND_API_KEY) {
      await sendViaResend(input, process.env.RESEND_API_KEY);
      return;
    }
    if (process.env.SMTP_HOST) {
      await sendViaSmtp(input);
      return;
    }
  } catch (err) {
    console.error("[spendlens] e-mail send failed:", err);
    // fall through to console so the flow is still completable in dev
  }

  console.warn(
    `\n[spendlens] e-mail not configured — logging instead:\n` +
      `  to:      ${input.to}\n` +
      `  subject: ${input.subject}\n` +
      (input.cta ? `  link:    ${input.cta.url}\n` : ""),
  );
}
