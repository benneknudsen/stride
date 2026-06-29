import nodemailer from "nodemailer";

export async function sendVerificationRequest(params: {
  identifier: string;
  url: string;
  provider: { from?: string };
}) {
  const { identifier, url, provider } = params;

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
