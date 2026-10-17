// The one page-title recipe. Every top-level page heading — Hjem, Plan,
// Aktiviteter, the activity detail, Coach and the Velkommen landing — uses the
// same serif-italic hero treatment; only layout classes (max-width, centring,
// flex/gap for the intensity meter) are added per surface. Keep this exact so
// all six titles compute the same font values at mobile and desktop widths.
export const PAGE_TITLE_CLASS =
  "m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]";
