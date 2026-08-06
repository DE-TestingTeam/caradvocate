import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuoteStep, type QuoteChoice } from '@/components/assessments/QuoteStep';
import { RepairPicker } from '@/components/assessments/RepairPicker';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { createAssessment, getRepairCatalog } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { invalidateAll, useApi } from '@/lib/useApi';

export function NewAssessmentPage() {
  const navigate = useNavigate();
  const catalog = useApi(getRepairCatalog);

  const [repairId, setRepairId] = React.useState<string>();
  const [choice, setChoice] = React.useState<QuoteChoice>();
  const [amount, setAmount] = React.useState('');
  const [fileName, setFileName] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);

  const [error, setError] = React.useState<string>();

  const quoteReady = choice === 'no' || (choice === 'yes' && Number(amount) > 0);
  const canSubmit = Boolean(repairId) && quoteReady && !submitting;

  async function handleSubmit() {
    if (!repairId || !canSubmit) return;
    setSubmitting(true);
    setError(undefined);

    try {
      const created = await createAssessment({
        repairId,
        quoteAmount: choice === 'yes' ? Number(amount) : undefined,
        quoteFileName: fileName,
      });
      invalidateAll();
      navigate(`/assessments/${created.id}`);
    } catch (cause) {
      // No pricing for this repair on this car is the one failure that belongs on the
      // next page rather than this one: the owner's answer to "what do you need?" was
      // valid, and it is our figures that fall short. Everything else -- 402 from the
      // paywall, an offline browser, a real fault -- stays here beside the button.
      //
      // The catalog flag is checked as well as the status because loadBenchmark answers
      // 404 for an unknown repair id too, and that is a bug rather than a missing price.
      // Attempting the POST first (rather than gating on the flag) means a repair priced
      // by a sync since this page loaded still goes through.
      const unpriced = catalog.data?.repairs.some(
        (repair) => repair.id === repairId && !repair.priced,
      );
      if (cause instanceof ApiError && cause.status === 404 && unpriced) {
        navigate(`/assessments/no-pricing?repair=${encodeURIComponent(repairId)}`);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not start the assessment.');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Repair Assessment" backTo="/assessments" backLabel="Back to Repair Assessment" />
      <Separator className="mb-6" />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 1: What repair do you need?
        </h2>
        {!catalog.data ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <RepairPicker items={catalog.data.repairs} value={repairId} onChange={setRepairId} />
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 2: Have a quote from a shop?
        </h2>
        <QuoteStep
          choice={choice}
          onChoiceChange={setChoice}
          amount={amount}
          onAmountChange={setAmount}
          fileName={fileName}
          onFileChange={setFileName}
        />
      </section>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      <Button size="lg" className="mt-8 w-full" disabled={!canSubmit} onClick={handleSubmit}>
        {submitting ? 'Starting…' : 'Start assessment'}
      </Button>
    </div>
  );
}
