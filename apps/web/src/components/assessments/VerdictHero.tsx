import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { quoteVerdictBadge } from '@/lib/assessment';
import { formatCurrency, formatCurrencyRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Assessment } from '@caradvocate/shared';

/**
 * The answer, at the top of the assessment, in the largest type on the page.
 *
 * WHAT THIS REPLACED AND WHY. The page used to open with a Quote Evaluation card, then a
 * recommendation, then parts, then labor, and only then a Fair Total card -- which carried the
 * biggest number on the screen. So the owner's actual question ("is $640 fair?") was answered by
 * a small badge at the top, while the largest thing on the page was a range they had not asked
 * about. The two cards are merged here because they were always one thought: a quote only means
 * anything against a range, and a range is only interesting because there is a quote to judge.
 *
 * THE FIGURE IS THE OWNER'S OWN NUMBER, not ours. What they want confirmed is the number in
 * their hand, so that is what gets the size; the fair range sits under it as the thing it is
 * being measured against. With no quote on file there is nothing to measure, so the range takes
 * the slot instead -- see NoQuote.
 *
 * NO GREEN ON A FAIR VERDICT. The house colour means identity and location in this app (logo,
 * focus ring, active nav row) and never approval -- see button.tsx. A fair quote is the ordinary
 * case and gets the ordinary surface; only "above the range" earns a tint, and it earns it for
 * the same reason RecallsList reserves red.
 */
export function VerdictHero({ assessment }: { assessment: Assessment }) {
  const { quote, fairTotalLow, fairTotalHigh } = assessment;

  if (!quote) return <NoQuote low={fairTotalLow} high={fairTotalHigh} />;

  const badge = quoteVerdictBadge(assessment);
  const over = quote.amount - fairTotalHigh;

  return (
    <Card className={cn('border-2', over > 0 && 'border-destructive/30 bg-destructive/5')}>
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label font-medium uppercase tracking-widest text-muted-foreground">
              Your quote
            </p>
            {/* `text-h1`, the app's own scale rather than the raw `text-4xl` the old Fair Total
                card used -- this is the page's headline figure and it should be sized by the
                same ladder as every other heading. */}
            <p className="mt-1 text-h1 font-bold tabular-nums">{formatCurrency(quote.amount)}</p>
          </div>
          {badge && (
            <Badge variant={badge.variant} className="mt-1 shrink-0">
              {badge.label}
            </Badge>
          )}
        </div>

        <RangeBar low={fairTotalLow} high={fairTotalHigh} amount={quote.amount} />

        {/*
          The verdict in words, written by the API. It leads the prose block rather than the
          card, because the number above has already said what this is about.
        */}
        <p className="text-sm leading-relaxed">{quote.explanation}</p>

        {/*
          The split, kept from the old Quote Evaluation card. It stays here rather than moving
          down with the rest of the working: it is the owner's own quote broken in two, not our
          benchmark, and it is the first thing someone arguing with a shop reaches for.
        */}
        <ul className="space-y-1 border-t border-dashed pt-4 text-sm text-muted-foreground">
          <li>
            Quoted parts: {formatCurrency(quote.parts)} (range:{' '}
            {formatCurrencyRange(assessment.parts.low, assessment.parts.high)})
          </li>
          <li>
            Quoted labor: {formatCurrency(quote.labor)} (baseline:{' '}
            {formatCurrency(assessment.labor.total)})
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * No quote on file, so there is nothing to judge and the range is the whole answer.
 *
 * This is also where the "take it to your shop" line lives, which used to sit loose between the
 * cards further down. It is the next step for exactly this state and nowhere else.
 */
function NoQuote({ low, high }: { low: number; high: number }) {
  return (
    <Card className="border-2">
      <CardContent className="space-y-3 p-4 sm:p-6">
        <p className="text-label font-medium uppercase tracking-widest text-muted-foreground">
          Fair price for this repair
        </p>
        <p className="text-h1 font-bold tabular-nums">{formatCurrencyRange(low, high)}</p>
        <p className="text-sm text-muted-foreground">
          Bring this to your shop and compare it against their quote.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Where the quote falls against the fair range.
 *
 * A QUOTE ABOVE THE RANGE PINS TO THE RIGHT END and the overage is stated in words underneath.
 * Scaling the track to include the overage would shrink the fair range to a sliver on a wildly
 * high quote and quietly redraw the same verdict at a different width every time; the bar is
 * here for the gist, and the sentence carries the number.
 *
 * Not `PriceRangeBar`, which marks the benchmark average inside the parts card. Its label says
 * "average", the marker means "our figure", and both are the wrong claim for the owner's own
 * quote sitting against our range.
 */
function RangeBar({ low, high, amount }: { low: number; high: number; amount: number }) {
  const span = Math.max(1, high - low);
  const percent = Math.min(100, Math.max(0, ((amount - low) / span) * 100));
  const over = amount - high;

  return (
    <div className="space-y-2">
      <div
        className="relative h-2 w-full rounded-full bg-muted"
        role="img"
        aria-label={`Your quote of ${formatCurrency(amount)} against a fair range of ${formatCurrency(low)} to ${formatCurrency(high)}`}
      >
        <div
          className={cn(
            'absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
            over > 0 ? 'bg-destructive' : 'bg-foreground',
          )}
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>
          Fair range {formatCurrencyRange(low, high)}
        </span>
        {over > 0 && (
          <span className="font-medium text-destructive">
            {formatCurrency(over)} above the top
          </span>
        )}
      </div>
    </div>
  );
}
