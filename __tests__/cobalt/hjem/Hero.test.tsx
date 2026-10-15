/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/cobalt/hjem/Hero";

// Issue #317: the Hjem hero headline is the first title to flip. Two things
// must survive that: the greeting line and the recovery note must still read
// as one heading string (the flip splits each character into its own,
// aria-hidden span), and the heading must actually animate through character
// spans. The greeting itself is swapped client-side after mount (#134), so the
// heading is rendered with both the placeholder and a real greeting here.

const BASE = {
  weekNumber: 33,
  weeklyKm: 42.4,
  greeting: "Godaften",
  note: "Hold tempoet roligt i dag.",
  planName: "Silkeborg Halvmarathon",
  started: false,
};

describe("Hero — flip title (#317)", () => {
  it("reads the greeting and the note as one accessible heading string", () => {
    render(<Hero {...BASE} userName="Benne" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Godaften, Benne. Hold tempoet roligt i dag." })
    ).toBeTruthy();
  });

  it("stands alone, unaddressed, when there is no user name", () => {
    render(<Hero {...BASE} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Godaften. Hold tempoet roligt i dag." })
    ).toBeTruthy();
  });

  it("animates the headline through aria-hidden character spans", () => {
    const { container } = render(<Hero {...BASE} userName="Benne" />);

    const chars = container.querySelectorAll("h1 [data-char]");
    expect(chars.length).toBeGreaterThan(0);
    for (const char of chars) {
      expect(char.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
