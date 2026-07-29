import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MaintenanceItem, MaintenanceStatus } from '@caradvocate/shared';

const statusMeta: Record<MaintenanceStatus, { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
  open_recall: { label: 'Open recall', variant: 'destructive' },
  overdue: { label: 'Overdue', variant: 'default' },
  upcoming: { label: 'Upcoming', variant: 'outline' },
};

export function MaintenanceList({ items }: { items: MaintenanceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No recalls or scheduled maintenance on file. This fills in once a recall feed is connected.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const meta = statusMeta[item.status];
        const isRecall = item.status === 'open_recall';
        return (
          <li key={item.id}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2">
                {isRecall && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
                <span className={isRecall || item.status === 'overdue' ? 'font-medium' : undefined}>{item.label}</span>
              </div>
              <Badge variant={meta.variant} className="shrink-0">
                {meta.label}
              </Badge>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
