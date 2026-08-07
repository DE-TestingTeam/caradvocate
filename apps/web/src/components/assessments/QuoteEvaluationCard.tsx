import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { quoteVerdictBadge } from '@/lib/assessment';
import { formatCurrency, formatCurrencyRange } from '@/lib/format';
import type { Assessment } from '@caradvocate/shared';

export function QuoteEvaluationCard({
  assessment,
}: {
  assessment: Assessment;
}) {
  const { quote, parts, labor } = assessment;
  if (!quote) return null;
  const badge = quoteVerdictBadge(assessment);

  return (
    <Card className="border-2 bg-muted/60">
      <CardContent className="space-y-3 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Quote Evaluation
          </h2>
          {badge && (
            <Badge variant={badge.variant} className="shrink-0">
              {badge.label}
            </Badge>
          )}
        </div>

        <p className="text-sm leading-relaxed">{quote.explanation}</p>

        <ul className="space-y-1 border-t border-dashed pt-3 text-sm text-muted-foreground">
          <li>
            · Quoted parts: {formatCurrency(quote.parts)} (range:{" "}
            {formatCurrencyRange(parts.low, parts.high)})
          </li>
          <li>
            · Quoted labor: {formatCurrency(quote.labor)} (baseline:{" "}
            {formatCurrency(labor.total)})
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
