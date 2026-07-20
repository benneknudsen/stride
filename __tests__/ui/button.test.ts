import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";

describe("buttonVariants default variant", () => {
  it("uses Cobalt brand tokens, not legacy Volt tokens", () => {
    const classes = buttonVariants();

    // Cobalt Glass tokens — cobalt surface, silver text, darker cobalt on hover.
    expect(classes).toContain("bg-cobalt");
    expect(classes).toContain("text-silver");
    expect(classes).toContain("hover:bg-cobalt-dark");

    // The legacy Volt-green default must be gone.
    expect(classes).not.toContain("bg-volt");
    expect(classes).not.toContain("volt-dim");
  });

  it("still applies Cobalt tokens when only a size is requested", () => {
    // not-found.tsx / error-state.tsx render the default variant via `size`.
    const classes = buttonVariants({ size: "sm" });

    expect(classes).toContain("bg-cobalt");
    expect(classes).not.toContain("bg-volt");
  });
});
