/**
 * Editorial section wrapper for service-business HQ screens.
 *
 * Mirrors the creator-side `components/creator/Section.tsx` shape so the
 * two HQ surfaces read as the same product. Kept as a separate file under
 * `components/business/` because the business product is suppressed/
 * isolated from creator and the creator file may diverge over time.
 */

interface SectionProps {
  eyebrow?: string;
  title: string;
  caption?: string;
  rightSlot?: React.ReactNode;
  /** Optional — header-only Section is supported (e.g. tab-strip without body). */
  children?: React.ReactNode;
  variant?: "default" | "tight";
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
      className={`px-5 sm:px-8 ${isTight ? "pt-6" : "pt-8 sm:pt-12"}`}
    >
      <div className="mx-auto max-w-5xl">
        {!isTight && <div className="hairline mb-5 sm:mb-7" />}
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
        {children !== undefined && (
          <div className={isTight ? "mt-4" : "mt-6"}>{children}</div>
        )}
      </div>
    </section>
  );
}
