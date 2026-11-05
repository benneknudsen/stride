import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.PERF_BASE_URL;
const STORAGE_STATE = resolve(".perf-auth/prod.json");
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
  if (!BASE_URL) {
    throw new Error(
      "PERF_BASE_URL is not set. Example: PERF_BASE_URL=https://stride.example npm run perf:session"
    );
  }

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL.replace(/\/$/, "")}/login`);
    console.log("Sign in in the opened browser window. Waiting up to 5 minutes...");

    await page.waitForURL((url) => !/^\/login(?:\/|$)/.test(url.pathname), {
      timeout: LOGIN_TIMEOUT_MS,
    });

    mkdirSync(dirname(STORAGE_STATE), { recursive: true });
    await context.storageState({ path: STORAGE_STATE });
    console.log(`Saved signed-in storage state to ${STORAGE_STATE}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
