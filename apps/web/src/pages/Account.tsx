import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { EditProfileDialog } from '@/components/account/EditProfileDialog';
import { EditVehicleDialog } from '@/components/account/EditVehicleDialog';
import { FieldRow } from '@/components/account/FieldRow';
import { PageHeader } from '@/components/layout/PageHeader';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { getAccount, getPaywall, unlockPaywall } from '@/lib/api';
import { formatMileage, formatPrice, maskVinTail, vehicleName } from '@/lib/format';
import { invalidateAll, useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';
import type { PricingModel } from '@caradvocate/shared';

const PRICING_MODEL_NAME: Record<PricingModel, string> = {
  all_you_can_eat: 'Unlimited',
  per_incident: 'Per-Incident',
};

/**
 * Unlocks from Account rather than the Repair Cost Checker gate, recorded with its own source: a
 * tap here is a colder signal than one from someone who arrived mid-repair via Ask CA.
 */
function UnlockButton() {
  const { data: paywall } = useApi(getPaywall);
  const [selected, setSelected] = React.useState<PricingModel>('all_you_can_eat');
  const [unlocking, setUnlocking] = React.useState(false);
  const toast = useToast();

  async function handleUnlock() {
    setUnlocking(true);
    try {
      await unlockPaywall('account', selected);
      invalidateAll();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not unlock that.');
    } finally {
      setUnlocking(false);
    }
  }

  if (!paywall) return <Skeleton className="h-10 w-full" />;

  const chosen = paywall.offers.find((offer) => offer.model === selected) ?? paywall.offers[0];
  const price = formatPrice(chosen.priceCents, chosen.currency);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {paywall.offers.map((offer) => (
          <button
            key={offer.model}
            type="button"
            onClick={() => setSelected(offer.model)}
            aria-pressed={offer.model === selected}
            className={cn(
              'flex-1 rounded-md border px-2 py-1.5 text-xs',
              offer.model === selected ? 'border-primary bg-primary/5 font-semibold' : 'border-input',
            )}
          >
            {PRICING_MODEL_NAME[offer.model]} — {formatPrice(offer.priceCents, offer.currency)}/{offer.interval}
          </button>
        ))}
      </div>
      <Button className="w-full" onClick={handleUnlock} disabled={unlocking}>
        {unlocking ? 'Unlocking…' : `Unlock the Repair Cost Checker — ${price}/${chosen.interval}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        You will not be charged. Unlocking is free while CarAdvocate is in preview.
      </p>
    </div>
  );
}

export function AccountPage() {
  const { data: account, error: accountError } = useApi(getAccount);
  // From RequireVehicle, rather than a second `GET /vehicle` of this page's own: the guard has
  // already waited for that answer to decide whether to render this page at all.
  const vehicle = useVehicle();
  const { hash } = useLocation();

  /**
   * Honours `#vehicle`, which My Car's "Edit car details" links to. React Router does not scroll
   * to a hash by itself. The card is at its final size on first paint -- the vehicle arrives with
   * the page now -- so there is nothing to wait for before aiming at it.
   */
  React.useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <div>
      <PageHeader title="Account" />

      {accountError && <ErrorState message={accountError.message} className="mb-4" />}

      <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
        {/* Profile */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            {account ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{initials(account.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-lg font-semibold leading-tight">{account.name}</div>
                    <div className="text-sm text-muted-foreground">Member since {account.memberSince}</div>
                  </div>
                </div>
                <div>
                  <FieldRow label="Email" value={account.email} />
                  <FieldRow label="Phone" value={account.phone} />
                  {/*
                    A zip is where the OWNER is, not a property of the car, so it sits with the
                    contact details however it is stored -- `vehicles.zip`, because the valuation
                    call it feeds is per vehicle.

                    Shown even when empty, and worth the row for that case: a zip is optional at
                    onboarding but no market value can be fetched without one, so an owner
                    looking at "not available yet" on My Car needs somewhere that names the
                    missing ingredient.
                  */}
                  <FieldRow
                    label="Zip code"
                    value={
                      vehicle.zip ?? (
                        <span className="text-muted-foreground">Not added — needed for market value</span>
                      )
                    }
                  />
                </div>
                <EditProfileDialog account={account} />
              </>
            ) : (
              <CardSkeleton />
            )}
          </CardContent>
        </Card>

        {/* Vehicle. `scroll-mt-6` keeps it clear of the top edge when linked to by hash. */}
        <Card id="vehicle" className="scroll-mt-6">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="text-body-lg font-semibold tracking-tight">Your vehicle</h2>
            <div>
              <FieldRow label="Vehicle" value={vehicleName(vehicle)} />
              <FieldRow label="VIN" value={vehicle.vin ? maskVinTail(vehicle.vin) : 'Not added'} />
              <FieldRow label="Mileage" value={formatMileage(vehicle.mileage)} />
            </div>
            <EditVehicleDialog vehicle={vehicle} />
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card className="md:col-span-2">
          <CardContent className="space-y-4 p-4 sm:p-6">
            {account ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-body-lg font-semibold tracking-tight">Subscription</h2>
                  <Badge variant="outline" className="shrink-0">
                    {account.plan === 'paid' && account.pricingModel
                      ? `Paid — ${PRICING_MODEL_NAME[account.pricingModel]}`
                      : 'Free plan'}
                  </Badge>
                </div>
                <div>
                  {account.features.map((feature) => (
                    <FieldRow
                      key={feature.name}
                      label={feature.name}
                      value={
                        feature.status === 'Active' ? (
                          <span className="font-semibold">{feature.status}</span>
                        ) : (
                          feature.status
                        )
                      }
                    />
                  ))}
                </div>
                {/* The spec puts "plan / paywall status" on this page. For a free
                    account that means a way through the paywall from here, which is
                    a second entry point and is recorded as such. */}
                {account.plan === 'free' ? (
                  <UnlockButton />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Unlocked while CarAdvocate is in preview. You have not been charged.
                  </p>
                )}
              </>
            ) : (
              <CardSkeleton />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function CardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-40" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
