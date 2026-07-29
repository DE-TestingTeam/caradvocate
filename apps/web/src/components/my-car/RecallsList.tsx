import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { formatLongDate, formatRecallComponent, formatRecallProse } from '@/lib/format';
import type { Recall, RecallReport } from '@caradvocate/shared';

/**
 * Open safety recalls for the owner's model.
 *
 * Each recall collapses to its component and urgency, because the full NHTSA text
 * is several paragraphs and four of them at once is unreadable. What NHTSA calls
 * the consequence is shown first on expand: the reason to act is more useful than
 * the mechanism.
 */
export function RecallsList({ report }: { report: RecallReport }) {
  if (report.recalls.length === 0) {
    // "Nothing found" and "we could not look" are different claims, and only one
    // of them is reassuring. Never present the second as the first.
    return report.checked ? (
      <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        No open safety recalls for this model.
      </p>
    ) : (
      <p className="py-2 text-sm text-muted-foreground">
        Could not reach the NHTSA recall database. This is not an all-clear — it will fill in once the check succeeds.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {report.recalls.map((recall) => (
        <li key={recall.id} className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${recall.severity === 'high' ? 'text-destructive' : 'text-muted-foreground'}`}
              />
              <span className="min-w-0 font-medium">{formatRecallComponent(recall.component)}</span>
            </span>
            <UrgencyBadge recall={recall} />
          </div>

          {/* The risk is never collapsed. It is the reason to act, and someone
              scanning this list is deciding whether to drive tomorrow. */}
          {recall.consequence && <p className="mt-2 text-sm">{formatRecallProse(recall.consequence)}</p>}

          <p className="mt-2 text-xs text-muted-foreground">
            {/* The campaign number is what a dealer needs to look the recall up. */}
            NHTSA campaign {recall.campaignNumber}
            {recall.reportedOn && ` · reported ${formatLongDate(recall.reportedOn)}`}
          </p>

          {(recall.summary || recall.remedy) && (
            <Accordion type="single" collapsible>
              <AccordionItem value="detail" className="border-0">
                <AccordionTrigger className="py-2 text-sm">What to do about it</AccordionTrigger>
                <AccordionContent className="space-y-3 pb-1 text-sm">
                  {recall.summary && <Detail label="What is wrong">{formatRecallProse(recall.summary)}</Detail>}
                  {recall.remedy && <Detail label="Remedy">{formatRecallProse(recall.remedy)}</Detail>}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </li>
      ))}

      {/*
        NHTSA's feed is keyed by year/make/model, so it reports campaigns affecting
        this car -- not whether this particular one was ever repaired. Saying
        "open recall" would claim more than we know, and a recall from years ago may
        already have been done. The campaign number above is what settles it.

        Recalls do not expire, so an old campaign is listed exactly like a new one.
      */}
      <li className="pt-1 text-xs text-muted-foreground">
        These are recalls issued for your year, make and model. A recall never expires, so older ones still count — but
        NHTSA cannot tell us whether yours was already repaired. Quote the campaign number to a dealer to check; the
        work is free either way.
      </li>
    </ul>
  );
}

/**
 * NHTSA publishes two escalations above an ordinary recall, and they mean very
 * different things to someone deciding whether to drive to work tomorrow.
 */
function UrgencyBadge({ recall }: { recall: Recall }) {
  if (recall.parkIt) {
    return (
      <Badge variant="destructive" className="shrink-0">
        Stop driving
      </Badge>
    );
  }
  if (recall.parkOutside) {
    return (
      <Badge variant="destructive" className="shrink-0">
        Park outside
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      Recall
    </Badge>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}
