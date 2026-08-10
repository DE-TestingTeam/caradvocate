/**
 * The door in front of the Repair Cost Checker pages. Shows the price to anyone who has not
 * unlocked it, and gets out of the way for anyone who has.
 *
 * Not the actual lock -- that is apps/api/src/middleware/requirePaid.ts, which checks every
 * request. This only decides what to draw.
 *
 * The page renders underneath even while locked -- a preview of the Repair Cost Checker rather
 * than a blank wall -- but a non-dismissable modal sits on top of it: no trigger, no close
 * button, Escape and outside-click both swallowed. `open` is tied straight to the server's
 * `unlocked` answer, so there is no local state that could dismiss it independent of that
 * answer, and no route to duck behind since the dialog's overlay covers the whole viewport.
 */
import * as React from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { PaywallScreen } from '@/components/paywall/PaywallScreen';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { getPaywall, unlockPaywall } from '@/lib/api';
import { invalidateAll, useApi } from '@/lib/useApi';
import type { PricingModel } from '@caradvocate/shared';

export function RequirePaidPlan() {
  const { data, error } = useApi(getPaywall);
  const [unlocking, setUnlocking] = React.useState(false);
  const toast = useToast();

  // Passed straight through. RequireVehicle supplies the vehicle this way, and a bare <Outlet />
  // below would drop it and break useVehicle() on every page.
  const inherited = useOutletContext();

  async function handleUnlock(model: PricingModel) {
    setUnlocking(true);
    try {
      await unlockPaywall("repair_cost_checker", model);
      // Re-asks the server rather than assuming the write worked.
      invalidateAll();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not unlock that.");
    } finally {
      setUnlocking(false);
    }
  }

  if (error) return <ErrorState message={error.message} />;

  /*
   * The page goes straight through, including while `getPaywall` is still in flight.
   *
   * This used to hold it back behind `<Skeleton className="h-96 max-w-md" />` -- one large
   * centred box, which is nothing like the shape of any page behind this gate. On Repairs it
   * meant a single grey slab, then the page's own three-card skeleton, then the cards: two
   * different skeletons for one load.
   *
   * What that wait was protecting is already protected. The reason given for it was that
   * showing the page early would flash it unlocked -- but the assessment endpoints are gated
   * server-side too (app.ts mounts `requirePaid` on /api/assessments), so a locked account's
   * requests fail regardless of what this component draws. There is no unlocked state to flash
   * into: the page underneath is the empty preview the comment below already describes.
   *
   * The dialog stays shut until the answer actually arrives, so an unlocked account never sees
   * the paywall blink open on the way past.
   */
  return (
    <>
      <Outlet context={inherited} />

      {data && (
        <Dialog open={!data.unlocked}>
          <DialogContent
            hideClose
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <PaywallScreen status={data} onUnlock={handleUnlock} unlocking={unlocking} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
