import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatHours } from "@/lib/format";
import type { Assessment } from "@caradvocate/shared";

/**
 * The labor half of the baseline. No wireframe covers a partly-sourced card, and it is the
 * normal case: the pricing vendor publishes labor as money, a second vendor publishes the
 * hours, and neither publishes a shop rate.
 *
 * `hasBookTime` therefore requires both, which means the rate/time line and the "OEM" title
 * are currently never shown -- the rate is always absent. Per-task hours are separate and do
 * render. Showing a time without a rate is a deliberate open question, not an oversight:
 * see STATUS.md §3 gap 5. Do not "fix" it by inventing a rate.
 */
export function LaborBaselineCard({ assessment }: { assessment: Assessment }) {
  const { labor } = assessment;
  const { ratePerHour, estHours } = labor;
  const hasBookTime = ratePerHour !== undefined && estHours !== undefined;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <Accordion type="single" collapsible defaultValue="labor">
          <AccordionItem value="labor">
            <AccordionTrigger className="border-b-0 pt-0">
              {hasBookTime ? "OEM Labor & Time Baseline" : "Labor Baseline"}
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              {hasBookTime && (
                <p className="text-sm font-semibold">
                  Labor Rate: {formatCurrency(ratePerHour)}/hr · Est. Time:{" "}
                  {formatHours(estHours)}
                </p>
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
                    {task.hours !== undefined && (
                      <span className="shrink-0 font-semibold">
                        {task.hours} hr
                      </span>
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
