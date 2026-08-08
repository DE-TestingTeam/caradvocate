import { Navigate, Outlet, useOutletContext } from 'react-router-dom';
import type { Vehicle } from '@caradvocate/shared';
import { Section } from '@/components/my-car/Section';
import { ListSkeleton } from '@/components/my-car/ListSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ErrorState';
import { getVehicle } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useApi } from '@/lib/useApi';

interface VehicleContext {
  vehicle: Vehicle;
}

export function RequireVehicle() {
  const { data, error } = useApi(getVehicle);

  if (error) {
    const missingVehicle = error instanceof ApiError && error.status === 404;
    if (missingVehicle) return <Navigate to="/onboarding" replace />;
    return <ErrorState message={error.message} />;
  }

  if (!data) return <MyCarSkeleton />;

  return <Outlet context={{ vehicle: data } satisfies VehicleContext} />;
}

export function useVehicle(): Vehicle {
  return useOutletContext<VehicleContext>().vehicle;
}

/**
 * Stands in for the whole of My Car while `GET /vehicle` is still in flight -- which, right
 * after onboarding, can run several seconds long (the request waits on a market-value call;
 * see services/marketValueSync.ts on the API). A generic spinner would say nothing for that
 * whole wait, so this mirrors My Car's actual layout instead: same hero shape, same section
 * titles, same row counts. Nothing here waits on data -- the titles are static copy -- so
 * when the real page mounts, headers do not shift and only the skeleton rows swap for content.
 */
function MyCarSkeleton() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Skeleton className="aspect-[3/2] w-full rounded-lg" />

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>

          {/* The value card now sits in the hero rather than below it, so the skeleton has to
              as well -- this block is only worth having if it mirrors the real page exactly. */}
          <Card className="bg-muted/40">
            <CardContent className="space-y-2 p-4 sm:p-6">
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* The action buttons are deliberately absent. They are static copy, so drawing them
          here would look right -- but a control that appears before the data it acts on is a
          control someone can press too early. The `min-h` on Section's header keeps the rule
          in the same place either way, so nothing shifts when they arrive. */}
      <Section title="Recalls for this model">
        <ListSkeleton rows={2} />
      </Section>
      <Section title="Scheduled maintenance">
        <ListSkeleton rows={4} />
      </Section>
      <Section title="Known issues for your model">
        <ListSkeleton rows={3} />
      </Section>
      <Section title="Service history">
        <ListSkeleton rows={5} />
      </Section>
    </div>
  );
}
