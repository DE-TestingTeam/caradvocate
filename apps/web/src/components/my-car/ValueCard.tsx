import { InfoPopover } from '@/components/InfoPopover';
import { Card, CardContent } from '@/components/ui/card';
import { TREND_POINTS, ValueTrendChart, ValueTrendPlaceholder } from './ValueTrendChart';
import { formatCurrency, formatMileage } from '@/lib/format';
import { daysSinceMileageReading, mileageIsStale, type Vehicle } from '@caradvocate/shared';

/**
 * Sizes to its own content. It used to be handed a height derived from the vehicle photo
 * beside it; the photo left the page in the dashboard restyle, so the trend plot below
 * carries a fixed height again and `className` is just placement.
 */
export function ValueCard({ vehicle, className }: { vehicle: Vehicle; className?: string }) {
  // A car the user just added has no valuation yet, and no trend to draw.
  // Say so rather than showing a zero or a made-up figure.
  if (vehicle.estMarketValue === undefined) {
    return (
      <AwaitingValuation
        className={className}
        missingVin={!vehicle.vin}
        missingZip={!vehicle.zip}
        unavailable={vehicle.valuationUnavailable ?? false}
      />
    );
  }

  const hasTrend = vehicle.valueTrend.length > 1;
  const hasTradeInRange = vehicle.tradeInLow !== undefined && vehicle.tradeInHigh !== undefined;
  const caption = trendCaption(vehicle.valueTrend);

  return (
    // Plain white, like the Known Issues card below it -- the sidebar reads as one column of
    // cards, and the muted tint made this one look disabled next to its neighbours.
    <Card className={className}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Value over time
          </div>
          {/* The explanation of the empty chart is worth having, but it is a paragraph an owner
              reads once. It lives behind this control so the card stays a card. */}
          {!hasTrend && <TrendNote collected={vehicle.valueTrend.length} />}
        </div>

        {/*
          One step under the car's name, which is `text-h2` -- the price must not outrank the
          car it belongs to. No `tracking-tight` on top: the h3 step already carries -0.0075em,
          and stacking the utility's -0.025em on a row of figures closes the digits up.
        */}
        <div className="mt-1 text-h3 font-bold">{formatCurrency(vehicle.estMarketValue)}</div>

        {/*
          The plot runs edge to edge with no frame or axis of its own -- the eyebrow above
          says what it is and the caption below says what it does, so a box and tick labels
          around four inches of line were furniture. Hover still names each monthly reading.
          Fixed height: the plot is sized in percentages and would collapse in an auto-height
          box, and the placeholder resolves to this same height so the card never changes
          shape the month the line first appears.
        */}
        <div className="mt-2 h-28">
          {hasTrend ? (
            <ValueTrendChart data={vehicle.valueTrend} />
          ) : (
            <ValueTrendPlaceholder collected={vehicle.valueTrend.length} />
          )}
        </div>

        {/* What the line adds up to, in words -- computed from the same readings, so the two
            cannot disagree. Never a comparison to "the average compact SUV": there is no
            segment-average data here to compare against, however good that sentence sounds. */}
        {caption && <p className="mt-2 text-sm text-muted-foreground">{caption}</p>}

        {hasTradeInRange && (
          <p className="mt-1 text-sm text-muted-foreground">
            Trade in range {formatCurrency(vehicle.tradeInLow!)}–{formatCurrency(vehicle.tradeInHigh!)}
          </p>
        )}

        {/*
          Names the mileage the price was worked out from, which the card could not do until
          `mileageUpdatedAt` existed -- there was no way to say whether that figure was current.
          It matters because the vendor prices on miles: a stale odometer prices the car as one
          with fewer miles on it, and the estimate reads high. Saying which number was used is
          what lets an owner notice it is wrong; the prompt below the masthead is where they fix
          it. Silent on a fresh reading, because then it is just noise on the number they came for.
        */}
        {mileageIsStale(vehicle) && (
          <p className="mt-1 text-sm text-muted-foreground">
            Based on {formatMileage(vehicle.mileage)}
            {agedNote(vehicle)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Down 3.3% over the last 5 months." from the monthly readings, or nothing before there are
 * two to compare. The window is however many readings exist -- a car three readings in gets
 * "2 months", not a pretend six.
 */
function trendCaption(trend: Vehicle['valueTrend']): string | undefined {
  if (trend.length < 2) return undefined;

  const first = trend[0].value;
  const last = trend[trend.length - 1].value;
  if (first <= 0) return undefined;

  const pct = ((last - first) / first) * 100;
  const months = trend.length - 1;
  const span = `over the last ${months === 1 ? 'month' : `${months} months`}`;

  if (Math.abs(pct) < 0.5) return `Holding steady ${span}.`;
  return `${pct < 0 ? 'Down' : 'Up'} ${Math.abs(pct).toFixed(1)}% ${span}.`;
}

/**
 * Why the chart is empty, revealed on demand. Says plainly that the history does not exist
 * rather than implying it is loading: an owner who is told "no data" assumes something is
 * broken; one who is told the readings are monthly and counts the empty dots knows to come
 * back. The hover/focus/tap mechanics live in InfoPopover, shared with the stat strip.
 */
function TrendNote({ collected }: { collected: number }) {
  return (
    <InfoPopover label="Why this chart is empty" align="end">
      We check this car's value once a month and chart it from there. {readingsTaken(collected)} — the line
      appears after the next check. There is no earlier history to fill in: a valuation is priced as of the
      day it is taken.
    </InfoPopover>
  );
}

/**
 * " — a reading from about 8 months ago", or nothing when the date is unknown. Kept vague on
 * purpose: the owner needs to know the figure is old, and to the month is enough to prompt that.
 */
function agedNote(vehicle: Vehicle): string {
  const days = daysSinceMileageReading(vehicle);
  if (days == null) return '';

  const months = Math.floor(days / 30);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    return `, a reading from over ${years === 1 ? 'a year' : `${years} years`} ago`;
  }
  return `, a reading from about ${months} months ago`;
}

/** "One reading so far" reads better than "1 of 6" for the case that is almost always 1. */
function readingsTaken(count: number): string {
  if (count === 0) return 'The first reading is being taken now';
  if (count === 1) return 'One reading so far';
  return `${count} of ${TREND_POINTS} readings so far`;
}

function AwaitingValuation({
  className,
  missingVin,
  missingZip,
  unavailable,
}: {
  className?: string;
  missingVin: boolean;
  missingZip: boolean;
  unavailable: boolean;
}) {
  const missing = [missingVin && 'VIN', missingZip && 'zip code'].filter(Boolean).join(' and ');

  /*
   * The `unavailable` branch used to explain itself: "usually a sign it's old enough to fall
   * outside pricing data". It was a confident, specific guess, and a wrong one -- the same
   * state is reached when the pricing vendor cannot answer for reasons that have nothing to do
   * with the car, and an owner was being told something untrue about their vehicle to fill the
   * space. See the note on `failure` in services/marketCheck.ts.
   *
   * All we actually know here is that we asked and got no price back. So that is what it says,
   * and it points at the vehicle's age as a possibility rather than a diagnosis.
   */
  const message = missing
    ? `Not available yet. Add your car's ${missing} in Account to get an estimate.`
    : unavailable
      ? "No estimate came back for this car. Older vehicles are the usual reason, but we can't confirm that from here — we'll keep trying."
      : "Not available yet. We're still pricing this car — check back shortly.";

  return (
    <Card className={className}>
      <CardContent className="space-y-1 p-4 sm:p-6">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Est. market value
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
