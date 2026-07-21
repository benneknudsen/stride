// Section heading used above every widget block: mono red index, display title,
// mono uppercase hint. Shared by the coach dashboard and the activity detail
// page so the two read as the same system.
export function SectionHeading({
  index,
  title,
  hint,
}: {
  index: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="font-cg-mono text-[11px] text-red">{index}</span>
      <h2 className="m-0 font-cg-display text-[20px] leading-none text-cobalt">{title}</h2>
      <span className="cg-label">{hint}</span>
    </div>
  );
}
