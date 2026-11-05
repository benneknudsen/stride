const DEFAULT_BASE_URL = "http://localhost:3000";
const baseUrl = process.env.LHCI_BASE_URL || DEFAULT_BASE_URL;
const paths = ["/", "/demo", "/aktiviteter", "/plan", "/dashboard/coach", "/login"];

const collect = {
  url: paths.map((path) => new URL(path, baseUrl).href),
  numberOfRuns: 5,
  settings: { preset: "desktop" },
};

if (!process.env.LHCI_BASE_URL) {
  collect.startServerCommand = `AUTH_URL=${DEFAULT_BASE_URL} npm start`;
  collect.startServerReadyTimeout = 120000;
}

module.exports = {
  ci: {
    collect,
    upload: {
      target: "filesystem",
      outputDir: process.env.LHCI_OUT ?? ".lighthouseci/out",
    },
  },
};
