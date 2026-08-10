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
      {/*
        Solid: this is the action the page exists for, and there is only one of it. Being the
        only filled button on the page is what marks it out -- it does not also need to be a
        size nothing else in the app uses.

        Full width below `sm` so it is a thumb-sized target on a phone, then inline with the
        title and only as wide as it needs to be.
      */}
      <PageHeader
        title="Repairs"
        subtitle="Find out whether a repair is actually necessary, and what a fair price looks like."
        action={
          <Button asChild className="w-full sm:w-auto">
            <Link to="/assessments/new">
              <Plus className="h-4 w-4" />
              Check a repair
            </Link>
          </Button>
        }
      />

      <h2 className="mb-3 text-label font-semibold uppercase tracking-widest text-muted-foreground">
        Previous assessments
      </h2>

      {error && <ErrorState message={error.message} />}

      {loading && !data && !error && (
        <div className="space-y-3">
          {/* `h-20` matches a one-row card: 32px of padding plus the name and date. */}
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/*
        Styled as Ask CA's empty state, which is the other page in the app that can open with
        nothing on it: centred on the page itself rather than in a panel, a short line in
        foreground weight, then the explanation under it in muted. No card and no tint -- an
        empty container is a thing to look at, and there is nothing in it.

        The two lines are two paragraphs rather than one split by a <br>, so the second can hold
        the muted colour and the `max-w-sm` measure that stops it running the width of the page.
      */}
      {data && data.length === 0 && (
        <div className="flex flex-col items-center px-6 py-20 text-center">
          {/* No button of its own: "Check a repair" is already in the header, a few inches up
              and the only filled control on the page. A second copy of it made the same action
              appear twice on a screen with nothing else on it. */}
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Next time a shop quotes you, check it here first.
          </p>
        </div>
      )}

      {/*
        One card per row at every width, each spanning the column. The grid packed two or three
        across on a wide screen, which made a list of four repairs read as a gallery to scan
        rather than a history to run down -- and it left the cards narrow enough that a repair
        name like "Brake Pad Replacement" crowded the badge beside it. Stacked, the title, date
        and "Mark repair as complete" line up down the page and the newest is unambiguously first.

        Also what the loading skeletons above already show: `space-y-3`, full width.
      */}
      {data && data.length > 0 && (
        <div className="space-y-3">
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
