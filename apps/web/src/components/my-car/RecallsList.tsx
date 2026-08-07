import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { formatLongDate, formatRecallComponent, formatNhtsaProse } from '@/lib/format';
import { nhtsaVinRecallUrl } from '@/lib/nhtsa';
import { cn } from '@/lib/utils';
import { isOldVehicle } from '@/lib/vehicleAge';
import type { Recall, RecallReport } from '@caradvocate/shared';

/**
 * Open safety recalls for the owner's model. Each collapses to its component and urgency, since
 * the full NHTSA text is several paragraphs and four at once is unreadable. The consequence
 * comes first on expand: the reason to act is more useful than the mechanism.
 */
export function RecallsList({
  report,
  vin,
  year,
  onStatusChange,
}: {
  report: RecallReport;
  /** Enables the per-car VIN lookup link. Absent when the owner skipped the VIN. */
  vin?: string;
  /** Decides whether the older-vehicle caveat below shows. See lib/vehicleAge.ts. */
  year: number;
  onStatusChange: (campaignNumber: string, repaired: boolean | undefined) => void;
}) {
  const oldVehicleCaveat = isOldVehicle(year) && (
    <p className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
      Recall records for a car this old are sometimes filed under a different name than the one on this page. If
      you want certainty, {vinCheckPrompt(vin)}.
    </p>
  );

  if (report.recalls.length === 0) {
    // "Nothing found" and "we could not look" are different claims; only one is reassuring.
    return (
      <>
        {report.checked ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
            No open safety recalls for this model.
          </p>
        ) : (
          <p className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
            {/* warning-strong, not warning: the fill amber is too faint at this size (see the
                recall urgency icon below). This is not a recall's own urgency, but it should not
                sit as calm as the all-clear case above it. */}
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
            Could not reach the NHTSA recall database. This is not an all-clear — it will fill in once the check
            succeeds. In the meantime, {vinCheckPrompt(vin)}, which asks NHTSA directly rather than by year, make
            and model.
          </p>
        )}
        {oldVehicleCaveat}
      </>
    );
  }

  return (
    <ul className="space-y-2">
      {report.recalls.map((recall) => (
        // A recall the owner has had done recedes but stays listed -- they may be misremembering.
        <li key={recall.id} className={cn('rounded-lg border p-3', recall.repaired && 'opacity-60')}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {recall.repaired ? (
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                /* warning-strong, not warning: the fill amber measures 2.14:1 on
                   white and all but disappears at this size. */
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${recall.parkIt ? 'text-destructive' : 'text-warning-strong'}`}
                />
              )}
              <span className="min-w-0 font-medium">{formatRecallComponent(recall.component)}</span>
            </span>
            {recall.repaired ? (
              <Badge variant="outline" className="shrink-0">
                Done
              </Badge>
            ) : (
              <UrgencyBadge recall={recall} />
            )}
          </div>

          {/* The risk is never collapsed. It is the reason to act, and someone
              scanning this list is deciding whether to drive tomorrow. */}
          {recall.consequence && <p className="mt-2 text-sm">{formatNhtsaProse(recall.consequence)}</p>}

          <p className="mt-2 text-xs text-muted-foreground">
            {/* The campaign number is what a dealer needs to look the recall up. */}
            NHTSA campaign {recall.campaignNumber}
            {recall.reportedOn && ` · reported ${formatLongDate(recall.reportedOn)}`}
          </p>

          {(recall.summary || recall.remedy) && (
            <Accordion type="single" collapsible>
              <AccordionItem value="detail" className="border-0">
                {/*
                  `border-b-0` for the same reason the benchmark cards pass it: the trigger's
                  own rule is meant for a top-level accordion, and here the "Had this done?"
                  row below opens with a border-t. Collapsed, the content between them is
                  zero-height, so the two rules landed 8px apart and read as a double line.
                */}
                <AccordionTrigger className="border-b-0 py-2 text-sm">What to do about it</AccordionTrigger>
                <AccordionContent className="space-y-3 pb-1 text-sm">
                  {recall.summary && <Detail label="What is wrong">{formatNhtsaProse(recall.summary)}</Detail>}
                  {recall.remedy && <Detail label="Remedy">{formatNhtsaProse(recall.remedy)}</Detail>}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          <RepairStatus recall={recall} onChange={onStatusChange} />
        </li>
      ))}

      {/*
        NHTSA's feed is keyed by year/make/model, so it reports campaigns affecting
        this car -- not whether this particular one was ever repaired. The owner does
        know, which is what the control above is for, and their dealer can confirm it
        from the VIN.

        Recalls do not expire, so an old campaign is listed exactly like a new one.
      */}
      <li className="pt-1 text-xs text-muted-foreground">
        These are recalls issued for your year, make and model. A recall never expires, so older ones still count. NHTSA
        cannot tell us whether yours was already repaired — mark them above, or{' '}
        {vin ? (
          <a
            href={nhtsaVinRecallUrl(vin)}
            target="_blank"
            rel="noopener noreferrer"
            className="link-inline"
          >
            check your VIN with NHTSA
          </a>
        ) : (
          'quote the campaign number to a dealer'
        )}
        . The work is free either way.
      </li>

      {oldVehicleCaveat && <li>{oldVehicleCaveat}</li>}
    </ul>
  );
}

/**
 * The owner's answer to "has this been done?". Three states, not two -- unknown is the default
 * and is not the same as outstanding. Both answers are reversible, so a mis-click on a safety
 * recall cannot leave someone with a warning hidden behind an opacity change.
 */
function RepairStatus({
  recall,
  onChange,
}: {
  recall: Recall;
  onChange: (campaignNumber: string, repaired: boolean | undefined) => void;
}) {
  if (recall.repaired === undefined) {
    return (
      <div className="mt-2 flex items-center gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">Had this done?</span>
        <button
          type="button"
          onClick={() => onChange(recall.campaignNumber, true)}
          className="link-inline"
        >
          Yes
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => onChange(recall.campaignNumber, false)}
          className="link-inline"
        >
          Not yet
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
      <span>{recall.repaired ? 'You marked this as done.' : 'You marked this as still outstanding.'}</span>
      <button
        type="button"
        onClick={() => onChange(recall.campaignNumber, undefined)}
        className="link-inline"
      >
        Undo
      </button>
    </div>
  );
}

/**
 * NHTSA's two escalations above an ordinary recall, which mean different things to someone
 * deciding whether to drive to work tomorrow.
 */
function UrgencyBadge({ recall }: { recall: Recall }) {
  // Red is reserved for "do not drive this". Park-outside is serious but less restrictive -- the
  // car is still drivable -- so it takes the middle colour.
  if (recall.parkIt) {
    return (
      <Badge variant="destructive" className="shrink-0">
        Stop driving
      </Badge>
    );
  }
  if (recall.parkOutside) {
    return (
      <Badge variant="warning" className="shrink-0">
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

/**
 * NHTSA's VIN lookup queries their site directly rather than our year/make/model feed, so
 * it is a real alternative -- not just a repeat of the same question -- whenever that feed
 * has not answered, or answered under a model name that turns out to be wrong.
 */
function vinCheckPrompt(vin?: string) {
  return vin ? (
    <a
      href={nhtsaVinRecallUrl(vin)}
      target="_blank"
      rel="noopener noreferrer"
      className="link-inline"
    >
      check your VIN with NHTSA
    </a>
  ) : (
    'ask your dealer to check your VIN'
  );
}
