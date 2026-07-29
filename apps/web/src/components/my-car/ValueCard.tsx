import { Card, CardContent } from '@/components/ui/card';
import { ValueTrendChart } from './ValueTrendChart';
import { formatCurrency } from '@/lib/format';
import type { Vehicle } from '@caradvocate/shared';

export function ValueCard({ vehicle }: { vehicle: Vehicle }) {
  // A car the user just added has no valuation yet, and no trend to draw.
  // Say so rather than showing a zero or a made-up figure.
  if (vehicle.estMarketValue === undefined) {
    return <AwaitingValuation />;
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
          {hasTrend && (
            <div className="w-24 shrink-0 text-right">
              <ValueTrendChart data={vehicle.valueTrend} compact />
              <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                30d trend
              </div>
            </div>
          )}
        </div>

        {hasTradeInRange && (
          <p className="text-sm text-muted-foreground">
            Trade in range {formatCurrency(vehicle.tradeInLow!)}–{formatCurrency(vehicle.tradeInHigh!)}
          </p>
        )}

        {hasTrend && (
          <div className="space-y-2 rounded-md border border-dashed bg-background/60 p-3">
            <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Value trend, last 6 mo
            </div>
            <ValueTrendChart data={vehicle.valueTrend} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AwaitingValuation() {
  return (
    <Card className="bg-muted/40">
      <CardContent className="space-y-1 p-4 sm:p-6">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Est. market value
        </div>
        <p className="text-sm text-muted-foreground">
          Not available yet. Vehicle valuation is not connected to a data source, so there is no estimate for this
          car.
        </p>
      </CardContent>
    </Card>
  );
}
