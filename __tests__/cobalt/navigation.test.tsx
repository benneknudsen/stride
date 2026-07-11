/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { ROUTES } from "@/lib/routes";

// Issue #86 consolidated the two coach routes into ROUTES.COACH. Both navs link
// there, so the tab marker has to light up on that exact path — and only there.
const pathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

/** The nav item whose aria-current marks it as the open page. */
function activeLabel(): string | undefined {
  return screen.queryByRole("link", { current: "page" })?.textContent ?? undefined;
}

describe("coach tab marker on the consolidated route", () => {
  test("NavBar and BottomTabBar both point Coach at the canonical route", () => {
    expect(ROUTES.COACH).toBe("/dashboard/coach");
  });

  test.each([
    ["NavBar", NavBar],
    ["BottomTabBar", BottomTabBar],
  ])("%s marks Coach active on ROUTES.COACH", (_name, Nav) => {
    pathname.mockReturnValue(ROUTES.COACH);
    render(<Nav />);

    expect(activeLabel()).toContain("Coach");
    expect(screen.getByRole("link", { current: "page" })).toHaveProperty("pathname", ROUTES.COACH);
  });

  test.each([
    ["NavBar", NavBar],
    ["BottomTabBar", BottomTabBar],
  ])("%s does not mark Coach active on Hjem", (_name, Nav) => {
    pathname.mockReturnValue(ROUTES.HOME);
    render(<Nav />);

    expect(activeLabel()).toContain("Hjem");
  });
});
