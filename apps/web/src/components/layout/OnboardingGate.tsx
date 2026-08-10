import * as React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getVehicle } from '@/lib/api';
import { ApiError } from '@/lib/http';

/** Asked once on arrival, then held: see why the answer must not be re-opened mid-flow. */
type Verdict = 'checking' | 'needed' | 'done' | { failed: string };

/**
 * The mirror of RequireVehicle: that guard keeps an owner out of the app until onboarding is
 * done, this one keeps them out of onboarding once it is.
 *
 * Both read the same signal -- whether `GET /vehicle` finds a car -- because that is what
 * finishing onboarding actually does (the vehicle step is last, and it is the write that ends
 * the flow). Anything else, a local flag or a "came from signup" hint, could disagree with the
 * server and leave someone bouncing between the two guards.
 *
 * Asked ONCE, on mount, rather than through useApi. That hook re-runs on every invalidateAll(),
 * and clears its error while the new request is in flight -- so the moment the profile step
 * saved and invalidated, this gate lost its 404, fell back to the skeleton below, and unmounted
 * the flow it was guarding. It remounted at step one with empty fields when the 404 returned,
 * which read as "Continue does nothing". The question here is about the person arriving, and it
 * has exactly one right answer for the whole visit; re-asking it can only take the flow away
 * from someone in the middle of it. The vehicle step navigates to /my-car itself once the car
 * is saved, so nothing is waiting on this gate to notice.
 */
export function OnboardingGate() {
  const [verdict, setVerdict] = React.useState<Verdict>('checking');

  React.useEffect(() => {
    let active = true;

    getVehicle().then(
      () => {
        if (active) setVerdict('done');
      },
      (cause: Error) => {
        if (!active) return;
        // 404 is the expected answer here -- it is precisely what "not onboarded yet" looks like.
        const missingVehicle = cause instanceof ApiError && cause.status === 404;
        setVerdict(missingVehicle ? 'needed' : { failed: cause.message });
      },
    );

    return () => {
      active = false;
    };
  }, []);

  if (verdict === 'needed') return <Outlet />;
  if (verdict === 'done') return <Navigate to="/my-car" replace />;
  if (verdict !== 'checking') return <ErrorState message={verdict.failed} />;

  // Still asking. Drawing the form now would mean showing it to someone who is about to be
  // redirected away from it, and taking their first keystrokes with it.
  return <OnboardingSkeleton />;
}

/** The shape of the step below: progress bar, heading, and the card the questions sit in. */
function OnboardingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <Skeleton className="h-5 w-24" />
      <div className="mt-2 flex gap-1.5">
        <Skeleton className="h-1.5 flex-1 rounded-full" />
        <Skeleton className="h-1.5 flex-1 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-9 w-3/4" />
      <Skeleton className="mt-2 h-5 w-1/2" />
      <Card className="mt-6">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
