// Sync the MapLibre worker copies into public/ (issue #279, checklist item 3).
//
// MapLibre's v6 ESM build spawns `maplibre-gl-worker.mjs` relative to its own
// module URL, which no bundler serves, so RouteMap points `setWorkerUrl` at a
// same-origin copy in public/ — and the worker in turn imports
// `maplibre-gl-shared.mjs` next to it. Both used to be hand-copied out of
// node_modules, so a `maplibre-gl` bump could ship a main bundle and a worker
// from two different versions, and the mismatch showed up as a blank route map
// (#275's dead-map class of failure) with nothing logged.
//
// npm runs this automatically via the `predev`/`prebuild` hooks. Node builtins
// only — it has to run before Next, Drizzle or anything else is loaded.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

// Resolved against this script, never against process.cwd() — the copies must
// land in this repo's public/ no matter who invokes the script from where.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "node_modules", "maplibre-gl");
const distDir = path.join(packageDir, "dist");
// Optional target directory, for syncing somewhere other than public/.
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, "public");

// Defensive, not load-bearing: a missing install has to stop the build with a
// readable message instead of an ENOENT stack trace.
if (!existsSync(distDir)) {
  console.error(`[stride] ${distDir} is missing — run npm install first.`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

mkdirSync(targetDir, { recursive: true });
for (const file of FILES) {
  const source = path.join(distDir, file);
  if (!existsSync(source)) {
    console.error(`[stride] maplibre-gl@${version} has no dist/${file} — nothing to sync.`);
    process.exit(1);
  }
  const destination = path.join(targetDir, file);
  copyFileSync(source, destination);
  console.log(`[stride] maplibre-gl@${version}: dist/${file} → ${destination}`);
}
