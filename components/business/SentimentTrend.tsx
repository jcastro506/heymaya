/**
 * Sentiment-trend chart for the Reviews screen.
 *
 * Pure-SVG render — no chart library. Mirrors the creator-side `Sparkline`
 * pattern: a couple of dozen lines of SVG beats pulling a 50KB+ dep for a
 * single chart, especially when the data shape (sentiment buckets) is
 * specific enough that a generic chart lib would force adapter shims.
 *
 * Data source: `convex/queries/business/reviews.getSentimentTrend` returns
 * one bucket per day with at least one review. We render three stacked
 * area-style segments per day (positive top, neutral middle, negative
 * bottom) so the operator can see both volume and tone at a glance.
 */

export interface SentimentBucketPoint {
  dayKey: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
}

interface Props {
  buckets: SentimentBucketPoint[];
  width?: number;
  height?: number;
}

export function SentimentTrend({
  buckets,
  width = 520,
  height = 110,
}: Props) {
  if (buckets.length === 0) {
    return (
      <div
        data-testid="biz-sentiment-trend-empty"
        className="flex h-[110px] items-center justify-center rounded-xl border border-[var(--hairline)] bg-ink-2/40 text-xs text-paper-faint"
      >
        Maya needs at least one review to draw the trend.
      </div>
    );
  }

  const padding = { top: 6, right: 6, bottom: 6, left: 6 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1);
  const slotW = w / Math.max(buckets.length, 1);
  const barW = Math.max(2, slotW * 0.65);

  return (
    <svg
      data-testid="biz-sentiment-trend"
      role="img"
      aria-label={`Sentiment trend across ${buckets.length} days`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block max-w-full"
    >
      <rect width={width} height={height} fill="transparent" />
      {buckets.map((b, i) => {
        const x = padding.left + i * slotW + (slotW - barW) / 2;
        const totalH = (b.total / maxTotal) * h;
        const negH = (b.negative / b.total) * totalH;
        const neuH = (b.neutral / b.total) * totalH;
        const posH = (b.positive / b.total) * totalH;
        const yBase = padding.top + h;
        return (
          <g key={b.dayKey}>
            <rect
              x={x}
              y={yBase - negH}
              width={barW}
              height={negH}
              fill="rgb(252, 165, 165)"
              opacity={0.9}
            />
            <rect
              x={x}
              y={yBase - negH - neuH}
              width={barW}
              height={neuH}
              fill="rgba(214, 255, 61, 0.25)"
            />
            <rect
              x={x}
              y={yBase - negH - neuH - posH}
              width={barW}
              height={posH}
              fill="rgb(214, 255, 61)"
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}
