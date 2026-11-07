/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StravaCallbackNotice } from "@/components/cobalt/hjem/StravaCallbackNotice";

describe("StravaCallbackNotice (#366)", () => {
  it("renders the retry seconds when the budget was spent", () => {
    render(<StravaCallbackNotice stravaError="rate_limited" stravaRetry="42" />);

    expect(screen.getByRole("status").textContent).toContain("42");
    expect(screen.getByRole("status").textContent).toContain("Strava-forbindelsen");
  });

  it("shows a short, number-free message for a generic failure", () => {
    render(<StravaCallbackNotice stravaError="true" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Prøv igen");
    expect(alert.textContent).not.toMatch(/\d/);
  });

  it("still explains a rate limit when the retry parameter is missing", () => {
    render(<StravaCallbackNotice stravaError="rate_limited" />);

    expect(screen.getByRole("status").textContent).toContain("Strava-forbindelsen");
  });

  it("renders nothing when there is no error", () => {
    const { container } = render(<StravaCallbackNotice />);

    expect(container.textContent).toBe("");
  });
});
