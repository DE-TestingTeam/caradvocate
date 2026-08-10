import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { AssessmentPrompt, SymptomDuration } from '@caradvocate/shared';

/**
 * Step one and two of the Repair Cost Checker.
 *
 * `?repair=` and `?quote=` prefill the form, and Ask CA sets them when a cost question named a
 * repair it could match (see MessageBubble). They are INITIAL VALUES ONLY: every field stays
 * editable, nothing is submitted for the owner, and a repair id the catalogue does not contain
 * is ignored rather than shown as a selection that cannot be seen. Arriving here from the nav
 * with no parameters is unchanged. A prefilled form still opens on step 1 rather than skipping
 * ahead: the selection is the thing most worth checking, so it has to be seen.
 *
 * ONE QUESTION PER SCREEN, like onboarding. All three used to sit on one page under headings that
 * said "Step 1/2/3" -- a sequence the page did not have -- so answering meant scrolling past
 * questions already answered to reach the button. Now Continue replaces the question with the
 * next one and Back returns, which is the flow an owner has already been through once when they
 * added their car.
 *
 * Answers survive moving between steps, because they live here rather than in the step
 * components: going Back to change the repair does not discard the quote typed after it.
 */

type StepId = 'repair' | 'context' | 'quote';

/** The order the steps are asked in. Also the stepper's segment count. */
const STEP_ORDER: StepId[] = ['repair', 'context', 'quote'];

const TITLES: Record<StepId, string> = {
  repair: 'What repair do you need?',
  context: 'What brought this up?',
  quote: 'Have a quote from a shop?',
};

/** Said on the step itself when Continue is pressed without an answer. */
const MISSING: Record<StepId, string> = {
  repair: 'Pick the repair you need to continue.',
  context: 'Tell us what brought this repair up.',
  quote: 'Let us know whether you have a quote yet.',
};

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
  const [submitting, setSubmitting] = React.useState(false);

  const [stepIndex, setStepIndex] = React.useState(0);
  // Set by a Continue that could not go through, cleared on every move. Per-step rather than
  // per-form: an owner who has just answered should not be looking at the last complaint.
  const [flagged, setFlagged] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const step = STEP_ORDER[stepIndex];
  const isLast = stepIndex === STEP_ORDER.length - 1;

  const quoteReady = choice === 'no' || (choice === 'yes' && Number(amount) > 0);
  const done: Record<StepId, boolean> = {
    repair: Boolean(repairId),
    context: prompt !== undefined,
    quote: quoteReady,
  };

  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // Moving between steps swaps the whole question, so the page is put back at the top and the new
  // heading takes focus -- otherwise a long repair list leaves step 2 scrolled half off screen,
  // and a screen reader would carry on from wherever the last control was.
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  function handleBack() {
    setFlagged(false);
    setError(undefined);
    setStepIndex((index) => Math.max(0, index - 1));
  }

  async function handleNext() {
    if (submitting) return;

    // The button is never disabled: a dead Continue gives no way to find out what is missing,
    // and screen readers routinely skip past one. Pressing it unanswered says what is needed.
    if (!done[step]) {
      setFlagged(true);
      headingRef.current?.focus({ preventScroll: true });
      return;
    }

    setFlagged(false);
    if (!isLast) {
      setStepIndex((index) => index + 1);
      return;
    }

    // `done` covers both of these, but it is computed from state the compiler cannot follow into
    // here -- this is what narrows them for the call below.
    if (!repairId || prompt === undefined) return;
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

      <Stepper current={stepIndex + 1} total={STEP_ORDER.length} done={STEP_ORDER.map((id) => done[id])} />

      {step === 'repair' && repairId && suggestedRepair === repairId && (
        // NOTE: no wireframe. Says where the selection came from, so an owner who did not expect
        // a prefilled form knows why it is filled and that changing it is expected.
        <p className="mb-6 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
          Filled in from your conversation with CA. Change anything that is not right.
        </p>
      )}

      <div className="space-y-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xs font-semibold uppercase tracking-widest text-muted-foreground focus-visible:outline-none"
        >
          {TITLES[step]}
        </h2>

        {flagged && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {MISSING[step]}
          </p>
        )}

        {/*
          Every step stays mounted and hidden rather than being unmounted, so the repair list's
          scroll position and search text are still there after a trip to step 2 and back. The
          hidden ones are `hidden`, not just invisible, so nothing inside them is tabbable.
        */}
        <div hidden={step !== 'repair'}>
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
        </div>

        {/*
          Between the repair and the quote, deliberately. It reads as part of describing the
          problem rather than part of pricing it, and an owner who has not thought about why they
          are here is better asked before they have typed a number they are anchored to.
        */}
        <div hidden={step !== 'context'}>
          <ContextStep
            prompt={prompt}
            onPromptChange={setPrompt}
            notes={notes}
            onNotesChange={setNotes}
            duration={duration}
            onDurationChange={setDuration}
          />
        </div>

        <div hidden={step !== 'quote'}>
          <QuoteStep
            choice={choice}
            onChoiceChange={setChoice}
            amount={amount}
            onAmountChange={setAmount}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      {/*
        Side by side at every width, but only stretched on a phone. `flex-1` there gives two
        thumb-sized targets that fill the screen; from `sm` up they size to their own labels,
        with a 7rem floor so the pair reads as a matched set rather than one word-shaped button
        beside another. A Continue run any wider than its label reads as a page-wide banner
        rather than as the next step.
      */}
      <div className="mt-8 flex gap-3">
        {stepIndex > 0 && (
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:flex-none sm:min-w-[7rem]"
            onClick={handleBack}
          >
            <ChevronLeft />
            Back
          </Button>
        )}
        <Button
          type="button"
          className="flex-1 sm:flex-none sm:min-w-[7rem]"
          onClick={handleNext}
          aria-disabled={submitting}
        >
          {isLast ? (submitting ? 'Starting…' : 'Start assessment') : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

/**
 * How far through the three questions this is, as a label and a filled bar.
 *
 * Follows onboarding's shape (a "Step n of m" line above equal segments) because an owner has
 * seen it there once already. Kept as a separate copy rather than shared for now: onboarding's
 * marks a step as reached, this one marks it as ANSWERED, and collapsing them would mean a prop
 * that switches between the two meanings. Worth unifying if a third one appears.
 *
 * The bar is `aria-hidden` and the label carries the state, so a screen reader hears "Step 2 of
 * 3" rather than a run of empty divs.
 */
function Stepper({
  current,
  total,
  done,
}: {
  current: number;
  total: number;
  done: boolean[];
}) {
  return (
    <div className="mb-6">
      <p className="text-sm font-medium text-muted-foreground">
        Step {current} of {total}
      </p>
      <div aria-hidden className="mt-2 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            // Three states, not two: answered, the one being asked, and not yet reached. An
            // answered step keeps its solid segment after Back, since the answer is still held.
            className={cn(
              'h-1.5 flex-1 rounded-full',
              done[i] ? 'bg-primary' : i + 1 === current ? 'bg-primary/30' : 'bg-muted',
            )}
          />
        ))}
      </div>
    </div>
  );
}
