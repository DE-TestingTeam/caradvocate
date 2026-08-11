import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatMonthYear } from '@/lib/format';
import type { ServiceRecord } from '@caradvocate/shared';

/**
 * The service log as a ledger: one row per entry, divided rather than boxed, costs in a column
 * down the right.
 *
 * IT WAS A TWO-COLUMN GRID OF CARDS, on the reasoning that each entry is only a name, a date
 * and a figure, so a single-column list of them left the page mostly margin. That reasoning was
 * right about the entries and wrong about the fix. Half-width cards on a wide dashboard are
 * still four-fifths empty, an odd number of records leaves a hole at the end of the last row,
 * and the grid disagreed with the full-width maintenance list directly above it -- two lists of
 * short rows, laid out two different ways, a heading apart.
 *
 * What actually fills a row here is putting the figures in a column. A ledger is read DOWN the
 * costs, and neither a card grid nor a stack of full-width cards lets you do that. So the money
 * is right-aligned and tabular, the description takes the space it needs on the left, and the
 * dividing rules do the work the card borders were doing at a fraction of the height.
 *
 * Records that came through the Repair Cost Checker wear a badge. "Price checked" and not
 * "verified": the checker compared the price against benchmarks, it did not witness the work.
 */
export function ServiceHistory({
  records,
  onEdit,
}: {
  records: ServiceRecord[];
  onEdit: (record: ServiceRecord) => void;
}) {
  if (records.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No service logged yet.</p>;
  }

  return (
    <ul className="divide-y">
      {records.map((record) => (
        <li
          key={record.id}
          className="group flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            {/* Wraps rather than truncates: "Alternator replacement" cut to fit beside its
                badge is a worse row than one a line taller. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{record.description}</span>
              {record.source === 'repair_cost_checker' && (
                <Badge variant="outline" className="shrink-0">
                  Price checked
                </Badge>
              )}
            </div>
          </div>

          {/*
            Date in its own column rather than under the description. In a ledger the dates line
            up and can be read down as fast as the costs, which is most of the point of the
            shape; tucked beneath the name they were a different length on every row.

            Mileage is shown because it is what makes the record count towards an interval; its
            absence is worth noticing rather than hiding. Hidden below `sm`, where the row has
            no width to spare and the cost is the thing worth keeping.
          */}
          <span className="hidden shrink-0 text-sm tabular-nums text-muted-foreground sm:inline">
            {formatMonthYear(record.date)}
            {record.mileageAtService !== undefined &&
              ` · ${record.mileageAtService.toLocaleString('en-US')} mi`}
          </span>

          {/* Fixed width, so the figures line up down the page however long the descriptions
              beside them run -- a right-aligned column of costs that jogs left and right with
              its neighbours is not a column. */}
          <span className="w-20 shrink-0 text-right font-medium tabular-nums">
            {formatCurrency(record.cost)}
          </span>

          <button
            type="button"
            onClick={() => onEdit(record)}
            /*
              Always present in the layout, only visible on hover or focus -- a pencil on every
              row of a long ledger is a column of noise, but reserving its space stops the costs
              shifting when one appears. Kept visible below `lg`, where there is no hover to
              reveal it: `group-hover` never fires on touch and the control would be unreachable.

              The focus rule is `lg:focus-visible:`, NOT a bare `focus-visible:`. Tailwind emits
              responsive variants after state variants, so an unqualified `focus-visible:opacity-100`
              loses to `lg:opacity-0` and the button stays invisible when tabbed to on a desktop --
              reachable, focused, and impossible to see.
            */
            className="shrink-0 self-center text-muted-foreground opacity-100 transition-opacity hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
            aria-label={`Edit ${record.description}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
