import { NextResponse } from "next/server";
import { handlers } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const { GET } = handlers;

/**
 * Wrap the NextAuth POST handler so magic-link (email) sign-in requests are
 * rate-limited per email address: 5 requests / email / 10 minutes. This blocks
 * unauthenticated brute-force / email-bombing of the magic-link endpoint.
 * All other auth POSTs pass straight through.
 */
export async function POST(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const isMagicLink = pathname.endsWith("/signin/email") || pathname.endsWith("/callback/email");

  if (isMagicLink) {
    let email = "";
    try {
      // Clone so the original request body stays readable for NextAuth.
      const form = await req.clone().formData();
      email = String(form.get("email") ?? "")
        .trim()
        .toLowerCase();
    } catch {
      // No parseable form body — let NextAuth handle the malformed request.
    }

    if (email) {
      const result = rateLimit(`magic-link:${email}`);
      if (!result.allowed) {
        const retryAfter = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        );
      }
    }
  }

  return handlers.POST(req);
}
