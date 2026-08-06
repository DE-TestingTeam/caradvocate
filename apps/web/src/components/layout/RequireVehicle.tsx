import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import type { Vehicle } from "@caradvocate/shared";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
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

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-9 w-56" />
      </div>
    );
  }

  return <Outlet context={{ vehicle: data } satisfies VehicleContext} />;
}

export function useVehicle(): Vehicle {
  return useOutletContext<VehicleContext>().vehicle;
}
