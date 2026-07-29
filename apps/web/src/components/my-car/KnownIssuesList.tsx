import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { KnownIssue, Severity } from '@caradvocate/shared';

const severityVariant: Record<Severity, 'default' | 'secondary' | 'outline'> = {
  high: 'default',
  medium: 'secondary',
  low: 'outline',
};

export function KnownIssuesList({ issues }: { issues: KnownIssue[] }) {
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Card className="flex items-center justify-between gap-3 p-3">
            <span className="min-w-0">{issue.label}</span>
            <Badge variant={severityVariant[issue.severity]} className="shrink-0">
              {issue.severity}
            </Badge>
          </Card>
        </li>
      ))}
    </ul>
  );
}
