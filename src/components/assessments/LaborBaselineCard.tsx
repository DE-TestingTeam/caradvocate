import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatHours } from '@/lib/format';
import type { Assessment } from '@/types';

export function LaborBaselineCard({ assessment }: { assessment: Assessment }) {
  const { labor } = assessment;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <Accordion type="single" collapsible defaultValue="labor">
          <AccordionItem value="labor">
            <AccordionTrigger className="border-b-0 pt-0">OEM Labor &amp; Time Baseline</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <p className="text-sm font-semibold">
                Labor Rate: {formatCurrency(labor.ratePerHour)}/hr · Est. Time: {formatHours(labor.estHours)}
              </p>
              <h3 className="text-sm font-semibold text-muted-foreground">Task breakdown</h3>

              <ul className="divide-y">
                {labor.tasks.map((task) => (
                  <li key={task.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <span>{task.name}</span>
                    <span className="shrink-0 font-semibold">{task.hours} hr</span>
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
