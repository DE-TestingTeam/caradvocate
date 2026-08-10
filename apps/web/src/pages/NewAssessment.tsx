import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@/components/ui/questionnaire';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { createAssessment, getRepairCatalog } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { invalidateAll, useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';
import type { AssessmentPrompt, RepairCatalogItem, SymptomDuration } from '@caradvocate/shared';

/**
 * The Repair Cost Checker's three questions, as a shadcn `Questionnaire`.
 *
 * WHAT THE COMPONENT NOW OWNS. Which question is on screen, moving between them, whether a
 * required one has been answered, the "Step n of 3" count and the Back/Continue/Start pair. All of
 * that used to be hand-rolled here -- a `stepIndex`, a `flagged` boolean, a `done` record and a
 * `MISSING` copy table. It is gone rather than wrapped: the primitive marks an unanswered question
 * invalid and reveals its own error, and Continue does not need to be dead to say so.
 *
 * WHAT STAYS HERE. The answers, because they are not all choices -- the notes, the symptom
 * duration and the quote total are follow-ups that appear once their question is answered, and the
 * API takes typed values rather than form fields. So the choices report to state on change, and
 * submit reads state rather than `FormData`.
 *
 * `?repair=` and `?quote=` prefill the form, and Ask CA sets them when a cost question named a
 * repair it could match (see MessageBubble). They are INITIAL VALUES ONLY: every field stays
 * editable, nothing is submitted for the owner, and a repair id the catalogue does not contain is
 * ignored rather than shown as a selection that cannot be seen. A prefilled form still opens on
 * question 1 rather than skipping ahead: the selection is the thing most worth checking, so it has
 * to be seen.
 */

/**
 * Why this repair came up.
 *
 * WHY THE LIST IS SHORT AND FIXED. This is the field that gets reasoned over, so it has to mean
 * the same thing every time. The free-text box underneath is where the detail goes, and it stays
 * optional: an owner who does not know what the shop meant should be able to say so by leaving it
 * empty rather than by inventing something.
 *
 * WHY THERE IS NO "I'VE NOTICED SOMETHING". Removed by product decision; an owner reporting a
 * noise or a smell picks "Something else" and describes it in the free-text box. `symptom` stays a
 * valid value everywhere else -- the type, the API and the column all still accept it, so putting
 * the option back is a one-entry change here.
 */
const PROMPTS: { value: AssessmentPrompt; title: string; hint: string }[] = [
  {
    value: 'warning_light',
    title: 'A warning light came on',
    hint: 'Dashboard light or a message from the car',
  },
  {
    value: 'shop_suggested',
    title: 'A shop recommended it',
    hint: "They spotted it — you hadn't noticed anything",
  },
  {
    value: 'routine_service',
    title: "It's scheduled upkeep",
    hint: 'Due by mileage or time, not because of a problem',
  },
  {
    value: 'other',
    title: 'Something else',
    hint: 'Including anything you have noticed yourself — a noise, a smell, a vibration',
  },
];

const DURATIONS: { value: SymptomDuration; label: string }[] = [
  { value: 'days', label: 'A few days' },
  { value: 'weeks', label: 'A few weeks' },
  { value: 'months', label: 'Months or longer' },
  { value: 'unsure', label: "I'm not sure" },
];

/**
 * The prompts a duration says something real about. Mirrors SYMPTOM_IS_MEANINGFUL on the API.
 *
 * Asking how long a routine service has been going on produces an answer to a question nobody
 * asked, and stored it would later read as a reported symptom.
 */
const WANTS_DURATION: AssessmentPrompt[] = ['symptom', 'warning_light'];

type QuoteChoice = 'yes' | 'no';

/**
 * Keeps a typed quote total to digits and at most one decimal point. Everything else -- letters,
 * a second point, a minus sign, the `e` a number input would have accepted -- is dropped as it is
 * typed, so what is on screen is always what will be sent.
 */
function sanitizeAmount(raw: string): string {
  const digitsAndPoints = raw.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = digitsAndPoints.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

export function NewAssessmentPage() {
  const catalog = useApi(getRepairCatalog);
  const [params] = useSearchParams();

  const suggestedRepair = params.get('repair') ?? undefined;
  const suggestedQuote = params.get('quote') ?? '';

  return (
    <div>
      <PageHeader
        title="New Repair Assessment"
        backTo="/assessments"
        backLabel="Back to Repair Assessment"
      />
      <Separator className="mb-6" />

      {/*
        The whole form waits for the catalogue rather than only the question that needs it. The
        questionnaire declares its questions and their answers up front -- that is what it validates
        and counts against -- so it can only be built once the repairs are known, and mounting it
        with the catalogue already in hand is also what lets `?repair=` arrive as an initial
        selection rather than as an effect that has to reach in afterwards.
      */}
      {!catalog.data ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-2/3" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <AssessmentQuestions
          repairs={catalog.data.repairs}
          // Resolved against the catalogue here rather than trusted: a stale or invented id from
          // the URL must not select a repair the list has no row for.
          initialRepairId={
            suggestedRepair && catalog.data.repairs.some((repair) => repair.id === suggestedRepair)
              ? suggestedRepair
              : undefined
          }
          initialAmount={/^\d+$/.test(suggestedQuote) ? suggestedQuote : ''}
          hasSuggestedQuote={Boolean(suggestedQuote)}
        />
      )}
    </div>
  );
}

const STEPS = ['repair', 'context', 'quote'] as const;
type Step = (typeof STEPS)[number];

function AssessmentQuestions({
  repairs,
  initialRepairId,
  initialAmount,
  hasSuggestedQuote,
}: {
  repairs: RepairCatalogItem[];
  initialRepairId: string | undefined;
  initialAmount: string;
  hasSuggestedQuote: boolean;
}) {
  const navigate = useNavigate();

  const [step, setStep] = React.useState<Step>('repair');
  const [repairId, setRepairId] = React.useState(initialRepairId);
  const [prompt, setPrompt] = React.useState<AssessmentPrompt>();
  const [notes, setNotes] = React.useState('');
  const [duration, setDuration] = React.useState<SymptomDuration>();
  const [choice, setChoice] = React.useState<QuoteChoice | undefined>(
    hasSuggestedQuote ? 'yes' : undefined,
  );
  const [amount, setAmount] = React.useState(initialAmount);
  const [amountMissing, setAmountMissing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();

  /**
   * The questions and their permitted answers. The component checks what is rendered against
   * this, so every choice below has to appear here -- and the repair question's answers are the
   * catalogue itself.
   */
  const items = React.useMemo(
    () => [
      { name: 'repair', required: true, choices: repairs.map((repair) => ({ value: repair.id })) },
      { name: 'context', required: true, choices: PROMPTS.map(({ value }) => ({ value })) },
      { name: 'quote', required: true, choices: [{ value: 'yes' }, { value: 'no' }] },
    ],
    [repairs],
  );

  const answered: Record<Step, boolean> = {
    repair: Boolean(repairId),
    context: prompt !== undefined,
    quote: choice === 'no' || (choice === 'yes' && Number(amount) > 0),
  };

  const formRef = React.useRef<HTMLFormElement>(null);
  // Moving between questions swaps the whole fieldset, so the page goes back to the top and the
  // question that is now showing takes focus -- otherwise a long repair list leaves the next
  // question scrolled half off screen, and a screen reader would carry on from wherever the last
  // control was. The count itself is announced by the progress line, which is `aria-live`.
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    formRef.current
      ?.querySelector<HTMLElement>('[data-slot="questionnaire-item"][data-active]')
      ?.focus({ preventScroll: true });
  }, [step]);

  const wantsDuration = prompt !== undefined && WANTS_DURATION.includes(prompt);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // A missing quote total is the one gap the questionnaire cannot see: "Yes, I have a quote" is
    // a complete answer as far as the choice goes, and the figure it implies lives in a field of
    // its own below. Said beside that field rather than as the question's error, which would
    // claim the answer above it was the problem.
    if (choice === 'yes' && !(Number(amount) > 0)) {
      setAmountMissing(true);
      return;
    }

    // The questionnaire holds an unanswered required question back before this runs; these are
    // what narrow the values for the call below.
    if (!repairId || prompt === undefined || choice === undefined) return;

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
      // No pricing for this repair on this car is the one failure that belongs on the next page
      // rather than this one: the owner's answer to "what do you need?" was valid, and it is our
      // figures that fall short. Everything else -- 402 from the paywall, an offline browser, a
      // real fault -- stays here beside the button.
      //
      // The catalog flag is checked as well as the status because loadBenchmark answers 404 for an
      // unknown repair id too, and that is a bug rather than a missing price. Attempting the POST
      // first (rather than gating on the flag) means a repair priced by a sync since this page
      // loaded still goes through.
      const unpriced = repairs.some((repair) => repair.id === repairId && !repair.priced);
      if (cause instanceof ApiError && cause.status === 404 && unpriced) {
        navigate(`/assessments/no-pricing?repair=${encodeURIComponent(repairId)}`);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not start the assessment.');
      setSubmitting(false);
    }
  }

  return (
    /*
      `style-nova` is how shadcn's stylesheet is switched on: its rules are scoped to it, so the
      questionnaire is unstyled without it. It has to sit on an ANCESTOR rather than on the
      questionnaire itself -- the rules are descendant selectors, and the root's own `cn-questionnaire`
      would fall outside them.
    */
    <div className="style-nova">
      <Questionnaire
        ref={formRef}
        items={items}
        item={step}
        onItemChange={(next) => setStep(next as Step)}
        onSubmit={handleSubmit}
      >
        {/*
          The count comes from the component, in the size and colour its own stylesheet gives it.
          The bar under it is the one piece kept from the hand-rolled stepper, because it says
          something the count cannot: which questions are already ANSWERED, so a step still holding
          its answer stays solid after Back.
        */}
        <div className="space-y-2">
          <QuestionnaireProgress />
          <div aria-hidden className="flex gap-1.5">
            {STEPS.map((id) => (
              <div
                key={id}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  answered[id] ? 'bg-primary' : id === step ? 'bg-primary/30' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </div>

        {/*
          `tabIndex={-1}` on each question so the one being asked can take focus on arrival without
          becoming a tab stop of its own.
        */}
        <QuestionnaireItem name="repair" required tabIndex={-1}>
          <QuestionnaireTitle>What repair do you need?</QuestionnaireTitle>
          {initialRepairId && repairId === initialRepairId && (
            <QuestionnaireDescription>
              Filled in from your conversation with CA. Change anything that is not right.
            </QuestionnaireDescription>
          )}
          <QuestionnaireChoices>
            {repairs.map((repair) => (
              <QuestionnaireChoice
                key={repair.id}
                value={repair.id}
                defaultChecked={repair.id === initialRepairId}
                onChange={() => setRepairId(repair.id)}
              >
                {/*
                  Every repair is selectable, whether or not we hold pricing for this car. The owner
                  picks what the car actually needs; whether we can price it is answered on the next
                  page. Disabling the unpriced ones instead made the list refuse the question before
                  it had been asked.
                */}
                <span className="font-medium">{repair.name}</span>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireError>Pick the repair you need to continue.</QuestionnaireError>
        </QuestionnaireItem>

        {/*
          Between the repair and the quote, deliberately. It reads as part of describing the problem
          rather than part of pricing it, and an owner who has not thought about why they are here is
          better asked before they have typed a number they are anchored to.
        */}
        <QuestionnaireItem name="context" required tabIndex={-1}>
          <QuestionnaireTitle>What brought this up?</QuestionnaireTitle>
          <QuestionnaireChoices>
            {PROMPTS.map(({ value, title, hint }) => (
              <QuestionnaireChoice key={value} value={value} onChange={() => setPrompt(value)}>
                <span className="font-medium">{title}</span>
                <QuestionnaireChoiceDescription>{hint}</QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireError>Tell us what brought this repair up.</QuestionnaireError>

          {prompt && (
            <div className="space-y-4 pl-1 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="symptom-notes">
                  {prompt === 'shop_suggested' || prompt === 'routine_service'
                    ? 'What did the shop say? (optional)'
                    : 'What are you noticing? (optional)'}
                </Label>
                {/*
                  Optional, and labelled so. An owner who does not know what the shop meant should be
                  able to leave this empty rather than guess -- a guess recorded here would be read
                  later as something they actually observed.

                  Not a `QuestionnaireInput`: that slot is another way to ANSWER the question above,
                  and this is a note about the answer already given.
                */}
                <Input
                  id="symptom-notes"
                  value={notes}
                  maxLength={1000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="e.g. grinding when I brake, worse turning left"
                />
              </div>

              {wantsDuration && (
                <div className="space-y-1.5">
                  <Label>How long has it been happening? (optional)</Label>
                  <div className="flex flex-wrap gap-2">
                    {DURATIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setDuration(value)}
                        // No icon: the same clock on all four pills distinguished nothing, and the
                        // labels already say the answer is a length of time.
                        className={cn(
                          'inline-flex items-center rounded-pill border px-3 py-1.5 text-sm transition-colors',
                          duration === value
                            ? 'border-foreground ring-1 ring-inset ring-foreground'
                            : 'bg-muted/50 hover:bg-accent',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </QuestionnaireItem>

        <QuestionnaireItem name="quote" required tabIndex={-1}>
          <QuestionnaireTitle>Have a quote from a shop?</QuestionnaireTitle>
          <QuestionnaireChoices>
            <QuestionnaireChoice
              value="yes"
              defaultChecked={hasSuggestedQuote}
              onChange={() => setChoice('yes')}
            >
              <span className="font-medium">Yes, I have a quote</span>
              <QuestionnaireChoiceDescription>
                Enter your quote total for a fairness check
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
            <QuestionnaireChoice
              value="no"
              onChange={() => {
                setChoice('no');
                setAmountMissing(false);
              }}
            >
              <span className="font-medium">No, not yet</span>
              <QuestionnaireChoiceDescription>
                Get expected costs before visiting a shop
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
          </QuestionnaireChoices>
          <QuestionnaireError>Let us know whether you have a quote yet.</QuestionnaireError>

          {/* Below both cards rather than beneath the one it belongs to -- side by side there is no
              "beneath this card" that does not shove the other one down the page. */}
          {choice === 'yes' && (
            <div className="space-y-2 pl-1">
              <Label htmlFor="quote-amount">Quote total</Label>
              <div className="relative sm:max-w-[calc(50%-0.375rem)]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                {/*
                  Text with a decimal keypad, not `type="number"`. A number input scrolls its value
                  up and down under the mouse wheel, so a quote total silently changes while someone
                  scrolls the page -- on the one field where a wrong figure produces a wrong verdict.
                  Digits and a single point are all that survive the filter, so `Number(amount)`
                  still parses.
                */}
                <Input
                  id="quote-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => {
                    setAmount(sanitizeAmount(event.target.value));
                    setAmountMissing(false);
                  }}
                  placeholder="320"
                  className="pl-7"
                  autoFocus
                />
              </div>
              {amountMissing && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  Enter the quote total, or pick “No, not yet”.
                </p>
              )}
            </div>
          )}
        </QuestionnaireItem>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </p>
        )}

        {/*
          No Skip: all three questions are required, and the component only shows Skip on one that
          is not. Back hides itself on the first question, and on the last one Next gives way to
          Submit -- which is why both read "Continue": the same word for the same move, whether the
          press advances a question or starts the assessment.
        */}
        <QuestionnaireActions>
          <QuestionnairePrevious>Back</QuestionnairePrevious>
          <QuestionnaireNext>Continue</QuestionnaireNext>
          <QuestionnaireSubmit aria-disabled={submitting}>
            {submitting ? 'Continuing…' : 'Continue'}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  );
}
