/**
 * Puts the paywall in front of the Repair Cost Checker routes.
 *
 * Mirrors RequireVehicle: resolve once at the gate, so no child page has to know
 * whether the owner is past it. The API enforces the same rule independently (see
 * apps/api/src/middleware/requirePaid.ts) -- this gate is what the owner sees, that
 * one is what makes the recorded tap mean they chose to open it.
 *
 * Renders the paywall in place rather than redirecting. A redirect would lose the
 * route they were heading for, and Ask CA's "CHECK REPAIR COSTS" answer sends people
 * straight to /assessments/new -- landing them somewhere else would break the one
 * hand-off the spec is explicit about.
 */
import * as React from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { PaywallScreen } from '@/components/paywall/PaywallScreen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { getPaywall, unlockPaywall } from '@/lib/api';
import { invalidateAll, useApi } from '@/lib/useApi';

export function RequirePaidPlan() {
  const { data, error } = useApi(getPaywall);
  const [unlocking, setUnlocking] = React.useState(false);
  const toast = useToast();

  // Forwarded, not dropped. This gate sits inside RequireVehicle, which hands the
  // resolved vehicle down through the outlet -- rendering a bare <Outlet /> here
  // would replace that context with nothing and break useVehicle() on every page
  // below, which is exactly what it did the first time.
  const inherited = useOutletContext();

  async function handleUnlock() {
    setUnlocking(true);
    try {
      await unlockPaywall('repair_cost_checker');
      // Refetches this gate along with everything else, so the Outlet renders from
      // the server's answer rather than from an assumption that the write worked.
      invalidateAll();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not unlock that.');
    } finally {
      setUnlocking(false);
    }
  }

  if (error) return <ErrorState message={error.message} />;

  // Absent only on first load; a revalidation keeps the previous status so unlocking
  // does not flash the paywall again on the way through.
  if (!data) return <Skeleton className="mx-auto h-96 w-full max-w-md rounded-lg" />;

  if (!data.unlocked) {
    return <PaywallScreen status={data} onUnlock={handleUnlock} unlocking={unlocking} />;
  }

  return <Outlet context={inherited} />;
}
