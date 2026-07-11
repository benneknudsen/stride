/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { glassTabStyle } from "@/lib/cobalt/nav-glass";
import { activityRoute, ROUTES } from "@/lib/routes";

// Issue #86 consolidated the two coach routes into ROUTES.COACH. Both navs link
// there, so the tab marker has to light up on that exact path — and only there.
const pathname = vi.fn<() => string>();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ refresh }),
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

// Issue #100: the four pages are public now, so a visitor walks the same tabs a
// signed-in user does. Every one of them has to mark itself — and only itself.
describe("active tab across all four routes (#100)", () => {
  const NAVS = [
    ["NavBar", NavBar],
    ["BottomTabBar", BottomTabBar],
  ] as const;

  // Hjem is the interesting one: "/" is a prefix of every other path, so a naive
  // startsWith check would light it up everywhere.
  const CASES = [
    [ROUTES.HOME, "Hjem"],
    [ROUTES.AKTIVITETER, "Aktiviteter"],
    [ROUTES.COACH, "Coach"],
    [ROUTES.PLAN, "Plan"],
    [activityRoute("demo-01"), "Aktiviteter"], // a nested page marks its parent tab
  ] as const;

  test.each(
    NAVS.flatMap(([navName, Nav]) =>
      CASES.map(([path, label]) => [navName, Nav, path, label] as const)
    )
  )("%s marks exactly %s#... → %s on %s", (_navName, Nav, path, label) => {
    pathname.mockReturnValue(path);
    render(<Nav />);

    expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
    expect(activeLabel()).toContain(label);
  });
});

// The glass has to be an interpolation between two states, not an on/off class:
// both halves declare the same properties so `transition-all` has something to
// animate, and the inactive half is fully transparent.
describe("liquid glass tab style (#100)", () => {
  test("active carries the glass; inactive carries nothing", () => {
    const active = glassTabStyle(true);
    const inactive = glassTabStyle(false);

    expect(active.backdropFilter).toBe("blur(12px)");
    expect(active.background).toBe("rgba(255,255,255,0.7)");
    expect(active.boxShadow).toContain("rgba(27,41,192,0.10)");

    expect(inactive.backdropFilter).toBe("none");
    expect(inactive.background).toBe("rgba(255,255,255,0)");
    expect(inactive.borderColor).toBe("rgba(255,255,255,0)");
  });

  test("both states declare the same properties, so the glass can flow", () => {
    expect(Object.keys(glassTabStyle(false))).toEqual(Object.keys(glassTabStyle(true)));
  });
});

// Issue #97: the sync button used to fake the work with a setTimeout and then sit
// on "synced" forever. It has to call the real endpoint, follow the response, and
// come back to a clickable idle state so a second sync is possible.
describe("NavBar sync (#97)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  const syncButton = () => screen.getByRole("button", { name: /sync now/i });

  /** Fake timers, but let real promises still settle between ticks. */
  const useTimers = () => vi.useFakeTimers({ shouldAdvanceTime: true });

  test("posts to the sync endpoint, refreshes, then falls back to idle", async () => {
    useTimers();
    pathname.mockReturnValue(ROUTES.HOME);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<NavBar />);
    fireEvent.click(syncButton());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/strava/sync",
      expect.objectContaining({ method: "POST" })
    );

    // The response — not a timer — is what ends the syncing state.
    await waitFor(() => expect(screen.getByText("SYNCED")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(syncButton()).toBeTruthy();
  });

  test("a failed sync offers a retry that can sync again", async () => {
    useTimers();
    pathname.mockReturnValue(ROUTES.HOME);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<NavBar />);
    fireEvent.click(syncButton());

    const retry = await screen.findByRole("button", { name: /prøv igen/i });
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("SYNCED")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
