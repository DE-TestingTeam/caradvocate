import * as React from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AssessmentCard } from '@/components/assessments/AssessmentCard';
import { RepairCompletedDialog } from '@/components/assessments/RepairCompletedDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listAssessments } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { Assessment } from '@/types';

export function AssessmentsPage() {
  const { data, loading } = useApi(listAssessments);
  const [completing, setCompleting] = React.useState<Assessment | undefined>();

  return (
    <div>
      <PageHeader
        title="Repair Assessment"
        subtitle="Check if a repair is necessary and get benchmark pricing"
      />

      <Button asChild variant="secondary" size="lg" className="w-full border">
        <Link to="/assessments/new">
          <Plus className="h-4 w-4" />
          New assessment
        </Link>
      </Button>

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Previous assessments
      </h2>

      {loading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No assessments yet. Start one to see whether a repair is necessary and what a fair price looks like.
          </p>
          <Button asChild className="mt-4">
            <Link to="/assessments/new">
              <Plus className="h-4 w-4" />
              New assessment
            </Link>
          </Button>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-3">
          {data.map((assessment) => (
            <AssessmentCard key={assessment.id} assessment={assessment} onMarkComplete={setCompleting} />
          ))}
        </div>
      )}

      <RepairCompletedDialog
        assessment={completing}
        open={Boolean(completing)}
        onOpenChange={(open) => !open && setCompleting(undefined)}
      />
    </div>
  );
}
