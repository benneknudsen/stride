const fs = require("node:fs");
const path = require("node:path");

module.exports = async function loadAuthCookies(browser) {
  const configuredPath = process.env.PERF_STORAGE_STATE;
  if (!configuredPath) {
    throw new Error(
      "PERF_STORAGE_STATE is not set. Run `npm run perf:session` and point PERF_STORAGE_STATE at the saved storage state file."
    );
  }

  const storageStatePath = path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`PERF_STORAGE_STATE points to a missing file: ${storageStatePath}`);
  }

  let storageState;
  try {
    storageState = JSON.parse(fs.readFileSync(storageStatePath, "utf8"));
  } catch {
    throw new Error(`Unable to read PERF_STORAGE_STATE as JSON: ${storageStatePath}`);
  }

  const cookies = Array.isArray(storageState.cookies) ? storageState.cookies : [];
  if (cookies.length === 0) {
    throw new Error(`PERF_STORAGE_STATE contains no cookies: ${storageStatePath}`);
  }

  await browser.setCookie(
    ...cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? "/",
      expires: typeof cookie.expires === "number" ? cookie.expires : -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite,
    }))
  );
};
