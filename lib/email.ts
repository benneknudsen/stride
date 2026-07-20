import nodemailer from "nodemailer";

/**
 * Guard the magic-link URL against host-header poisoning (issue #168).
 *
 * With `trustHost: true` (needed for self-hosted prod, issue #143) and `AUTH_URL`
 * unset, Auth.js builds the sign-in URL from the request's `Host` /
 * `X-Forwarded-Host` header. An attacker can spoof that header so the link a
 * victim receives by email points at an attacker-controlled origin while carrying
 * a valid one-time token — classic reset/verify-link poisoning.
 *
 * In production we close this off unconditionally:
 *   1. `AUTH_URL` (the canonical origin) MUST be set, and
 *   2. the link's host MUST equal `AUTH_URL`'s host.
 * Either check failing throws, so no poisoned mail is ever sent. Dev and test
 * environments skip the guard so local links (localhost, preview hosts) keep
 * working unchanged.
 */
export function assertTrustedMagicLinkUrl(url: string): void {
  if (process.env.NODE_ENV !== "production") return;

  const authUrl = process.env.AUTH_URL;
  if (!authUrl) {
    throw new Error(
      "AUTH_URL must be set in production to prevent magic-link host poisoning (#168)."
    );
  }

  const expectedHost = new URL(authUrl).host;
  const actualHost = new URL(url).host;
  if (actualHost !== expectedHost) {
    throw new Error(
      `Refusing to send magic link to untrusted host "${actualHost}" (expected "${expectedHost}").`
    );
  }
}

export async function sendVerificationRequest(params: {
  identifier: string;
  url: string;
  provider: { from?: string };
}) {
  const { identifier, url, provider } = params;

  assertTrustedMagicLinkUrl(url);

  const transport = nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: {
      user: "resend",
      pass: process.env.RESEND_API_KEY,
    },
  });

  await transport.sendMail({
    to: identifier,
    from: provider.from ?? "Stride <noreply@stride.run>",
    subject: `Sign in to Stride`,
    text: `Sign in to Stride\n\n${url}\n\nThis link expires in 10 minutes.`,
    html: `<p>Click the button below to sign in to <strong>Stride</strong>:</p>
<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#f97316;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Sign in</a></p>
<p style="color:#6b7280;font-size:14px;">This link expires in 10 minutes.</p>`,
  });
}
