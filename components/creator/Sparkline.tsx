/**
 * Tiny SVG sparkline. No chart library — the editorial aesthetic wants a
 * single hairline, not a fully-styled D3 chart, and shipping a chart lib for
 * one shape would bloat the dashboard bundle.
 *
 * Renders:
 *   - a single polyline through normalized values (lime, hairline-thin)
 *   - an optional baseline at zero (for revenue sparklines that include $0 days)
 *   - a "last value" dot on the right edge so the eye lands on "now"
 *
 * The component is fully fluid — it fills its container's width/height via
 * `viewBox` math, so a parent can constrain it however it likes.
 */

interface SparklineProps {
  values: ReadonlyArray<number>;
  /** CSS height in px. Width is 100% of the container. */
  height?: number;
  /** Aria label for screen readers — describe what the line represents. */
  ariaLabel?: string;
  /** Show a flat baseline at y=0; useful for revenue widgets. */
  showBaseline?: boolean;
}

export function Sparkline({
  values,
  height = 36,
  ariaLabel = "Trend over time",
  showBaseline = true,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel} (no data)`}
        className="w-full"
        style={{ height }}
      />
    );
  }

  // Pick a viewBox width that gives ~1px-per-step resolution at typical
  // sparkline sizes. We later scale to fit the container.
  const VIEW_W = Math.max(values.length - 1, 1) * 4;
  const VIEW_H = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);

  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * VIEW_W;
      // Y is inverted in SVG (0 at top), and we leave a 2px top/bottom pad
      // so the line doesn't kiss the container edge.
      const y = VIEW_H - 2 - ((v - min) / span) * (VIEW_H - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const lastX = VIEW_W;
  const lastY =
    VIEW_H -
    2 -
    ((values[values.length - 1] - min) / span) * (VIEW_H - 4);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {showBaseline && (
        <line
          x1={0}
          x2={VIEW_W}
          y1={VIEW_H - 2 - ((0 - min) / span) * (VIEW_H - 4)}
          y2={VIEW_H - 2 - ((0 - min) / span) * (VIEW_H - 4)}
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={0.5}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke="var(--lime)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={1.4} fill="var(--lime)" />
    </svg>
  );
}
