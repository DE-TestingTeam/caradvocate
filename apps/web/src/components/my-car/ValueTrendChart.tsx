import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * How many readings a full chart holds. Must match MAX_POINTS in services/marketValueSync.ts,
 * which is what actually caps the stored points -- if they disagree, the placeholder promises a
 * chart of a length the backend will never produce.
 */
export const TREND_POINTS = 6;

/**
 * THE PLOT HAS NO HEIGHT OF ITS OWN. It fills whatever its container gives it, which on My Car
 * is the space left over once the value card has been sized against the photo beside it.
 *
 * This used to be a fixed pixel height, picked so the card's bottom edge landed level with the
 * photo's. That could never work: the photo is `aspect-[3/2]`, so its height is two thirds of
 * the column width and moves with the window, while the card's height is near enough constant.
 * A single number can only be right at one window size, and was wrong at every other. See the
 * masthead in pages/MyCar.tsx for how the height is derived now.
 *
 * `h-full` therefore, and the caller owns the box. The one thing to preserve: the chart and the
 * placeholder must resolve to the SAME height, or the card changes shape the month the line
 * first appears.
 */

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
export function ValueTrendPlaceholder({ collected }: { collected: number }) {
  return (
    <div aria-hidden="true" className="relative flex h-full items-center justify-between">
      {/* The baseline the dots will eventually sit on, dashed to read as provisional. */}
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
      {Array.from({ length: TREND_POINTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'relative h-2 w-2 rounded-full',
            index < collected ? 'bg-foreground' : 'bg-border',
          )}
        />
      ))}
    </div>
  );
}

interface ValueTrendChartProps {
  data: { month: string; value: number }[];
}

/**
 * One size, with month labels. The `compact` sparkline mode went with the "30d trend" slot in the
 * card header -- an axis-less line 32px tall could show a direction but not over what period, and
 * the period was the part that was wrong.
 */
export function ValueTrendChart({ data }: ValueTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
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
