import * as React from 'react';
import { Check } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { FairTotalCard } from '@/components/assessments/FairTotalCard';
import { LaborBaselineCard } from '@/components/assessments/LaborBaselineCard';
import { PartsBenchmarkCard } from '@/components/assessments/PartsBenchmarkCard';
import { QuoteEvaluationCard } from '@/components/assessments/QuoteEvaluationCard';
import { RecommendationCard } from '@/components/assessments/RecommendationCard';
import { RepairCompletedDialog } from '@/components/assessments/RepairCompletedDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { getAssessment } from '@/lib/api';
import { isCompleted } from '@/lib/assessment';
import { formatCurrency, formatMileage, vehicleShortName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/**
 * One component serves both viewport-mobile-2.png (no quote) and
 * viewport-mobile-3.png (with quote). The quote-dependent pieces are the
 * Quote Evaluation card, the subline, the tip callout, and the Fair Total footer.
 */
export function AssessmentDetailPage() {
  const { id = '' } = useParams();
  const { data: assessment, loading, error } = useApi(() => getAssessment(id), [id]);
  const vehicle = useVehicle();
  const [completing, setCompleting] = React.useState(false);
  const toast = useToast();

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

  const vehicleLabel = vehicleShortName(vehicle);
  const mileage = formatMileage(assessment.mileageAtAssessment);
  const subtitle = assessment.quote
    ? `Quote: ${formatCurrency(assessment.quote.amount)} · ${vehicleLabel} · ${mileage}`
    : `${vehicleLabel} · ${mileage} · No quote provided`;

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

      <div className="space-y-4">
        {assessment.quote && <QuoteEvaluationCard assessment={assessment} />}

        <RecommendationCard assessment={assessment} />
        <PartsBenchmarkCard assessment={assessment} />
        <LaborBaselineCard assessment={assessment} />

        {!assessment.quote && (
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Tip: Bring this assessment to your shop to compare against their quote.
          </div>
        )}

        <FairTotalCard assessment={assessment} />
      </div>

      <div className="mt-6 space-y-3">
        <Button className="w-full" onClick={() => toast('Assessment saved.')}>
          Save assessment
        </Button>

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
