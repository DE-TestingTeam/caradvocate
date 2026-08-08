import { Card, CardContent } from '@/components/ui/card';
import { TREND_POINTS, ValueTrendChart, ValueTrendPlaceholder } from './ValueTrendChart';
import { formatCurrency } from '@/lib/format';
import type { Vehicle } from '@caradvocate/shared';

export function ValueCard({ vehicle }: { vehicle: Vehicle }) {
  // A car the user just added has no valuation yet, and no trend to draw.
  // Say so rather than showing a zero or a made-up figure.
  if (vehicle.estMarketValue === undefined) {
    return (
      <AwaitingValuation
        missingVin={!vehicle.vin}
        missingZip={!vehicle.zip}
        unavailable={vehicle.valuationUnavailable ?? false}
      />
    );
  }

  const hasTrend = vehicle.valueTrend.length > 1;
  const hasTradeInRange = vehicle.tradeInLow !== undefined && vehicle.tradeInHigh !== undefined;

  return (
    <Card className="bg-muted/40">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-4xl font-bold tracking-tight">{formatCurrency(vehicle.estMarketValue)}</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Est. market value
            </div>
          </div>
          {/* The slot is occupied either way, so the card does not change shape the month the
              line first appears. */}
          <div className="w-24 shrink-0 text-right">
            {hasTrend ? (
              <ValueTrendChart data={vehicle.valueTrend} compact />
            ) : (
              <ValueTrendPlaceholder collected={vehicle.valueTrend.length} compact />
            )}
            <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {hasTrend ? '30d trend' : 'Trend building'}
            </div>
          </div>
        </div>

        {hasTradeInRange && (
          <p className="text-sm text-muted-foreground">
            Trade in range {formatCurrency(vehicle.tradeInLow!)}–{formatCurrency(vehicle.tradeInHigh!)}
          </p>
        )}

        <div className="space-y-2 rounded-md border border-dashed bg-background/60 p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Value trend, last 6 mo
          </div>
          {hasTrend ? (
            <ValueTrendChart data={vehicle.valueTrend} />
          ) : (
            <>
              <ValueTrendPlaceholder collected={vehicle.valueTrend.length} />
              {/*
                Says plainly that the history does not exist rather than implying it is loading.
                An owner who is told "no data" assumes something is broken; one who is told the
                readings are monthly and counts the empty dots knows to come back.
              */}
              <p className="text-sm text-muted-foreground">
                We check this car's value once a month and chart it from there. {readingsTaken(vehicle.valueTrend.length)}{' '}
                — the line appears after the next check. There is no earlier history to fill in:
                a valuation is priced as of the day it is taken.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** "One reading so far" reads better than "1 of 6" for the case that is almost always 1. */
function readingsTaken(count: number): string {
  if (count === 0) return 'The first reading is being taken now';
  if (count === 1) return 'One reading so far';
  return `${count} of ${TREND_POINTS} readings so far`;
}

function AwaitingValuation({
  missingVin,
  missingZip,
  unavailable,
}: {
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
    <Card className="bg-muted/40">
      <CardContent className="space-y-1 p-4 sm:p-6">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Est. market value
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
