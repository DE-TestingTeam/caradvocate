import { formatCurrency, formatMonthYear } from '@/lib/format';
import type { ServiceRecord } from '@/types';

/** Rows created by completing an assessment are suffixed, per the wireframe. */
function describe(record: ServiceRecord): string {
  return record.source === 'repair_cost_checker'
    ? `${record.description} via Repair Cost Checker`
    : record.description;
}

export function ServiceHistory({ records }: { records: ServiceRecord[] }) {
  if (records.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No service logged yet.</p>;
  }

  return (
    <ul className="divide-y">
      {records.map((record) => (
        <li key={record.id} className="flex items-start justify-between gap-4 py-3">
          <span className="min-w-0 font-medium">{describe(record)}</span>
          <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
            {formatMonthYear(record.date)} · {formatCurrency(record.cost)}
          </span>
        </li>
      ))}
    </ul>
  );
}
