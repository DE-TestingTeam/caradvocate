import * as React from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TREND_POINTS, ValueTrendChart, ValueTrendPlaceholder } from './ValueTrendChart';
import { formatCurrency, formatMileage } from '@/lib/format';
import { cn } from '@/lib/utils';
import { daysSinceMileageReading, mileageIsStale, type Vehicle } from '@caradvocate/shared';

/**
 * `className` is how the masthead hands this card its height -- see MyCar.tsx. The card passes
 * that height down to the trend plot, which is the one part of it that can absorb the slack.
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

  return (
    <Card className={cn('bg-muted/40', className)}>
      {/* `gap-4` in a flex column rather than `space-y-4`, so the trend panel below can take
          `flex-1` and swallow whatever height is left over. */}
      <CardContent className="flex h-full flex-col gap-4 p-4 sm:p-6">
        {/*
          No sparkline beside the figure. It was captioned "30d trend", and there is no such
          thing here: values are checked once a MONTH, so a 30-day window is one reading and one
          reading is not a trend. The panel below, over six monthly readings, is the only trend
          this card can honestly draw.
        */}
        <div>
          {/*
            One step under the car's name, which is `text-h2`. It was `text-4xl` -- 36px against
            the name's 30px -- so the price was the biggest thing in the masthead and the car it
            belongs to came second. `text-h3` also puts it on the app's own fluid scale, so it
            keeps that relationship at every width instead of only at the widest.

            No `tracking-tight` on top: the h3 step already carries -0.0075em, and stacking the
            utility's -0.025em on a row of figures closes the digits up.
          */}
          <div className="text-h3 font-bold">{formatCurrency(vehicle.estMarketValue)}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Est. market value
          </div>
        </div>

        {hasTradeInRange && (
          <p className="text-sm text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
            Based on {formatMileage(vehicle.mileage)}
            {agedNote(vehicle)}
          </p>
        )}

        {/* `min-h-0` is load-bearing: a flex item's floor is its content, so without it this
            panel refuses to shrink below the plot's natural size and pushes the card past the
            photo -- the exact thing the height is being derived to prevent. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-dashed bg-background/60 p-3">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Value trend, last 6 mo
            </div>
            {/* The explanation of the empty chart is worth having, but it is a paragraph an owner
                reads once. It moves behind this control so the card stays a card. */}
            {!hasTrend && <TrendNote collected={vehicle.valueTrend.length} />}
          </div>
          {/*
            `h-20` is the phone's answer and the fallback everywhere else. Stacked below `lg` the
            column has no height to divide up, so `flex-1` would resolve against nothing and the
            plot -- which is sized in percentages -- would collapse to zero and vanish. From `lg`
            the derived height takes over.
          */}
          <div className="h-20 min-h-0 lg:h-auto lg:flex-1">
            {hasTrend ? (
              <ValueTrendChart data={vehicle.valueTrend} />
            ) : (
              <ValueTrendPlaceholder collected={vehicle.valueTrend.length} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Why the chart is empty, revealed on demand.
 *
 * Hover shows it to a pointer, focus shows it to a keyboard, and it is a real button so a tap
 * works on a touch screen -- where hover never fires at all, and an icon that only responds to a
 * mouse would be dead weight on the device most owners are holding.
 *
 * The panel is positioned rather than in flow: opening it must not push the placeholder chart
 * down, or the card jumps every time the pointer crosses the icon.
 */
function TrendNote({ collected }: { collected: number }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-6 w-6 items-center justify-center rounded-pill text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Why this chart is empty</span>
      </button>

      {open && (
        /*
          Says plainly that the history does not exist rather than implying it is loading. An owner
          who is told "no data" assumes something is broken; one who is told the readings are
          monthly and counts the empty dots knows to come back.
        */
        <div className="absolute right-0 top-7 z-10 w-64 max-w-[calc(100vw-4rem)] rounded-md border bg-background p-3 text-sm text-muted-foreground shadow-md">
          We check this car's value once a month and chart it from there. {readingsTaken(collected)} — the line
          appears after the next check. There is no earlier history to fill in: a valuation is priced as of the
          day it is taken.
        </div>
      )}
    </div>
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
    <Card className={cn('bg-muted/40', className)}>
      <CardContent className="space-y-1 p-4 sm:p-6">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Est. market value
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
