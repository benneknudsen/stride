/** The numbered section header used across the dashboard: a mono index, the
 * title, and an optional muted aside. */
export function SectionHeading({
  index,
  title,
  aside,
}: {
  index: string;
  title: string;
  aside?: string;
}) {
  return (
    <div className="mb-[18px] flex items-center gap-[11px]">
      <span className="font-mono text-[11px] tracking-[0.08em] text-volt">{index}</span>
      <h2 className="font-display text-[21px] font-semibold tracking-tight text-fg">{title}</h2>
      {aside ? <span className="font-mono text-[11.5px] text-muted">{aside}</span> : null}
    </div>
  );
}
