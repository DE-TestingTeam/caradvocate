import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
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
  const { pathname } = useLocation();

  if (error) {
    const missingVehicle = error instanceof ApiError && error.status === 404;
    if (missingVehicle) return <Navigate to="/onboarding" replace />;
    return <ErrorState message={error.message} />;
  }

  /*
   * This guard fronts My Car, Ask CA and the whole Repair Cost Checker, and it used to draw
   * MyCarSkeleton for all of them -- so opening Repairs began with a mocked-up My Car, recall
   * and maintenance headings included, before the actual Repairs skeleton replaced it.
   *
   * Each page now gets the shape of the page it is actually waiting for. My Car keeps its full
   * mirror, which it needs: `GET /vehicle` waits on a market-value call and can run several
   * seconds right after onboarding. Everything else opens with a PageHeader, so that is what
   * stands in -- the header lands in its final position and only the body below it swaps.
   */
  if (!data) return pathname === '/my-car' ? <MyCarSkeleton /> : <PageSkeleton />;

  return <Outlet context={{ vehicle: data } satisfies VehicleContext} />;
}

/**
 * The header every page behind this guard opens with, bar My Car: a title, a line of subtitle,
 * and nothing claimed about the body underneath. Matches PageHeader's own metrics -- `mb-8`,
 * `space-y-1` between the two lines -- so the real header does not shift when it arrives.
 */
function PageSkeleton() {
  return (
    <div className="mb-8 space-y-1">
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-5 w-96 max-w-full" />
    </div>
  );
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
      {/* Masthead: photo thumbnail, then eyebrow, name, subline. The Update mileage button is
          deliberately absent -- a control that appears before the data it acts on is a control
          someone can press too early -- and the header's own height keeps the layout from
          shifting when it arrives. */}
      <div className="flex items-center gap-5">
        <Skeleton className="aspect-[3/2] w-28 shrink-0 rounded-lg sm:w-44" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>

      {/* The stat strip: same borders, four placeholder figures. */}
      <div className="grid grid-cols-2 gap-6 border-y py-5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-10 lg:col-span-2">
          <Section title="What needs attention">
            <ListSkeleton rows={2} />
          </Section>
          <Section title="Service history">
            <ListSkeleton rows={4} />
          </Section>
        </div>
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 p-4 sm:p-6">
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>

      <Section title="Recalls for this model">
        <ListSkeleton rows={2} />
      </Section>
      <Section title="Scheduled maintenance">
        <ListSkeleton rows={4} />
      </Section>
      <Section title="Known issues for your model">
        <ListSkeleton rows={3} />
      </Section>
    </div>
  );
}
