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
 * Recurring upkeep, with whether each job is due. Every status is arithmetic the server did on
 * the interval, the last logged service and the odometer, so each row can show its working: an
 * owner told "overdue" has to trust us, one told "due at 68,900, you're at 68,400" can check.
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
                {/* `shrink-0` to match the recall and known-issue badges: without it "Up to date"
                    wraps to two lines next to a long job name instead of holding its width. */}
                <Badge variant={meta.variant} className="shrink-0">
                  {meta.label}
                </Badge>
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
 * The reasoning behind the badge. When the status is `unknown` this says *why*, because
 * "unknown" alone reads like a bug, and the two reasons need different things from the owner.
 */
function Working({ item }: { item: MaintenanceItem }) {
  const every = describeInterval(item);

  if (item.status === 'unknown') {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {item.unknownReason === 'no_interval'
          ? 'Set how often this is due to track it.'
          : // The interval leads: it is the one thing known about a job with no history, and
            // without it the row says only that it cannot say anything.
            [every, 'log this service once to start tracking it.'].filter(Boolean).join(' · ')}
      </p>
    );
  }

  const parts: string[] = [];
  if (every) parts.push(every);

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

/**
 * How often the job is due, in the owner's words. Absent when no interval is set, which is the
 * `no_interval` case and says its own thing.
 *
 * Both intervals are named when both exist, joined by "or", because that is the rule: whichever
 * comes first wins, so showing only the mileage would hide a job going overdue on time alone.
 */
function describeInterval(item: MaintenanceItem): string | undefined {
  const every: string[] = [];

  if (item.intervalMiles !== undefined) every.push(formatMileage(item.intervalMiles));
  if (item.intervalMonths !== undefined) {
    every.push(item.intervalMonths === 1 ? '1 month' : `${item.intervalMonths} months`);
  }

  return every.length > 0 ? `Every ${every.join(' or ')}` : undefined;
}
