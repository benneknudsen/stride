import { expect, test as setup } from "@playwright/test";
import { STORAGE_STATE } from "../../playwright.config";

// /login offers exactly two ways in: an email magic link and Google. Neither
// survives a headless test run. The dev Credentials provider (dev/dev, added in
// auth.config.ts when NODE_ENV is "development") has no form of its own — it
// only exists at the API level, so signing in means driving NextAuth's callback
// endpoint by hand: take a CSRF token, post the credentials against it, and let
// the session cookie land in the jar.
//
// `page.request` shares the browser context's cookie jar, so whatever the POST
// collects is exactly what storageState hands to the rest of the suite.
setup("sign in as the dev user", async ({ page }) => {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const login = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, username: "dev", password: "dev", callbackUrl: "/" },
  });
  expect(login.ok()).toBeTruthy();

  // A 302 out of the callback proves nothing — NextAuth also redirects on a
  // rejected password. Ask who we are instead.
  const session = await page.request.get("/api/auth/session");
  expect(await session.json()).toMatchObject({ user: { email: "dev@stride.local" } });

  // And prove the cookie clears proxy.ts: "/" bounces to /login while signed out.
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: STORAGE_STATE });
});
