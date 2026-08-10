import * as React from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AssessmentCard } from '@/components/assessments/AssessmentCard';
import { RepairCompletedDialog } from '@/components/assessments/RepairCompletedDialog';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
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
        shadcn's `Empty`, which is the same shape this page had hand-rolled -- centred column,
        short line in foreground weight, explanation under it in muted -- with the icon slot and
        the `text-balance` measure it did not have.

        No `border`, so the wrapper's `border-dashed` stays inert: an empty container is a thing
        to look at, and there is nothing in it.

        The `min-h` is what puts the text in the middle of the empty area rather than at the top
        of it. `Empty` already centres its own content vertically, so it only needs a height to
        centre within -- and it cannot inherit one: the component's `flex-1` is inert here because
        neither this page's column nor the shell's content wrapper is a flex parent. `20rem` is
        roughly what the page header and the "Previous assessments" line take, so the block
        reaches down to the bottom of the window and its contents land on that stretch's centre.
        Padding cannot do this job -- a fixed `pt` is right at one window height and wrong at
        every other.
      */}
      {data && data.length === 0 && (
        <Empty className="min-h-[calc(100vh-20rem)]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>Next time a shop quotes you, check it here first.</EmptyDescription>
          </EmptyHeader>
          {/* No `EmptyContent`: "Check a repair" is already in the header, a few inches up and
              the only filled control on the page. A second copy of it made the same action
              appear twice on a screen with nothing else on it. */}
        </Empty>
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
