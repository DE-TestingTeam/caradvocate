import { ErrorState } from '@/components/ErrorState';
import { CollapsibleSection } from '@/components/my-car/CollapsibleSection';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { ValueCard } from '@/components/my-car/ValueCard';
import { ViewerPlaceholder } from '@/components/my-car/ViewerPlaceholder';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getKnownIssues, getMaintenance, getServiceHistory, getVehicle } from '@/lib/api';
import { formatMileage, maskVin, vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export function MyCarPage() {
  const vehicle = useApi(getVehicle);
  const maintenance = useApi(getMaintenance);
  const issues = useApi(getKnownIssues);
  const history = useApi(getServiceHistory);

  // The vehicle drives the whole screen, so its failure replaces the page.
  if (vehicle.error) {
    return <ErrorState message={vehicle.error.message} />;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <ViewerPlaceholder />

        {vehicle.data ? (
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{vehicleName(vehicle.data)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMileage(vehicle.data.mileage)} · VIN: {maskVin(vehicle.data.vin)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-5 w-72" />
          </div>
        )}
      </section>

      <Separator />

      {vehicle.data ? <ValueCard vehicle={vehicle.data} /> : <Skeleton className="h-72 w-full rounded-lg" />}

      <CollapsibleSection title="Recalls & Maintenance">
        {maintenance.error ? (
          <ErrorState message={maintenance.error.message} />
        ) : maintenance.data ? (
          <MaintenanceList items={maintenance.data} />
        ) : (
          <ListSkeleton rows={4} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Known Issues for Your Model">
        {issues.error ? (
          <ErrorState message={issues.error.message} />
        ) : issues.data ? (
          <KnownIssuesList issues={issues.data} />
        ) : (
          <ListSkeleton rows={3} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Service & Repair History">
        {history.error ? (
          <ErrorState message={history.error.message} />
        ) : history.data ? (
          <ServiceHistory records={history.data} />
        ) : (
          <ListSkeleton rows={5} />
        )}
      </CollapsibleSection>

      <LogServiceDialog />
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
