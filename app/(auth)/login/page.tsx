"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OAuthProvider = "github" | "google";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailLoading(true);
    try {
      const result = await signIn("email", { email, redirect: false });
      if (result?.error) {
        setError("We couldn't send the magic link. Please try again.");
      } else {
        setEmailSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setOauthLoading(provider);
    try {
      await signIn(provider, { callbackUrl: "/" });
    } catch {
      setError("Something went wrong signing you in. Please try again.");
      setOauthLoading(null);
    }
  }

  const busy = emailLoading || oauthLoading !== null;

  return (
    <Card hover={false} className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Welcome to Stride</CardTitle>
        <CardDescription>Sign in to your training dashboard.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {emailSent ? (
          <p className="rounded-lg border border-border-2 bg-card-2 px-4 py-3 text-sm text-fg">
            Check your email for the magic link.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <Input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              aria-invalid={error !== null}
              aria-label="Email address"
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy || !email}>
              {emailLoading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Sending…
                </>
              ) : (
                "Send magic link"
              )}
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted">or continue with</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => handleOAuth("github")}
          >
            {oauthLoading === "github" ? <Loader2 className="animate-spin" /> : <GitHubIcon />}
            Continue with GitHub
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => handleOAuth("google")}
          >
            {oauthLoading === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>
        </div>

        {process.env.NODE_ENV === "development" &&
          typeof window !== "undefined" &&
          window.location.hostname === "localhost" && <DevLogin busy={busy} setError={setError} />}

        <p className="text-center text-sm text-muted">
          Just looking around?{" "}
          <Link href="/" className="font-medium text-volt hover:underline">
            View the demo
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function DevLogin({ busy, setError }: { busy: boolean; setError: (msg: string | null) => void }) {
  const [username, setUsername] = useState("dev");
  const [password, setPassword] = useState("dev");
  const [loading, setLoading] = useState(false);

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Dev login failed");
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("Dev login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">dev only</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={handleDevLogin} className="space-y-3">
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy || loading}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy || loading}
        />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          variant="secondary"
          disabled={busy || loading}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Logging in…
            </>
          ) : (
            "Dev Login"
          )}
        </Button>
      </form>
    </>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3a7.2 7.2 0 0 1-4.07 1.16 7.17 7.17 0 0 1-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3a7.18 7.18 0 0 1 0-4.6V6.62H1.28a12 12 0 0 0 0 10.77l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.28 6.62l3.99 3.09A7.17 7.17 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
