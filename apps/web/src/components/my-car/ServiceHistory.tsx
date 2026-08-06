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

  return (
    <ul className="divide-y">
      {records.map((record) => (
        <li key={record.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <span className="font-medium">{describe(record)}</span>
            {/* Shown because it is what makes the record count towards an interval;
                its absence is worth noticing rather than hiding. */}
            {record.mileageAtService !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                at {record.mileageAtService.toLocaleString('en-US')} mi
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {formatMonthYear(record.date)} · {formatCurrency(record.cost)}
            </span>
            <button
              type="button"
              onClick={() => onEdit(record)}
              className="text-muted-foreground hover:text-foreground"
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
