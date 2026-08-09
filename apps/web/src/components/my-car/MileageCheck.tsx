import * as React from 'react';
import { Gauge, X } from 'lucide-react';
import {
  daysSinceMileageReading,
  estimateCurrentMileage,
  mileageIsStale,
  type Vehicle,
} from '@caradvocate/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateVehicle } from '@/lib/api';
import { formatMileage } from '@/lib/format';
import { useWrite } from '@/lib/useWrite';

/**
 * Asks the owner to confirm their odometer when the reading on file has gone stale.
 *
 * WHY THIS EXISTS. `vehicles.mileage` used to be written at onboarding and then never again for
 * most owners, while three things read it as current: the maintenance due calculation, the price
 * sent to MarketCheck, and the masthead above this card. services/odometer.ts closed the free
 * half by raising the figure from logged service records -- but a car that is not serviced is
 * never read, and that is precisely the car whose owner is not tracking any of this. Asking is
 * the only thing that reaches them.
 *
 * WHY IT IS A CARD AND NOT A MODAL. It interrupts nothing. A dialog on page load would demand an
 * answer before the owner has seen the page they came for, and the honest answer to "how many
 * miles?" is often "let me go and look" -- which a modal punishes and a card waits through.
 *
 * WHY THE FIELD IS PREFILLED. A blank box asks the owner to fetch an exact number from the
 * driveway, and most will close it instead. A figure they only have to agree with or nudge is
 * answerable from the sofa, and an approximate reading confirmed today beats an exact one from
 * two years ago -- which is what it is replacing. The estimate itself is never saved unless they
 * submit it: see estimateCurrentMileage in @caradvocate/shared for why that restriction is the
 * whole design.
 */
export function MileageCheck({ vehicle }: { vehicle: Vehicle }) {
  const [dismissed, setDismissed] = React.useState(() => wasDismissed(vehicle.id));
  const estimate = estimateCurrentMileage(vehicle);
  const [value, setValue] = React.useState(() => String(estimate));
  const { saving, write } = useWrite(() => undefined);

  if (dismissed || !mileageIsStale(vehicle)) return null;

  const entered = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(entered) && entered >= 0 && !saving;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;

    await write(
      () => updateVehicle({ mileage: entered }),
      'Thanks — your mileage is up to date.',
      'Could not save that.',
    );
  }

  /**
   * Dismissal lasts for the tab, not forever. A stale odometer does not stop being a problem
   * because someone was busy, so this must come back -- but returning on the next click of My
   * Car would make it an obstacle rather than a prompt. sessionStorage matches how the app
   * already scopes per-tab state (see lib/chatTranscript.ts).
   */
  function handleDismiss() {
    setDismissed(true);
    rememberDismissed(vehicle.id);
  }

  return (
    <Card className="border-dashed bg-muted/40">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Is this still about right?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {lastReadingSentence(vehicle)} We use your mileage to work out what upkeep is due
                and what the car is worth, so an old reading makes both wrong.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="mileage-check" className="text-xs text-muted-foreground">
                  Current mileage
                </Label>
                {/*
                  `inputMode="numeric"` rather than `type="number"`: a number input on a phone is
                  a spinner nobody wants for a five-digit figure, and scroll-wheel focus can
                  change it by accident. The value is parsed and checked above regardless.
                */}
                <Input
                  id="mileage-check"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-36"
                  value={value}
                  onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
                />
              </div>

              <Button type="submit" disabled={!valid}>
                {saving ? 'Saving…' : 'That looks right'}
              </Button>
            </form>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Not now</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Says how old the reading is in the units the owner thinks in, and never pretends to know more
 * than it does -- a car with no recorded date gets the vaguer sentence rather than a made-up age.
 */
function lastReadingSentence(vehicle: Vehicle): string {
  const days = daysSinceMileageReading(vehicle);
  const reading = formatMileage(vehicle.mileage);

  if (days == null) return `We have ${reading} on file, but not when it was taken.`;

  const months = Math.floor(days / 30);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    return `The last reading we have is ${reading}, from over ${years === 1 ? 'a year' : `${years} years`} ago.`;
  }
  return `The last reading we have is ${reading}, from about ${months} months ago.`;
}

const DISMISS_KEY = 'caradvocate.mileageCheckDismissed';

function wasDismissed(vehicleId: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === vehicleId;
  } catch {
    // Private browsing can throw on access. A prompt that shows is better than a crash.
    return false;
  }
}

function rememberDismissed(vehicleId: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, vehicleId);
  } catch {
    // Dismissal not sticking for the tab is a small cost; failing the click is not.
  }
}
