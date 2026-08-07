import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isCompleted, quoteStatusLabel, verdictBadge } from '@/lib/assessment';
import { formatLongDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Assessment } from '@caradvocate/shared';

interface AssessmentCardProps {
  assessment: Assessment;
  onMarkComplete: (assessment: Assessment) => void;
}

export function AssessmentCard({
  assessment,
  onMarkComplete,
}: AssessmentCardProps) {
  const badge = verdictBadge(assessment);
  const completed = isCompleted(assessment);

  return (
    <Card className={cn("overflow-hidden", completed && "bg-muted/50")}>
      <Link
        to={`/assessments/${assessment.id}`}
        className="block p-4 transition-colors hover:bg-accent/40"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-snug">
            {assessment.repairName}
          </h3>
          <Badge variant={badge.variant} className="shrink-0">
            {badge.label}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {formatLongDate(assessment.createdAt)} ·{" "}
          {quoteStatusLabel(assessment)}
        </p>
      </Link>

      <div className="border-t border-dashed px-4 py-3">
        {completed ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4" />
            Repair completed
          </span>
        ) : (
          <Button variant="link" size="inline" onClick={() => onMarkComplete(assessment)}>
            Mark repair as complete
            <ArrowRight />
          </Button>
        )}
      </div>
    </Card>
  );
}
