import * as React from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AssessmentCard } from '@/components/assessments/AssessmentCard';
import { RepairCompletedDialog } from '@/components/assessments/RepairCompletedDialog';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listAssessments } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { Assessment } from '@caradvocate/shared';

export function AssessmentsPage() {
  const { data, loading, error } = useApi(listAssessments);
  const [completing, setCompleting] = React.useState<Assessment | undefined>();

  return (
    <div>
      <PageHeader
        title="Repairs"
        subtitle="Find out whether a repair is actually necessary, and what a fair price looks like."
      />

      {/*
        Solid and `lg`: this is the action the page exists for, and there is only one of it.
        Full width below `sm` so it is a thumb-sized target on a phone, then only as wide as it
        needs to be.
      */}
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link to="/assessments/new">
          <Plus className="h-4 w-4" />
          Check a repair
        </Link>
      </Button>

      <h2 className="mb-3 mt-10 text-label font-semibold uppercase tracking-widest text-muted-foreground">
        Previous assessments
      </h2>

      {error && <ErrorState message={error.message} />}

      {loading && !data && !error && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/*
        The empty state sits on linen rather than on a white card. An empty card on an off-white
        page looks like content that failed to arrive; a tinted panel reads as a deliberate
        placeholder, which is what this is.
      */}
      {data && data.length === 0 && (
        <div className="rounded-lg bg-muted p-8 text-center">
          <p className="mx-auto max-w-sm text-body text-muted-foreground">
            Nothing here yet — which is the good outcome. Next time a shop quotes you, check it
            here first.
          </p>
          <Button asChild className="mt-5">
            <Link to="/assessments/new">
              <Plus className="h-4 w-4" />
              Check a repair
            </Link>
          </Button>
        </div>
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
