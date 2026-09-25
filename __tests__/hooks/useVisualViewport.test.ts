/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKeyboardOpen } from "@/hooks/useVisualViewport";

// Issue #226: the mobile keyboard shrinks the visible viewport and the fixed tab
// bar overlaps whatever is at the bottom. This pins the tab-bar fold trigger
// (useKeyboardOpen) — the reliable "keyboard is up" signal, including Android's
// `interactiveWidget: resizes-content` mode where a height-ratio heuristic misses.

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
