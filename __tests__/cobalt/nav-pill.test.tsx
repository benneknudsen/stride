/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Issue #308: the top navigation is a floating pill that grows from zero on
// load (Motion server-renders the hidden state as inline styles, hence the
// jsdom style checks — same contract as the login card, #304 — and scoots away
// once the user really scrolls down, returning on the first upward scroll.
// Under prefers-reduced-motion nothing about it moves and it never hides.
//
// This lives in its own file rather than in navigation.test.tsx because that
// file's sync suite switches to vi.useFakeTimers(); the faked clock freezes
// Motion's jsdom animation driver for every later test in the same file, so a
// pill test placed after them would hang on its first animation. Keep this file
// free of fake timers.
const pathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NavBar } from "@/components/cobalt/NavBar";
import { ROUTES } from "@/lib/routes";

// jsdom has no matchMedia; Motion's useReducedMotion and the bar's own
// `(min-width: 768px)` probe (#321) each read it once and subscribe a change
// listener to the MediaQueryList they first get — so the stub answers per
// query with a single live object each (a getter for `matches` plus working
// listener registration), not a fresh stub per call, or a later flip would
// never reach the cached reference.
function mediaQueryStub(media: string, initialMatches: boolean) {
  const listeners = new Set<() => void>();
  let matches = initialMatches;
  return {
    media,
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

const reducedMotionQuery = mediaQueryStub("(prefers-reduced-motion: reduce)", false);
const desktopQuery = mediaQueryStub("(min-width: 768px)", true);
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => (query.includes("min-width") ? desktopQuery : reducedMotionQuery),
});

function setPrefersReducedMotion(matches: boolean) {
  reducedMotionQuery.setMatches(matches);
}

function setDesktop(matches: boolean) {
  desktopQuery.setMatches(matches);
}

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  fireEvent.scroll(window);
}

// Each test starts at the top: the scroll-hide reads its baseline from
// window.scrollY at effect time, so a scroll left behind by an earlier test
// would invert the next test's first delta.
beforeEach(() => {
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

// Issue #321: below md the bar is hidden by CSS and the BottomTabBar carries
// navigation, so the pill does no work there — no entrance animation and no
// scroll listener. Crossing up to md must bring both back.
describe("phone: the hidden pill does no work (#321)", () => {
  const pill = () => screen.getByTestId("nav-pill");
  const scrollListenerCount = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((call) => call[0] === "scroll").length;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("below 768px: no scroll listener, no entrance", async () => {
    setDesktop(false);
    const addListener = vi.spyOn(window, "addEventListener");
    render(<NavBar />);

    // Armed at mount by the old code; now the listener only exists with the bar.
    expect(scrollListenerCount(addListener)).toBe(0);

    // Two frames in, a running entrance would have moved opacity off zero.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(pill().style.opacity).toBe("0");

    // Scrolling reaches nothing — there is no listener to react.
    scrollTo(600);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(pill().style.opacity).toBe("0");
  });

  test("crossing up to 768px brings the pill in and arms the scroll-hide", async () => {
    setDesktop(false);
    const addListener = vi.spyOn(window, "addEventListener");
    render(<NavBar />);
    expect(scrollListenerCount(addListener)).toBe(0);

    await act(async () => {
      setDesktop(true);
    });

    expect(scrollListenerCount(addListener)).toBe(1);
    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });

    scrollTo(600);
    await waitFor(() => expect(pill().style.opacity).toBe("0"), { timeout: 3000 });
  });
});

describe("floating nav pill (#308)", () => {
  const pill = () => screen.getByTestId("nav-pill");

  beforeEach(() => {
    pathname.mockReturnValue(ROUTES.HOME);
    setPrefersReducedMotion(false);
    setDesktop(true);
  });

  test("starts hidden and ends visible", async () => {
    render(<NavBar />);

    expect(pill().style.opacity).toBe("0");

    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });
  });

  test("hides on a real downward scroll and returns on the first upward one", async () => {
    render(<NavBar />);
    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });

    // Accumulated downward travel past the reference thresholds (y > 150,
    // delta > 120) — the reference's own scroll listener.
    scrollTo(400);
    await waitFor(() => expect(pill().style.opacity).toBe("0"), { timeout: 3000 });

    scrollTo(100);
    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });
  });

  test("prefers-reduced-motion: visible at once and it never hides", async () => {
    setPrefersReducedMotion(true);
    render(<NavBar />);

    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 1000 });

    scrollTo(900);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pill().style.opacity).toBe("1");
  });
});

// Issue #321 round 2: below md the pill is gone, so the account menu moves into
// one free-standing control in the top-right corner — same avatar button, same
// dropdown, plus the entries that would otherwise lose their only way in on the
// phone: the manual sync (connected users) and the connect CTA (signed in
// without Strava), since the pill's SyncButton is hidden down there. The pill
// and its dropdown must stay exactly as they were; `mobile` only adds.
describe("mobile account control (#321)", () => {
  beforeEach(() => {
    pathname.mockReturnValue(ROUTES.HOME);
    setDesktop(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const mobile = () => screen.getByTestId("nav-account-mobile");
  const desktop = () => screen.getByTestId("nav-account-desktop");

  const openMenu = (root: HTMLElement) => {
    fireEvent.click(within(root).getByRole("button", { name: "Kontomenu" }));
  };

  test("signed in: one free-standing control, and Log ud has an entry again", () => {
    render(<NavBar userName="Benne" stravaConnected />);

    const control = mobile();
    // The responsive contract: present below md, gone from md up.
    expect(control.className).toContain("md:hidden");
    // A control, not a bar: no links and no other controls inside it.
    expect(within(control).queryAllByRole("link")).toHaveLength(0);

    openMenu(control);
    expect(within(control).getByRole("menuitem", { name: "Log ud" })).toBeTruthy();
  });

  test("connected: the menu syncs through the same handler and state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, inserted: 0, partial: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NavBar userName="Benne" stravaConnected />);
    const control = mobile();
    openMenu(control);

    fireEvent.click(within(control).getByRole("menuitem", { name: "Synkronisér nu" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/strava/sync",
      expect.objectContaining({ method: "POST" })
    );
    // The menu stays open and turns into the status row, then the terminal one.
    await waitFor(() => expect(within(control).getByText("Syncer…")).toBeTruthy());
    await waitFor(() => expect(within(control).getByText("Synced")).toBeTruthy());
  });

  test("unconnected: the menu offers Forbind Strava, not sync", () => {
    render(<NavBar userName="Benne" stravaConnected={false} />);
    const control = mobile();
    openMenu(control);

    expect(within(control).getByRole("menuitem", { name: "Forbind Strava" })).toBeTruthy();
    expect(within(control).queryByRole("menuitem", { name: /synkronisér/i })).toBeNull();
  });

  test("visitor: no account control on the phone", () => {
    render(<NavBar />);

    expect(screen.queryByTestId("nav-account-mobile")).toBeNull();
  });

  // A tap on a touch screen fires the compatibility mouse events before the
  // click — with open-on-mouseenter the menu opened and the click's toggle
  // shut it in the same tap, and the phone has no other way in.
  test("a tap (mouse compatibility events, then click) opens the menu", () => {
    render(<NavBar userName="Benne" stravaConnected />);
    const button = within(mobile()).getByRole("button", { name: "Kontomenu" });

    fireEvent.mouseOver(button);
    fireEvent.click(button);

    expect(within(mobile()).getByRole("menuitem", { name: "Log ud" })).toBeTruthy();
  });

  test("a mouse hover still opens the menu (progressive enhancement)", () => {
    render(<NavBar userName="Benne" stravaConnected />);
    const button = within(mobile()).getByRole("button", { name: "Kontomenu" });

    fireEvent.pointerOver(button, { pointerType: "mouse" });

    expect(within(mobile()).getByRole("menuitem", { name: "Log ud" })).toBeTruthy();
  });

  test("desktop dropdown stays logout-only", () => {
    render(<NavBar userName="Benne" stravaConnected />);
    const control = desktop();
    openMenu(control);

    expect(within(control).getByRole("menuitem", { name: "Log ud" })).toBeTruthy();
    expect(within(control).queryByRole("menuitem", { name: /synkronisér/i })).toBeNull();
    expect(within(control).queryByRole("menuitem", { name: "Forbind Strava" })).toBeNull();
  });

  test("the account control adds no scroll listener on the phone", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<NavBar userName="Benne" stravaConnected />);

    expect(addListener.mock.calls.filter((call) => call[0] === "scroll")).toHaveLength(0);
  });
});
