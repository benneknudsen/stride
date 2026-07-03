// Coach header: red AI-spark + mono label ("AI COACH · BASERET PÅ N TURE") and a
// two-line serif-italic headline. Sits on the silver paper (no glass), outside
// the loading overlay, so it stays interactive while the panels below load.
export function CoachHeader({ activityCount }: { activityCount: number }) {
  return (
    <header className="px-3 pt-[38px] pb-[22px] [animation:cg-fade-up_0.7s_ease_both] motion-reduce:[animation:none]">
      <div className="mb-3 flex items-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
            fill="var(--color-red)"
          />
        </svg>
        <span className="font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">
          AI Coach · Baseret på {activityCount} ture
        </span>
      </div>
      <h1 className="m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]">
        Spørg om alt
        <br />i din træning.
      </h1>
    </header>
  );
}
