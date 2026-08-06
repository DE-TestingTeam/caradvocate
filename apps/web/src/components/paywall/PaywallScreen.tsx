/**
 * The paywall in front of the Repair Cost Checker. Nobody is charged: the tap is recorded as a
 * willingness-to-pay signal and the feature opens. See apps/api/src/services/paywall.ts.
 *
 * The copy is worded for measurement, since the number is only worth having if a tap means "I
 * would pay this". So the price and cadence are stated before the button, the button says what
 * it costs rather than "Continue", and nothing above it says "free" or "trial" -- nobody
 * hesitates over a free thing, so nobody's tap would tell us anything.
 *
 * The line under the button is where the truth goes: no payment is taken, disclosed on the same
 * screen as the price rather than after the tap, and no card details are ever requested.
 */
import { Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatPrice } from '@/lib/format';
import type { PaywallStatus } from '@caradvocate/shared';

export function PaywallScreen({
  status,
  onUnlock,
  unlocking,
}: {
  status: PaywallStatus;
  onUnlock: () => void;
  unlocking: boolean;
}) {
  const price = formatPrice(status.priceCents, status.currency);

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-5 p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">Check what this repair should cost</h1>
          <p className="text-sm text-muted-foreground">
            Know whether the work is necessary and whether the price is fair, before you
            agree to it.
          </p>
        </div>

        <ul className="space-y-2 text-left">
          {status.includes.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-3 border-t pt-5">
          <div>
            <span className="text-3xl font-bold tracking-tight">{price}</span>
            <span className="text-sm text-muted-foreground"> / {status.interval}</span>
          </div>

          <Button size="lg" className="w-full" onClick={onUnlock} disabled={unlocking}>
            {unlocking ? 'Unlocking…' : `Unlock for ${price}/${status.interval}`}
          </Button>

          {/* The disclosure, before they tap and on the same screen as the price. */}
          <p className="text-xs text-muted-foreground">
            You will not be charged. We are testing what this is worth to people, so
            unlocking is free while CarAdvocate is in preview — no card, no payment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
