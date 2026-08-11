import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isCompleted, verdictBadge } from '@/lib/assessment';
import { formatCurrency, formatCurrencyRange, formatLongDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Assessment } from '@caradvocate/shared';

interface AssessmentCardProps {
  assessment: Assessment;
  onMarkComplete: (assessment: Assessment) => void;
}

/**
 * The figures, replacing the old "Quote Evaluated" / "No Quote" labels -- which said whether a
 * field was filled in, not what anyone learned. What a scan of this list wants is the money:
 * what was quoted, what fair looked like, and -- once it is done -- what was actually paid.
 */
function moneyLine(assessment: Assessment): string {
  const fair = formatCurrencyRange(assessment.fairTotalLow, assessment.fairTotalHigh);

  if (isCompleted(assessment) && assessment.completedCost !== undefined) {
    return `Done for ${formatCurrency(assessment.completedCost)} · fair range was ${fair}`;
  }
  if (assessment.quote) {
    return `Quoted ${formatCurrency(assessment.quote.amount)} · fair range ${fair}`;
  }
  return `Fair range ${fair}`;
}

export function AssessmentCard({
  assessment,
  onMarkComplete,
}: AssessmentCardProps) {
  const badge = verdictBadge(assessment);
  const completed = isCompleted(assessment);

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-colors',
        completed ? 'bg-muted/50 hover:bg-muted' : 'hover:bg-accent/40',
      )}
    >
      {/*
        A stretched link rather than a wrapper: it covers the card with `inset-0` and sits BEHIND
        the row, so the whole card opens the assessment while "Mark repair as complete" stays a
        real button. Wrapping the row in the Link instead would nest a button inside an anchor,
        which is invalid and leaves the click behaviour up to the browser.

        The visible text stays in the row, so the accessible name has to be spelled out here.
      */}
      <Link
        to={`/assessments/${assessment.id}`}
        aria-label={`${assessment.repairName} — open assessment`}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />

      {/*
        One row: name and date left, verdict in the middle, action right. `pointer-events-none`
        hands hover and click straight through to the link underneath -- the exception is the
        action, which turns them back on.

        It wraps rather than truncating. `basis-full sm:basis-auto` puts the name on its own line
        on a phone and drops the badge and action onto the second line together, where `ml-auto`
        pushes the action to the right edge on every width.
      */}
      <div className="pointer-events-none flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h3 className="font-semibold leading-snug">{assessment.repairName}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatLongDate(assessment.createdAt)} · {moneyLine(assessment)}
          </p>
        </div>

        {/*
          The badge sits in a fixed 128px column rather than hugging the action, so it lands at
          the same x on every card and the verdicts read as a column you can scan down. Without
          the width it butts up against "Mark repair as complete" -- the name block's `flex-1`
          eats all the free space, leaving the two right-hand items adjacent. Widen this if a
          longer verdict label ever ships; the badge left-aligns inside it either way.
        */}
        <div className="shrink-0 sm:w-32">
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>

        <div className="pointer-events-auto ml-auto shrink-0">
          {completed ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="h-4 w-4" />
              Repair completed
            </span>
          ) : (
            <Button variant="link" size="inline" onClick={() => onMarkComplete(assessment)}>
              Mark repair as complete
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
