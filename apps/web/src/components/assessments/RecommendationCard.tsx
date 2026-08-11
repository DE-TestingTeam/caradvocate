import { AlertTriangle, Check, Dot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Assessment, NecessityBand, NecessitySignal } from '@caradvocate/shared';

/**
 * Whether the repair holds up against this car's own record -- the paid tier's headline claim,
 * and until now the one card on this page that did not mean anything. Every assessment carried
 * the same sentence copied off the benchmark ("Priced for your car", badge ASSESSED), which is
 * a statement about pricing standing where a judgement should be.
 *
 * THE WORKING IS SHOWN, NOT JUST THE VERDICT, for the reason Ask CA prints its "Based on" line:
 * an owner cannot take "worth questioning" to a shop, but they can take "your factory schedule
 * puts this at 60,000 miles and you are at 38,000". The prose above the list was written from
 * these exact sentences, so the two cannot drift apart.
 *
 * NO COLOUR ON A SUPPORTED VERDICT. Green means identity and location in this app and never
 * approval (see button.tsx and VerdictHero), and a tint on the ordinary case would train an
 * owner to read the absence of one as a warning. Only `worth_questioning` earns a tint, on the
 * same terms RecallsList earns red.
 */
export function RecommendationCard({ assessment }: { assessment: Assessment }) {
  const { recommendation, necessity } = assessment;

  // Created before the check existed. Its stored recommendation is the old fixed string, so
  // showing it would re-tell exactly the thing this card stopped saying. Nothing is backfilled:
  // these four assessments never recorded what prompted them, which is the input the verdict
  // turns on, and inventing one after the fact is the one thing that must not happen.
  if (!necessity) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-body-lg font-semibold tracking-tight">Not checked</h2>
            <Badge variant="outline" className="shrink-0">
              BEFORE THIS CHECK
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This assessment was created before we began checking a repair against your car's own
            record, and we cannot judge it now without knowing what prompted it. The pricing below
            is unaffected.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={necessity.band === 'worth_questioning' ? 'border-warning/40 bg-warning/5' : undefined}>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-body-lg font-semibold tracking-tight">{recommendation.headline}</h2>
            <Badge variant={badgeVariant(necessity.band)} className="shrink-0">
              {recommendation.badge}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{recommendation.body}</p>
        </div>

        {necessity.signals.length > 0 && (
          <div className="space-y-2 border-t border-dashed pt-4">
            <p className="text-label font-medium uppercase tracking-widest text-muted-foreground">
              What this is based on
            </p>
            <ul className="space-y-1.5">
              {necessity.signals.map((signal, index) => (
                <SignalRow key={index} signal={signal} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * `worth_questioning` is the only band that gets colour, and it gets `warning` rather than
 * `destructive`: nothing here says the shop is wrong, only that something does not line up and
 * is worth asking about. Red is for an unrepaired stop-driving recall.
 */
function badgeVariant(band: NecessityBand): 'secondary' | 'warning' | 'outline' {
  switch (band) {
    case 'holds_up':
      return 'secondary';
    case 'worth_questioning':
      return 'warning';
    case 'not_enough':
      return 'outline';
  }
}

/**
 * One fact, marked with what it does to the verdict.
 *
 * The marker is an icon AND the stance is carried in the text for a screen reader, because a
 * tinted triangle is the whole difference between "we found this" and "ask about this" and
 * colour alone cannot carry it.
 */
function SignalRow({ signal }: { signal: NecessitySignal }) {
  const { icon, label } =
    signal.stance === 'questions'
      ? { icon: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />, label: 'Worth asking about:' }
      : signal.stance === 'supports'
        ? { icon: <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />, label: 'Supports this:' }
        : { icon: <Dot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />, label: '' };

  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      {icon}
      <span>
        {label && <span className="sr-only">{label} </span>}
        {signal.detail}
      </span>
    </li>
  );
}
