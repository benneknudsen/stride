// The Stride runner glyph: red circle head + one continuous body/leg stroke +
// two arms at 55% opacity. Shared by the Logo tile, the AI Coach widget and the
// RunnerLoader. Colours are props so the same mark works on silver, cobalt and
// red surfaces. Decorative by default (aria-hidden); pass `title` to label it.
export function RunnerGlyph({
  size = 21,
  stroke = "var(--color-silver)",
  head = "var(--color-red)",
  className,
  title,
}: {
  size?: number;
  stroke?: string;
  head?: string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="74" cy="17" r="11" fill={head} />
      <path
        d="M66 32 L44 50 L60 62 L40 88"
        stroke={stroke}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 50 L22 62 L8 56"
        stroke={stroke}
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M64 40 L86 50" stroke={stroke} strokeWidth="11" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
