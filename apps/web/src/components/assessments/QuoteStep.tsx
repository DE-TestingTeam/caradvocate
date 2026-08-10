import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type QuoteChoice = "yes" | "no";

/**
 * Keeps a typed quote total to digits and at most one decimal point. Everything else -- letters,
 * a second point, a minus sign, the `e` a number input would have accepted -- is dropped as it
 * is typed, so what is on screen is always what will be sent.
 */
function sanitizeAmount(raw: string): string {
  const digitsAndPoints = raw.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = digitsAndPoints.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

interface QuoteStepProps {
  choice: QuoteChoice | undefined;
  onChoiceChange: (choice: QuoteChoice) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
}

export function QuoteStep({
  choice,
  onChoiceChange,
  amount,
  onAmountChange,
}: QuoteStepProps) {
  return (
    <div className="space-y-3">
      {/* Side by side from `sm` up: two mutually exclusive answers to one question compare at a
          glance rather than reading as a list to work down. Stacked below that, where two cards
          on a phone would be too narrow to hold their descriptions on one or two lines. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <QuoteChoiceCard
          selected={choice === "yes"}
          onSelect={() => onChoiceChange("yes")}
          title="Yes, I have a quote"
          description="Enter your quote total for a fairness check"
        />
        <QuoteChoiceCard
          selected={choice === "no"}
          onSelect={() => onChoiceChange("no")}
          title="No, not yet"
          description="Get expected costs before visiting a shop"
        />
      </div>

      {/* Below both cards rather than beneath the one it belongs to -- side by side there is no
          "beneath this card" that does not shove the other one down the page. */}
      {choice === "yes" && (
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
              upstream still parses.
            */}
            <Input
              id="quote-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => onAmountChange(sanitizeAmount(e.target.value))}
              placeholder="320"
              className="pl-7"
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One of the two answers. No icon on either: "yes" and "no" to a question about a piece of paper
 * need no picture, and the pair only ever appeared to keep the two cards symmetrical with each
 * other rather than to tell them apart.
 *
 * `aria-pressed` rather than a radio group because these are buttons that also reveal a field --
 * the pressed state is what a screen reader needs to hear, and the visual ring alone does not
 * say it.
 */
function QuoteChoiceCard({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        // `h-full` so the shorter card matches the taller one rather than leaving a gap under it.
        "h-full w-full rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-foreground ring-1 ring-inset ring-foreground"
          : "bg-muted/50 hover:bg-accent",
      )}
    >
      <span className="text-base font-semibold">{title}</span>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </button>
  );
}
