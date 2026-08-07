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
import * as React from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PaywallScreen } from "@/components/paywall/PaywallScreen";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getPaywall, unlockPaywall } from "@/lib/api";
import { invalidateAll, useApi } from "@/lib/useApi";
import type { PricingModel } from "@caradvocate/shared";

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

  // First load only, before it is known whether to gate at all -- showing the page early would
  // flash it unlocked for a moment if it turns out not to be. Later refetches keep the old
  // status, so unlocking does not flash the paywall shut again on the way out.
  if (!data) return <Skeleton className="mx-auto h-96 w-full max-w-md rounded-lg" />;

  return (
    <>
      <Outlet context={inherited} />

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
    </>
  );
}
