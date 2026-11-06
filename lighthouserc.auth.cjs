const base = require("./lighthouserc.cjs");

module.exports = {
  ci: {
    ...base.ci,
    collect: {
      ...base.ci.collect,
      puppeteerScript: "scripts/perf/lhci-auth.cjs",
    },
  },
};
