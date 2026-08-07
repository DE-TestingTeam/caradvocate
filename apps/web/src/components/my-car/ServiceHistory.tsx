import { Pencil } from 'lucide-react';
import { formatCurrency, formatMonthYear } from '@/lib/format';
import type { ServiceRecord } from '@caradvocate/shared';

function describe(record: ServiceRecord): string {
  return record.source === 'repair_cost_checker'
    ? `${record.description} via Repair Cost Checker`
    : record.description;
}

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

  /*
   * Date above the job rather than beside it. A service history is read down the left edge to
   * place a job in time -- "when did I last do the brakes?" -- and a date stacked over its own
   * entry scans as a column, where one trailing the description does not.
   *
   * The cost stays right-aligned so the figures line up as a column of their own.
   */
  return (
    <ul className="divide-y">
      {records.map((record) => (
        <li key={record.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-label text-muted-foreground">{formatMonthYear(record.date)}</div>
            <div className="mt-0.5 font-medium">{describe(record)}</div>
            {/* Shown because it is what makes the record count towards an interval;
                its absence is worth noticing rather than hiding. */}
            {record.mileageAtService !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                at {record.mileageAtService.toLocaleString('en-US')} mi
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap font-medium tabular-nums">{formatCurrency(record.cost)}</span>
            <button
              type="button"
              onClick={() => onEdit(record)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Edit ${record.description}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
