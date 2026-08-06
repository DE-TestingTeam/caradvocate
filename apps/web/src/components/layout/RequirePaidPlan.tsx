/**
 * The door in front of the Repair Cost Checker pages. Shows the price to anyone who has not
 * unlocked it, and gets out of the way for anyone who has.
 *
 * Not the actual lock -- that is apps/api/src/middleware/requirePaid.ts, which checks every
 * request. This only decides what to draw.
 *
 * Shows the paywall in place rather than redirecting, because Ask CA links straight to
 * /assessments/new and a redirect would lose where the owner was heading.
 */
import * as React from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PaywallScreen } from "@/components/paywall/PaywallScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getPaywall, unlockPaywall } from "@/lib/api";
import { invalidateAll, useApi } from "@/lib/useApi";

export function RequirePaidPlan() {
  const { data, error } = useApi(getPaywall);
  const [unlocking, setUnlocking] = React.useState(false);
  const toast = useToast();

  // Passed straight through. RequireVehicle supplies the vehicle this way, and a bare <Outlet />
  // below would drop it and break useVehicle() on every page.
  const inherited = useOutletContext();

  async function handleUnlock() {
    setUnlocking(true);
    try {
      await unlockPaywall("repair_cost_checker");
      // Re-asks the server rather than assuming the write worked.
      invalidateAll();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not unlock that.");
    } finally {
      setUnlocking(false);
    }
  }

  if (error) return <ErrorState message={error.message} />;

  // First load only. Later refetches keep the old status, so unlocking does not flash the
  // paywall on the way out.
  if (!data)
    return <Skeleton className="mx-auto h-96 w-full max-w-md rounded-lg" />;

  if (!data.unlocked) {
    return (
      <PaywallScreen
        status={data}
        onUnlock={handleUnlock}
        unlocking={unlocking}
      />
    );
  }

  return <Outlet context={inherited} />;
}
