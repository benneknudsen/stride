/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStartupReveal } from "@/hooks/useStartupReveal";

// The shared startup "reveal" beat (issue #138): every Cobalt page client used to
// inline the same `loading` state + 300ms timeout + cleanup. These pin the extracted
// hook's contract so the four call sites can lean on one implementation and one test.
describe("useStartupReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts loading and reveals after the default 300ms beat", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStartupReveal());

    // Mounted but not yet revealed: the overlay is up.
    expect(result.current.loading).toBe(true);
    expect(result.current.started).toBe(false);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // The beat elapsed — reveal fires and `started` is the inverse of `loading`.
    expect(result.current.loading).toBe(false);
    expect(result.current.started).toBe(true);
  });

  it("honours a custom delay — the reveal waits the full duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStartupReveal(1000));

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // The default beat would have fired by now; the custom 1000ms one has not.
    expect(result.current.loading).toBe(true);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.started).toBe(true);
  });

  it("clears its pending timer on unmount so it can't reveal after teardown", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = renderHook(() => useStartupReveal());

    // Isolate the timer our effect scheduled (delay === 300) from any the test
    // runtime may create, then assert the cleanup cancels exactly that one.
    const idx = setSpy.mock.calls.findIndex((args) => args[1] === 300);
    expect(idx).toBeGreaterThanOrEqual(0);
    const timerId = setSpy.mock.results[idx]?.value;

    unmount();

    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });
});
