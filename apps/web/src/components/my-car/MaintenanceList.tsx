import { AlertTriangle, CheckCircle2, HelpCircle, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatLongDate, formatMileage } from '@/lib/format';
import type { MaintenanceItem, MaintenanceStatus } from '@caradvocate/shared';

const statusMeta: Record<
  MaintenanceStatus,
  { label: string; variant: 'destructive' | 'warning' | 'outline'; icon: typeof AlertTriangle }
> = {
  overdue: { label: 'Overdue', variant: 'destructive', icon: AlertTriangle },
  due_soon: { label: 'Due soon', variant: 'warning', icon: AlertTriangle },
  unknown: { label: 'Unknown', variant: 'outline', icon: HelpCircle },
  ok: { label: 'Up to date', variant: 'outline', icon: CheckCircle2 },
};

/**
 * Recurring upkeep, with whether each job is due.
 *
 * Every status here is arithmetic the server did on the interval, the last service
 * logged against the job and the current odometer — so each row can show its own
 * working. That matters more than it sounds: an owner told "overdue" with no reason
 * has to trust us, and one told "due at 68,900, you're at 68,400" can check.
 */
export function MaintenanceList({
  items,
  onEdit,
}: {
  items: MaintenanceItem[];
  onEdit: (item: MaintenanceItem) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No upkeep jobs yet. Add the ones you care about — oil, tyres, brake fluid — with how often each is due, and this
        works out what needs doing from your service history.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const meta = statusMeta[item.status];
        const Icon = meta.icon;
        return (
          <li key={item.id}>
            <Card className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      item.status === 'overdue'
                        ? 'text-destructive'
                        : item.status === 'due_soon'
                          ? 'text-warning-strong'
                          : 'text-muted-foreground'
                    }`}
                  />
                  <span className={item.status === 'overdue' ? 'font-medium' : undefined}>{item.label}</span>
                </div>
                <Working item={item} />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Edit ${item.label}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The reasoning behind the badge.
 *
 * When the status is `unknown` this says *why*, because "unknown" alone reads like a
 * bug. The two reasons need different things from the owner: an interval, or a logged
 * service to measure from.
 */
function Working({ item }: { item: MaintenanceItem }) {
  if (item.status === 'unknown') {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {item.unknownReason === 'no_interval'
          ? 'Set how often this is due to track it.'
          : 'Log this service once to start tracking it.'}
      </p>
    );
  }

  const parts: string[] = [];

  if (item.milesRemaining !== undefined && item.dueAtMileage !== undefined) {
    parts.push(
      item.milesRemaining < 0
        ? `${formatMileage(Math.abs(item.milesRemaining))} past due`
        : `${formatMileage(item.milesRemaining)} to go`,
    );
    parts.push(`due at ${item.dueAtMileage.toLocaleString('en-US')}`);
  } else if (item.dueOn) {
    parts.push(`due ${formatLongDate(item.dueOn)}`);
  }

  if (item.lastServicedMileage !== undefined) {
    parts.push(`last done at ${item.lastServicedMileage.toLocaleString('en-US')}`);
  } else if (item.lastServicedOn) {
    parts.push(`last done ${formatLongDate(item.lastServicedOn)}`);
  }

  return <p className="mt-0.5 text-xs text-muted-foreground">{parts.join(' · ')}</p>;
}
