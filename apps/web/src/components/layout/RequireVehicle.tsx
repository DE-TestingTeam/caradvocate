import { Navigate, Outlet, useOutletContext } from 'react-router-dom';
import type { Vehicle } from '@caradvocate/shared';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { getVehicle } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useApi } from '@/lib/useApi';

interface VehicleContext {
  vehicle: Vehicle;
}

/**
 * Sends users with no vehicle to onboarding.
 *
 * Every screen assumes a car exists, so without this a new account lands on a
 * 404 with nothing to do. A 404 from the API means "no vehicle yet"; any other
 * failure is a real error and is shown as one.
 *
 * The vehicle it fetched is passed down through the outlet rather than left for
 * each child to fetch again -- see useVehicle() below.
 */
export function RequireVehicle() {
  const { data, error } = useApi(getVehicle);

  if (error) {
    const missingVehicle = error instanceof ApiError && error.status === 404;
    if (missingVehicle) return <Navigate to="/onboarding" replace />;
    return <ErrorState message={error.message} />;
  }

  // Absent only on the first load; a revalidation keeps the previous vehicle, so
  // children are not torn down and remounted on every mutation.
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

/**
 * The current vehicle, for any page rendered inside <RequireVehicle>.
 *
 * Non-optional by construction: the gate above has already resolved the fetch,
 * redirected when there was no car, and rendered the error state on failure. So
 * callers never handle loading or error for the vehicle, and never refetch it.
 */
export function useVehicle(): Vehicle {
  return useOutletContext<VehicleContext>().vehicle;
}
