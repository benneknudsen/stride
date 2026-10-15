/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityDetailHeader } from "@/components/cobalt/aktivitet/ActivityDetailHeader";
import { buildActivityDetailView } from "@/lib/cobalt/aktivitet";

// Issue #317: the activity name is user data — arbitrary length, arbitrary
// words. It flips, but it must keep its readable heading name and every glyph
// must live in the aria-hidden animation, never in the accessibility tree.

const LONG_NAME = "Morgenløb langs åen i Silkeborg";

const view = buildActivityDetailView({
  id: "a1",
  name: LONG_NAME,
  type: "Run",
  startDate: new Date("2026-07-15T08:00:00"),
  distance: 12345,
  movingTime: 3600,
  averageSpeed: 3.43,
});

describe("ActivityDetailHeader — flip title (#317)", () => {
  it("keeps the long activity name as one accessible heading string", () => {
    render(<ActivityDetailHeader view={view} />);

    expect(screen.getByRole("heading", { level: 1, name: LONG_NAME })).toBeTruthy();
  });

  it("animates every glyph of the name inside the aria-hidden span", () => {
    const { container } = render(<ActivityDetailHeader view={view} />);

    const chars = container.querySelectorAll("h1 [data-char]");
    expect(chars).toHaveLength(LONG_NAME.replaceAll(" ", "").length);
    for (const char of chars) {
      expect(char.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
