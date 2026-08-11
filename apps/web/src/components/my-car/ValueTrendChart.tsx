import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * How many readings a full chart holds. Must match MAX_POINTS in services/marketValueSync.ts,
 * which is what actually caps the stored points -- if they disagree, the placeholder promises a
 * chart of a length the backend will never produce.
 */
export const TREND_POINTS = 6;

/**
 * THE PLOT HAS NO HEIGHT OF ITS OWN. It fills whatever its container gives it -- on My Car
 * that is a fixed-height box inside the value card (see ValueCard). The one thing to
 * preserve: the chart and the placeholder must resolve to the SAME height, or the card
 * changes shape the month the line first appears.
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
            // Taken readings wear the same green as the drawn line's recent stretch and
            // endpoint dot, so the placeholder reads as the chart it will become.
            index < collected ? 'bg-brand' : 'bg-border',
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
 * How many of the trailing readings draw in colour. Two INTERVALS -- i.e. the last two months
 * of movement -- which on a full six-point chart is the same share the mock highlighted.
 */
const RECENT_SEGMENTS = 2;

/** The line's two voices: history recedes in grey, the recent stretch carries the colour --
 *  the brand green, matching the active nav row rather than the semantic success token. */
const HISTORY_STROKE = 'hsl(var(--grey-muted))';
const RECENT_STROKE = 'hsl(var(--brand))';

/**
 * A bare two-tone sparkline: no frame, no axis, no tick labels. The card around it names the
 * thing ("Value over time"), states the current figure and captions the direction, so the plot
 * only has to carry the shape -- and each monthly reading is still there on hover.
 *
 * Split into two overlapping series rather than one: recharts draws one stroke per Line, and
 * the boundary point belongs to both so the grey and coloured strokes meet instead of gapping.
 */
export function ValueTrendChart({ data }: ValueTrendChartProps) {
  const recentFrom = Math.max(0, data.length - 1 - RECENT_SEGMENTS);
  const rows = data.map((point, index) => ({
    month: point.month,
    history: index <= recentFrom ? point.value : null,
    recent: index >= recentFrom ? point.value : null,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* `right: 12`, so the endpoint dot is not clipped by the plot edge. */}
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
        <XAxis dataKey="month" hide />
        <YAxis hide domain={['dataMin - 400', 'dataMax + 400']} />
        {/*
          The hover layer: a vertical crosshair plus "Jun · $22,280". The line alone says the
          shape; the readings themselves were invisible before this, and six monthly figures
          are exactly the kind of thing an owner wants to point at.
        */}
        <Tooltip
          content={<TrendTooltip />}
          cursor={{ stroke: 'hsl(var(--border))' }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="history"
          stroke={HISTORY_STROKE}
          strokeWidth={2}
          dot={false}
          // No hover dot on the grey stretch: the boundary reading lives in both series, and
          // two stacked dots in two colours on one point read as a glitch. The crosshair and
          // tooltip still answer the hover.
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="recent"
          stroke={RECENT_STROKE}
          strokeWidth={2}
          // Only the endpoint gets a resting dot: it is the reading the headline figure above
          // the chart states, so the mark ties the two together. A dot on every point would
          // just re-say the line.
          dot={<EndpointDot lastIndex={data.length - 1} />}
          activeDot={{ r: 4, fill: RECENT_STROKE, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Recharts calls this once per point and requires an element back, so the points that draw
 * nothing return an invisible circle rather than null.
 */
function EndpointDot({
  lastIndex,
  cx,
  cy,
  index,
}: {
  lastIndex: number;
  /** Injected by recharts. */
  cx?: number;
  cy?: number;
  index?: number;
}) {
  if (index !== lastIndex || cx === undefined || cy === undefined) {
    return <circle key={index} r={0} />;
  }
  return <circle key={index} cx={cx} cy={cy} r={4} fill={RECENT_STROKE} />;
}

/**
 * "Jun · $22,280" in the app's own popover clothes. Recharts' default tooltip carries its own
 * white box and blue text, which would be the only element on the page not wearing the theme.
 */
function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string;
}) {
  // Two series share the boundary point, so take whichever entry actually holds a number.
  const value = payload?.map((entry) => entry.value).find((v) => typeof v === 'number');
  if (!active || typeof value !== 'number') return null;

  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}
