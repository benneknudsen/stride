/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKeyboardOpen, useVisualViewport } from "@/hooks/useVisualViewport";

// Issue #226: the mobile keyboard shrinks the visible viewport and the fixed tab
// bar overlaps the composer. These pin the two hooks the fix leans on — the panel
// height driver (useVisualViewport) and the tab-bar fold trigger (useKeyboardOpen).

/** A minimal stand-in for `window.visualViewport` — jsdom ships none. */
function makeFakeViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    height,
    offsetTop,
    addEventListener(type: string, cb: EventListener) {
      const set = listeners.get(type) ?? new Set();
      set.add(cb);
      listeners.set(type, set);
    },
    removeEventListener(type: string, cb: EventListener) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type: string) {
      for (const cb of listeners.get(type) ?? []) cb(new Event(type));
    },
  };
}

function setViewport(fake: ReturnType<typeof makeFakeViewport> | undefined) {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
}

describe("useVisualViewport", () => {
  afterEach(() => {
    setViewport(undefined);
  });

  it("falls back to window.innerHeight when visualViewport is unavailable", () => {
    setViewport(undefined);
    const { result } = renderHook(() => useVisualViewport());

    expect(result.current.height).toBe(window.innerHeight);
    expect(result.current.offsetTop).toBe(0);
  });

  it("reads visualViewport.height and offsetTop, updating on resize", () => {
    const fake = makeFakeViewport(800, 0);
    setViewport(fake);

    const { result } = renderHook(() => useVisualViewport());
    expect(result.current.height).toBe(800);

    // Keyboard opens: the visible height shrinks and, on iOS, the viewport shifts.
    act(() => {
      fake.height = 420;
      fake.offsetTop = 60;
      fake.dispatch("resize");
    });

    expect(result.current.height).toBe(420);
    expect(result.current.offsetTop).toBe(60);
  });

  it("tracks visualViewport scroll (iOS shifts offsetTop for the focused field)", () => {
    const fake = makeFakeViewport(500, 0);
    setViewport(fake);

    const { result } = renderHook(() => useVisualViewport());

    act(() => {
      fake.offsetTop = 120;
      fake.dispatch("scroll");
    });

    expect(result.current.offsetTop).toBe(120);
  });
});

describe("useKeyboardOpen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is closed until a text field is focused", () => {
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(result.current).toBe(true);
  });

  it("closes when focus leaves for a non-editable element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(result.current).toBe(true);

    const button = document.createElement("button");
    document.body.appendChild(button);
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: button }));
    });
    expect(result.current).toBe(false);
  });

  it("stays open when focus moves straight to another field", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    // Blur to the textarea: the keyboard never lowers, so it stays "open".
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: textarea }));
    });
    expect(result.current).toBe(true);
  });
});
