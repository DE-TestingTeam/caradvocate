/**
 * The paywall in front of the Repair Cost Checker. Nobody is charged: the tap is recorded as a
 * willingness-to-pay signal and the feature opens. See apps/api/src/services/paywall.ts.
 *
 * Two offers are shown side by side rather than one, because which shape of pricing people
 * prefer -- one flat subscription, or a cheaper subscription plus a per-lookup fee -- is
 * itself part of what this prototype measures. The owner picks one before tapping unlock, and
 * which one they picked is recorded with the tap.
 *
 * The copy is worded for measurement, since the number is only worth having if a tap means "I
 * would pay this". So the price and cadence are stated before the button, the button says what
 * it costs rather than "Continue", and nothing above it says "free" or "trial" -- nobody
 * hesitates over a free thing, so nobody's tap would tell us anything.
 *
 * The line under the button is where the truth goes: no payment is taken, disclosed on the same
 * screen as the price rather than after the tap, and no card details are ever requested.
 *
 * Rendered inside a non-dismissable Dialog (see RequirePaidPlan) rather than in place of the
 * page, so the Repair Cost Checker shows through, dimmed, behind it -- a preview of what
 * unlocking opens rather than a blank wall. It has no Card of its own for that reason: the
 * Dialog's own surface is the card, and nesting a second one would double the border.
 */
import * as React from 'react';
import { Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import type { PaywallStatus, PricingModel, PricingOffer } from '@caradvocate/shared';

const OFFER_COPY: Record<PricingModel, { name: string; description?: string }> = {
  all_you_can_eat: { name: 'Unlimited', description: 'One flat price, no per-check fees' },
  // No description here: the per-lookup fee line below already says the one thing that
  // distinguishes this offer, and repeating it in different words was redundant.
  per_incident: { name: 'Per-Incident' },
};

function OfferCard({
  offer,
  selected,
  onSelect,
}: {
  offer: PricingOffer;
  selected: boolean;
  onSelect: () => void;
}) {
  const copy = OFFER_COPY[offer.model];
  const price = formatPrice(offer.priceCents, offer.currency);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full space-y-1 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{copy.name}</span>
        <span className="text-sm font-bold">
          {price}
          <span className="font-normal text-muted-foreground">/{offer.interval}</span>
        </span>
      </div>
      {copy.description && <p className="text-xs text-muted-foreground">{copy.description}</p>}
      {offer.perIncidentFeeCents != null && (
        <p className="text-xs text-muted-foreground">
          + {formatPrice(offer.perIncidentFeeCents, offer.currency)} per parts-benchmark lookup
        </p>
      )}
    </button>
  );
}

export function PaywallScreen({
  status,
  onUnlock,
  unlocking,
}: {
  status: PaywallStatus;
  onUnlock: (model: PricingModel) => void;
  unlocking: boolean;
}) {
  const [selected, setSelected] = React.useState<PricingModel>(status.offers[0].model);
  const chosen = status.offers.find((offer) => offer.model === selected) ?? status.offers[0];
  const price = formatPrice(chosen.priceCents, chosen.currency);

  return (
    <div className="space-y-5 pt-2 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
      </div>

      <div className="space-y-1.5">
        <DialogTitle className="text-xl font-bold tracking-tight">Check what this repair should cost</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Know whether the work is necessary and whether the price is fair, before you agree to it.
        </DialogDescription>
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
        <div className="space-y-2">
          {status.offers.map((offer) => (
            <OfferCard
              key={offer.model}
              offer={offer}
              selected={offer.model === selected}
              onSelect={() => setSelected(offer.model)}
            />
          ))}
        </div>

        <Button className="w-full" onClick={() => onUnlock(selected)} disabled={unlocking}>
          {unlocking ? 'Unlocking…' : `Unlock for ${price}/${chosen.interval}`}
        </Button>

        {/* The disclosure, before they tap and on the same screen as the price. */}
        <p className="text-xs text-muted-foreground">
          You will not be charged. We are testing what this is worth to people, so unlocking is
          free while CarAdvocate is in preview — no card, no payment.
        </p>
      </div>
    </div>
  );
}
