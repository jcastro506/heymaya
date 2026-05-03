/**
 * Editorial section wrapper used across the Creator HQ. Mirrors the landing
 * page's hairline + monospaced eyebrow vocabulary so the dashboard reads as
 * the same product, not a separate app.
 *
 * Two variants:
 *   - default: thin top hairline + numbered eyebrow + headline + caption
 *   - tight:   no eyebrow, smaller headline — used for the bottom-of-fold
 *              widgets that don't need a section break
 */

interface SectionProps {
  eyebrow?: string;
  title: string;
  caption?: string;
  /** Right-aligned slot — used for tier badges, last-pull timestamps, etc. */
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "tight";
  /** Optional id for in-page anchors. */
  id?: string;
}

export function Section({
  eyebrow,
  title,
  caption,
  rightSlot,
  children,
  variant = "default",
  id,
}: SectionProps) {
  const isTight = variant === "tight";
  return (
    <section
      id={id}
      className={`px-5 sm:px-8 ${isTight ? "pt-8" : "pt-10 sm:pt-14"}`}
    >
      <div className="mx-auto max-w-5xl">
        {!isTight && (
          <div className="hairline mb-6 sm:mb-8" />
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                {eyebrow}
              </span>
            )}
            <h2
              className={`mt-2 font-display tracking-tight text-paper ${
                isTight
                  ? "text-2xl sm:text-3xl"
                  : "text-3xl leading-[1.05] sm:text-4xl"
              }`}
            >
              {title}
            </h2>
            {caption && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-dim sm:text-base">
                {caption}
              </p>
            )}
          </div>
          {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        </div>
        <div className={isTight ? "mt-5" : "mt-7"}>{children}</div>
      </div>
    </section>
  );
}
