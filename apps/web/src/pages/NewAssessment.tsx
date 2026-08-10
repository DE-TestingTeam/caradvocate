import * as React from 'react';
import { Check } from 'lucide-react';
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
 * with no parameters is unchanged.
 *
 * WHY THE STEPS OPEN ONE AT A TIME. All three used to be on screen at once under headings that
 * said "Step 1/2/3" -- a sequence the page did not actually have. A step opens once the one above
 * it is answered, which makes the numbering true, and drops what an owner faces on arrival from
 * three sections to one. All three headings stay visible throughout, so the length of the form is
 * never a surprise; only the bodies are held back.
 */

type StepId = 'repair' | 'context' | 'quote';

/** Said beside the step that is holding the form up, once someone has tried to submit. */
const MISSING: Record<StepId, string> = {
  repair: 'Pick the repair you need before starting.',
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

  const [error, setError] = React.useState<string>();
  // Set by a submit that could not go through. Which step is called out is recomputed every
  // render rather than stored, so answering the flagged step moves the message on by itself.
  const [attempted, setAttempted] = React.useState(false);

  const quoteReady = choice === 'no' || (choice === 'yes' && Number(amount) > 0);

  const done: Record<StepId, boolean> = {
    repair: Boolean(repairId),
    context: prompt !== undefined,
    quote: quoteReady,
  };
  // First unanswered step, in order. `undefined` means the form is ready to send.
  const missing: StepId | undefined = !done.repair
    ? 'repair'
    : !done.context
      ? 'context'
      : !done.quote
        ? 'quote'
        : undefined;

  const stepRefs: Record<StepId, React.RefObject<HTMLElement>> = {
    repair: React.useRef<HTMLElement>(null),
    context: React.useRef<HTMLElement>(null),
    quote: React.useRef<HTMLElement>(null),
  };

  async function handleSubmit() {
    if (submitting) return;

    // The button stays enabled and answers instead. A disabled button gives an owner no way to
    // find out what is missing -- and screen readers routinely skip past one -- so an incomplete
    // form is met with which step is short and a jump to it.
    if (missing) {
      setAttempted(true);
      const target = stepRefs[missing].current;
      target?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      target?.focus({ preventScroll: true });
      return;
    }

    // `missing` already covers both, but it is computed from state the compiler cannot follow
    // into here -- this is what narrows them for the call below.
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

      {repairId && suggestedRepair === repairId && (
        // NOTE: no wireframe. Says where the selection came from, so an owner who did not expect
        // a prefilled form knows why it is filled and that changing it is expected.
        <p className="mb-6 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
          Filled in from your conversation with CA. Change anything that is not right.
        </p>
      )}

      <Step
        id="repair"
        number={1}
        title="What repair do you need?"
        complete={done.repair}
        // Always open: it is the first question, and there is nothing above it to wait on.
        open
        flagged={attempted && missing === 'repair'}
        sectionRef={stepRefs.repair}
      >
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
      </Step>

      {/*
        Between the repair and the quote, deliberately. It reads as part of describing the problem
        rather than part of pricing it, and an owner who has not thought about why they are here is
        better asked before they have typed a number they are anchored to.
      */}
      <Step
        id="context"
        number={2}
        title="What brought this up?"
        complete={done.context}
        open={done.repair}
        flagged={attempted && missing === 'context'}
        sectionRef={stepRefs.context}
      >
        <ContextStep
          prompt={prompt}
          onPromptChange={setPrompt}
          notes={notes}
          onNotesChange={setNotes}
          duration={duration}
          onDurationChange={setDuration}
        />
      </Step>

      <Step
        id="quote"
        number={3}
        title="Have a quote from a shop?"
        complete={done.quote}
        open={done.repair && done.context}
        flagged={attempted && missing === 'quote'}
        sectionRef={stepRefs.quote}
      >
        <QuoteStep
          choice={choice}
          onChoiceChange={setChoice}
          amount={amount}
          onAmountChange={setAmount}
        />
      </Step>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      <Button className="mt-8 w-full" onClick={handleSubmit} aria-disabled={submitting}>
        {submitting ? 'Starting…' : 'Start assessment'}
      </Button>
    </div>
  );
}

/**
 * One numbered question.
 *
 * `complete` ticks the heading and `open` reveals the body. A closed step is its dimmed heading
 * and nothing else -- the question itself already says what is coming, and the numbering says
 * where it sits, so a line explaining that it opens later only repeats them.
 *
 * The section takes focus (`tabIndex={-1}`) rather than the first control inside it, so a jump
 * from the submit button lands on the heading and a screen reader reads the question and the
 * reason it was flagged before any of the options.
 */
function Step({
  id,
  number,
  title,
  complete,
  open,
  flagged,
  sectionRef,
  children,
}: {
  id: StepId;
  number: number;
  title: string;
  complete: boolean;
  open: boolean;
  flagged: boolean;
  sectionRef: React.RefObject<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={`step-${id}-heading`}
      className="mt-8 scroll-mt-6 space-y-3 focus-visible:outline-none"
    >
      <div className="flex items-center gap-2">
        <h2
          id={`step-${id}-heading`}
          className={cn(
            'text-xs font-semibold uppercase tracking-widest',
            open ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}
        >
          Step {number}: {title}
        </h2>
        {complete && (
          <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Answered" />
        )}
      </div>

      {flagged && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {MISSING[id]}
        </p>
      )}

      {open && children}
    </section>
  );
}
