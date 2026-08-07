import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * How many readings a full chart holds. Must match MAX_POINTS in services/marketValueSync.ts,
 * which is what actually caps the stored points -- if they disagree, the placeholder promises a
 * chart of a length the backend will never produce.
 */
export const TREND_POINTS = 6;

/**
 * Stands in for the trend line before there is one to draw.
 *
 * A car's value is checked once a month and the trend is built forward from the first check
 * (MarketCheck prices a VIN as of today; it has no "what was this worth in March" to backfill),
 * so a newly added car has exactly one reading and no line. The old card simply hid the chart in
 * that state, which left a gap where a returning owner had no way to know a chart was coming at
 * all -- it read as a feature that had failed rather than one that was filling up.
 *
 * So this shows the SHAPE of the eventual chart: one dot per monthly reading, filled for the
 * ones taken and hollow for the ones still to come. That makes the wait legible -- you can count
 * the remaining dots -- without drawing a line through data that does not exist yet.
 *
 * `aria-hidden` because it carries no information the caption beside it does not already state
 * in words; a screen reader announcing six bullets would be noise.
 */
export function ValueTrendPlaceholder({ collected, compact = false }: { collected: number; compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative flex items-center justify-between', compact ? 'h-8' : 'h-[120px]')}
    >
      {/* The baseline the dots will eventually sit on, dashed to read as provisional. */}
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
      {Array.from({ length: TREND_POINTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'relative rounded-full',
            compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
            index < collected ? 'bg-foreground' : 'bg-border',
          )}
        />
      ))}
    </div>
  );
}

interface ValueTrendChartProps {
  data: { month: string; value: number }[];
  /** Sparkline mode: no axes, fixed small height. */
  compact?: boolean;
}

export function ValueTrendChart({ data, compact = false }: ValueTrendChartProps) {
  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={['dataMin - 200', 'dataMax + 200']} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--foreground))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          dy={4}
        />
        <YAxis hide domain={['dataMin - 400', 'dataMax + 400']} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--foreground))"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
