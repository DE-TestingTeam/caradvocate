import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatHours } from '@/lib/format';
import type { Assessment } from '@caradvocate/shared';

/**
 * The labor half of the baseline. No wireframe covers a partly-sourced card, and it is the
 * normal case: the pricing vendor publishes labor as money, a second vendor publishes the
 * hours, and neither publishes a shop rate.
 *
 * THE RATE AND THE TIME ARE TESTED SEPARATELY, and that is the whole point. This card used to
 * require both before showing either, so the hours -- which we have, for 33 of 44 priced jobs
 * and for every assessment on file -- were fetched, stored, sent to the browser and then thrown
 * away, because a rate we have never had was missing. The shared `Assessment` type warns about
 * exactly this: the two are NOT absent together, and a consumer testing for both gets neither.
 *
 * THE TITLE STAYS "Labor Baseline". The mock says "OEM Labor & Time Baseline" and that word
 * cannot be earned here: every row Open Labor Project returns is labelled `estimated`, and its
 * catalogue contradicts itself -- front brake pads at both 1.0 h and 1.5 h for the same car.
 * These are typical times, not manufacturer book times, so the card must not claim otherwise.
 *
 * A rate is still never invented. Dividing the pricing vendor's labor dollars by these hours
 * gives a number well outside any real shop rate; see apps/api/src/services/laborTimes.ts.
 */
export function LaborBaselineCard({ assessment }: { assessment: Assessment }) {
  const { labor } = assessment;
  const { ratePerHour, estHours } = labor;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <Accordion type="single" collapsible defaultValue="labor">
          <AccordionItem value="labor">
            <AccordionTrigger className="border-b-0 pt-0">Labor Baseline</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              {(ratePerHour !== undefined || estHours !== undefined) && (
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {[
                      ratePerHour !== undefined && `Labor rate: ${formatCurrency(ratePerHour)}/hr`,
                      estHours !== undefined && `Est. time: ${formatHours(estHours)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {/*
                    Said plainly, because a bare number invites the wrong argument. An owner who
                    reads "1 hr" and was billed for three has not been shown overbilling: these
                    are one vendor's estimates, they vary by shop and by engine, and the source
                    lists the same job at two different times for the same car. The fair/overpriced
                    verdict deliberately runs on dollars alone and this must not read as part of it.
                  */}
                  {estHours !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      A typical time for this job, not a quote — shops vary. The fair-price check
                      compares dollars, not hours.
                    </p>
                  )}
                </div>
              )}
              <h3 className="text-sm font-semibold text-muted-foreground">
                Task breakdown
              </h3>

              <ul className="divide-y">
                {labor.tasks.map((task) => (
                  <li
                    key={task.name}
                    className="flex items-center justify-between gap-4 py-2.5 text-sm"
                  >
                    <span>{task.name}</span>
                    {/* Was `{task.hours} hr`, which rendered a 1.5-hour job as "1.5 hr" and a
                        0.6-hour one as "0.6 hr". Same formatter as the summary line above, so the
                        two cannot disagree about how a duration reads. */}
                    {task.hours !== undefined && (
                      <span className="shrink-0 font-semibold">{formatHours(task.hours)}</span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold">
                <span>Total Labor Estimate</span>
                <span>{formatCurrency(labor.total)}</span>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
