import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Demo-mode UI state. This is purely client-side view state (which dataset the
 * dashboard renders) — never server data — so it lives in Zustand per the
 * project convention. Persisted to localStorage so the choice survives
 * navigations between the dashboard and activity pages and page refreshes.
 */
interface DemoState {
  isDemoMode: boolean;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemoMode: false,
      enable: () => set({ isDemoMode: true }),
      disable: () => set({ isDemoMode: false }),
      toggle: () => set((s) => ({ isDemoMode: !s.isDemoMode })),
    }),
    { name: "stride-demo-mode" }
  )
);
