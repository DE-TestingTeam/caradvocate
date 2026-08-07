import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import type { Vehicle } from "@caradvocate/shared";
import { CollapsibleSection } from "@/components/my-car/CollapsibleSection";
import { ListSkeleton } from "@/components/my-car/ListSkeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { getVehicle } from "@/lib/api";
import { ApiError } from "@/lib/http";
import { useApi } from "@/lib/useApi";

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
    <div className="space-y-8">
      <section className="space-y-4 lg:flex lg:items-center lg:gap-6 lg:space-y-0">
        <div className="lg:w-1/2 lg:shrink-0">
          <Skeleton className="aspect-[3/2] w-full rounded-lg" />
        </div>
        <div className="space-y-2 lg:min-w-0 lg:flex-1">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-9 w-40" />
        </div>
      </section>

      <Separator />

      <Card className="bg-muted/40">
        <CardContent className="space-y-2 p-4 sm:p-6">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-3 w-28" />
        </CardContent>
      </Card>

      <CollapsibleSection title="Safety Recalls">
        <ListSkeleton rows={2} />
      </CollapsibleSection>
      <CollapsibleSection title="Scheduled Maintenance">
        <ListSkeleton rows={4} />
      </CollapsibleSection>
      <CollapsibleSection title="Known Issues for Your Model">
        <ListSkeleton rows={3} />
      </CollapsibleSection>
      <CollapsibleSection title="Service & Repair History">
        <ListSkeleton rows={5} />
      </CollapsibleSection>
    </div>
  );
}
