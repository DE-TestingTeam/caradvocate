import * as React from 'react';
import { Check } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { LaborBaselineCard } from '@/components/assessments/LaborBaselineCard';
import { PartsBenchmarkCard } from '@/components/assessments/PartsBenchmarkCard';
import { RecommendationCard } from '@/components/assessments/RecommendationCard';
import { RepairCompletedDialog } from '@/components/assessments/RepairCompletedDialog';
import { VerdictHero } from '@/components/assessments/VerdictHero';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { getAssessment } from '@/lib/api';
import { isCompleted } from '@/lib/assessment';
import { formatMileage, vehicleShortName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/**
 * The assessment, answer first.
 *
 * THE ORDER IS THE POINT. This page used to run Quote Evaluation, recommendation, parts, labor,
 * a tip, and then a Fair Total card holding the largest number on the screen -- so the owner's
 * question was settled by a small badge at the top while the biggest thing on the page was a
 * range nobody asked for. Now `VerdictHero` answers it once, in the largest type here, and
 * everything below is the working: what the parts cost, what the labor is, where the figures
 * came from. Nothing was deleted from the page except a button that did nothing (see below);
 * the evidence moved under a heading that says it is evidence.
 *
 * One component still serves both the quote and no-quote states; the quote-dependent pieces are
 * now all inside the hero and the subline.
 */
export function AssessmentDetailPage() {
  const { id = '' } = useParams();
  const { data: assessment, loading, error } = useApi(() => getAssessment(id), [id]);
  const vehicle = useVehicle();
  const [completing, setCompleting] = React.useState(false);

  if (loading && !assessment) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!assessment) {
    return (
      <div>
        <PageHeader title="Assessment not found" backTo="/assessments" backLabel="Back to Repair Assessment" />
        <Card className="p-6 text-sm text-muted-foreground">
          {error?.message ?? 'This assessment does not exist, or it belongs to another account.'}
        </Card>
      </div>
    );
  }

  /*
    Which car, at what odometer -- and no longer the quote. The subtitle used to lead with
    "Quote: $640", which now sits an inch below it at four times the size. Naming the same
    figure twice in a row made the header look like the answer and the answer like a repeat.
  */
  const subtitle = `${vehicleShortName(vehicle)} · ${formatMileage(assessment.mileageAtAssessment)}`;

  const completed = isCompleted(assessment);

  return (
    <div>
      <PageHeader
        title={assessment.repairName}
        subtitle={subtitle}
        backTo="/assessments"
        backLabel="Back to Repair Assessment"
      />
      <Separator className="mb-6" />

      {/*
        TWO ANSWERS, THEN THE WORKING. An owner arrives with two questions -- is this price fair,
        and do I actually need this -- and the page now answers both before any evidence appears.
        RecommendationCard used to sit below the heading with the parts and labor cards, which
        filed the necessity verdict as a supporting detail of the price. It is the paid tier's
        headline claim; it belongs beside the price, not underneath it.
      */}
      <div className="space-y-4">
        <VerdictHero assessment={assessment} />
        <RecommendationCard assessment={assessment} />
      </div>

      {/*
        The working, under a heading that says so. Without it the cards below read as more
        answers competing with the two above; with it they read as the reason to believe them,
        which is what someone about to argue with a shop actually needs from them.
      */}
      <h2 className="mb-3 mt-8 text-label font-semibold uppercase tracking-widest text-muted-foreground">
        How we worked this out
      </h2>

      <div className="space-y-4">
        <PartsBenchmarkCard assessment={assessment} />
        <LaborBaselineCard assessment={assessment} />
      </div>

      {/*
        "Save assessment" used to sit here as the page's one solid button. It called `toast`
        and nothing else -- the assessment was already saved the moment it was created, so the
        button announced a write that had happened minutes earlier and could not fail. Gone,
        which also leaves "Mark repair as completed" as the only action on the page, and it is
        the only one that changes anything.
      */}
      <div className="mt-6 space-y-3">
        {completed ? (
          <div className="flex items-center justify-center gap-1.5 rounded-md border bg-muted/50 py-3 text-sm text-muted-foreground">
            <Check className="h-4 w-4" />
            Repair completed
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setCompleting(true)}>
            Mark repair as completed
          </Button>
        )}
      </div>

      <RepairCompletedDialog assessment={assessment} open={completing} onOpenChange={setCompleting} />
    </div>
  );
}
