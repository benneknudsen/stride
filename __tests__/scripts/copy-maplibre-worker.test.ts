// Issue #279, checklist item 3: `public/maplibre-gl-worker.mjs` and
// `public/maplibre-gl-shared.mjs` used to be hand-copied out of
// `node_modules/maplibre-gl/dist/`, so the next `maplibre-gl` bump could ship a
// main bundle and a worker from two different versions — silently, because
// nothing ever compared them. These tests are that comparison.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "copy-maplibre-worker.mjs");
const DIST = join(ROOT, "node_modules", "maplibre-gl", "dist");
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const installedVersion: string = JSON.parse(
  readFileSync(join(ROOT, "node_modules", "maplibre-gl", "package.json"), "utf8")
).version;

const scratch: string[] = [];
function scratchDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("copy-maplibre-worker", () => {
  it("keeps the public/ worker copies byte-identical to the installed maplibre-gl", () => {
    for (const file of FILES) {
      expect(
        sha256(join(ROOT, "public", file)),
        `${file} is stale — run scripts/copy-maplibre-worker.mjs`
      ).toBe(sha256(join(DIST, file)));
    }
  });

  it("copies both files from the installed package whatever the cwd, and logs the version", () => {
    const target = scratchDir("stride-maplibre-target-");
    const elsewhere = scratchDir("stride-maplibre-cwd-");

    // Run from an unrelated cwd on purpose: the script has to resolve the
    // package relative to *itself*, not to process.cwd().
    const output = execFileSync(process.execPath, [SCRIPT, target], {
      cwd: elsewhere,
      encoding: "utf8",
    });

    for (const file of FILES) {
      expect(sha256(join(target, file))).toBe(sha256(join(DIST, file)));
      expect(output).toContain(file);
    }
    expect(output).toContain(installedVersion);
  });

  it("runs before dev and before build without reordering the migration", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

    expect(pkg.scripts.predev).toContain("copy-maplibre-worker.mjs");
    expect(pkg.scripts.prebuild).toContain("copy-maplibre-worker.mjs");
    // The migration still runs first inside `build` (AGENTS.md).
    expect(pkg.scripts.build).toBe("node scripts/migrate.mjs && next build");
  });
});
