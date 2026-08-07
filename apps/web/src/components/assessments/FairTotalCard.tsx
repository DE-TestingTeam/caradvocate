import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatCurrencyRange } from '@/lib/format';
import type { Assessment } from '@caradvocate/shared';

export function FairTotalCard({ assessment }: { assessment: Assessment }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">
          Fair Total Estimate
        </h2>
        <p className="text-4xl font-bold tracking-tight">
          {formatCurrencyRange(
            assessment.fairTotalLow,
            assessment.fairTotalHigh,
          )}
        </p>

        {assessment.quote && (
          <div className="flex items-center justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">Your quote</span>
            <span className="font-semibold">
              {formatCurrency(assessment.quote.amount)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
