import { AlertTriangle, CalendarClock, ClipboardList, HelpCircle, Wrench } from 'lucide-react';
import type { AssessmentPrompt, SymptomDuration } from '@caradvocate/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Asks why this repair came up.
 *
 * WHY IT IS WORTH A STEP. The assessment used to record which repair and what it cost, and
 * nothing about the reason -- which is exactly why the necessity check does not exist. A shop
 * proposing brake pads to someone who reported grinding and a shop proposing them to someone who
 * came in for an oil change are different questions, and the app could not tell them apart.
 *
 * WHY THE LIST IS SHORT AND FIXED. This is the field that gets reasoned over, so it has to mean
 * the same thing every time. The free-text box underneath is where the detail goes, and it stays
 * optional: an owner who does not know what the shop meant should be able to say so by leaving it
 * empty rather than by inventing something.
 *
 * The duration only appears for the two prompts it means anything for. Asking how long a routine
 * service has been going on produces an answer to a question nobody asked, and stored it would
 * later read as a reported symptom.
 */

const PROMPTS: {
  value: AssessmentPrompt;
  icon: typeof Wrench;
  title: string;
  hint: string;
}[] = [
  {
    value: 'symptom',
    icon: AlertTriangle,
    title: "I've noticed something",
    hint: 'A noise, a smell, a vibration, something not working right',
  },
  {
    value: 'warning_light',
    icon: AlertTriangle,
    title: 'A warning light came on',
    hint: 'Dashboard light or a message from the car',
  },
  {
    value: 'shop_suggested',
    icon: Wrench,
    title: 'A shop recommended it',
    hint: "They spotted it — you hadn't noticed anything",
  },
  {
    value: 'routine_service',
    icon: ClipboardList,
    title: "It's scheduled upkeep",
    hint: 'Due by mileage or time, not because of a problem',
  },
  { value: 'other', icon: HelpCircle, title: 'Something else', hint: '' },
];

const DURATIONS: { value: SymptomDuration; label: string }[] = [
  { value: 'days', label: 'A few days' },
  { value: 'weeks', label: 'A few weeks' },
  { value: 'months', label: 'Months or longer' },
  { value: 'unsure', label: "I'm not sure" },
];

/** The prompts a duration says something real about. Mirrors SYMPTOM_IS_MEANINGFUL on the API. */
const WANTS_DURATION: AssessmentPrompt[] = ['symptom', 'warning_light'];

export function ContextStep({
  prompt,
  onPromptChange,
  notes,
  onNotesChange,
  duration,
  onDurationChange,
}: {
  prompt: AssessmentPrompt | undefined;
  onPromptChange: (value: AssessmentPrompt) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  duration: SymptomDuration | undefined;
  onDurationChange: (value: SymptomDuration) => void;
}) {
  const wantsDuration = prompt !== undefined && WANTS_DURATION.includes(prompt);

  return (
    <div className="space-y-3">
      {PROMPTS.map(({ value, icon: Icon, title, hint }) => (
        <button
          key={value}
          type="button"
          onClick={() => onPromptChange(value)}
          className={cn(
            'w-full rounded-lg border p-4 text-left transition-colors',
            prompt === value
              ? 'border-foreground ring-1 ring-inset ring-foreground'
              : 'bg-muted/50 hover:bg-accent',
          )}
        >
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-base font-semibold">{title}</span>
          </div>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </button>
      ))}

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
            */}
            <Input
              id="symptom-notes"
              value={notes}
              maxLength={1000}
              onChange={(event) => onNotesChange(event.target.value)}
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
                    onClick={() => onDurationChange(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm transition-colors',
                      duration === value
                        ? 'border-foreground ring-1 ring-inset ring-foreground'
                        : 'bg-muted/50 hover:bg-accent',
                    )}
                  >
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
