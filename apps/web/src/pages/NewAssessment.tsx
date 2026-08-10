import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextStep } from '@/components/assessments/ContextStep';
import { QuoteStep, type QuoteChoice } from '@/components/assessments/QuoteStep';
import { RepairPicker } from '@/components/assessments/RepairPicker';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { createAssessment, getRepairCatalog } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { invalidateAll, useApi } from '@/lib/useApi';
import type { AssessmentPrompt, SymptomDuration } from '@caradvocate/shared';

/**
 * Step one and two of the Repair Cost Checker.
 *
 * `?repair=` and `?quote=` prefill the form, and Ask CA sets them when a cost question named a
 * repair it could match (see MessageBubble). They are INITIAL VALUES ONLY: every field stays
 * editable, nothing is submitted for the owner, and a repair id the catalogue does not contain
 * is ignored rather than shown as a selection that cannot be seen. Arriving here from the nav
 * with no parameters is unchanged.
 */
export function NewAssessmentPage() {
  const navigate = useNavigate();
  const catalog = useApi(getRepairCatalog);
  const [params] = useSearchParams();

  const suggestedRepair = params.get('repair') ?? undefined;
  const suggestedQuote = params.get('quote') ?? '';

  const [repairId, setRepairId] = React.useState<string>();
  const [choice, setChoice] = React.useState<QuoteChoice | undefined>(suggestedQuote ? 'yes' : undefined);
  const [amount, setAmount] = React.useState(/^\d+$/.test(suggestedQuote) ? suggestedQuote : '');
  const [prefilled, setPrefilled] = React.useState(false);

  // Applied once the catalogue is known, so a stale or invented id from the URL cannot select a
  // repair the picker has no row for. Guarded on `prefilled` rather than on `repairId` being
  // unset, so clearing the selection afterwards does not silently re-apply it.
  React.useEffect(() => {
    if (prefilled || !catalog.data || !suggestedRepair) return;
    setPrefilled(true);
    if (catalog.data.repairs.some((repair) => repair.id === suggestedRepair)) {
      setRepairId(suggestedRepair);
    }
  }, [catalog.data, prefilled, suggestedRepair]);
  const [prompt, setPrompt] = React.useState<AssessmentPrompt>();
  const [notes, setNotes] = React.useState('');
  const [duration, setDuration] = React.useState<SymptomDuration>();
  const [fileName, setFileName] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);

  const [error, setError] = React.useState<string>();

  const quoteReady = choice === 'no' || (choice === 'yes' && Number(amount) > 0);
  // `prompt` is required by the API, so it gates the button here too -- a 422 for a field the
  // form did not insist on would read as a bug rather than a missing answer.
  const canSubmit = Boolean(repairId) && prompt !== undefined && quoteReady && !submitting;

  async function handleSubmit() {
    if (!repairId || !canSubmit) return;
    setSubmitting(true);
    setError(undefined);

    try {
      const created = await createAssessment({
        repairId,
        promptedBy: prompt,
        // Trimmed to undefined rather than sent empty: "" would store as a note the owner wrote
        // nothing in, which reads later as an answered question.
        symptomNotes: notes.trim() || undefined,
        symptomDuration: duration,
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

      {repairId && suggestedRepair === repairId && (
        // NOTE: no wireframe. Says where the selection came from, so an owner who did not expect
        // a prefilled form knows why it is filled and that changing it is expected.
        <p className="mb-6 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
          Filled in from your conversation with CA. Change anything that is not right.
        </p>
      )}

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

      {/*
        Between the repair and the quote, deliberately. It reads as part of describing the problem
        rather than part of pricing it, and an owner who has not thought about why they are here is
        better asked before they have typed a number they are anchored to.
      */}
      <section className="mt-8 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 2: What brought this up?
        </h2>
        <ContextStep
          prompt={prompt}
          onPromptChange={setPrompt}
          notes={notes}
          onNotesChange={setNotes}
          duration={duration}
          onDurationChange={setDuration}
        />
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Step 3: Have a quote from a shop?
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

      <Button className="mt-8 w-full" disabled={!canSubmit} onClick={handleSubmit}>
        {submitting ? 'Starting…' : 'Start assessment'}
      </Button>
    </div>
  );
}
