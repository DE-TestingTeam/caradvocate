import { ErrorState } from '@/components/ErrorState';
import { CollapsibleSection } from '@/components/my-car/CollapsibleSection';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { RecallsList } from '@/components/my-car/RecallsList';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { ValueCard } from '@/components/my-car/ValueCard';
import { ViewerPlaceholder } from '@/components/my-car/ViewerPlaceholder';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { getKnownIssues, getMaintenance, getRecalls, getServiceHistory } from '@/lib/api';
import { formatMileage, maskVin, vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export function MyCarPage() {
  // Resolved by RequireVehicle, so there is no loading or error state to handle.
  const vehicle = useVehicle();
  const recalls = useApi(getRecalls);
  const maintenance = useApi(getMaintenance);
  const issues = useApi(getKnownIssues);
  const history = useApi(getServiceHistory);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <ViewerPlaceholder />

        <div>
          <h1 className="text-3xl font-bold tracking-tight">{vehicleName(vehicle)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMileage(vehicle.mileage)}
            {/* No VIN is a normal state for a car added without one. */}
            {vehicle.vin && ` · VIN: ${maskVin(vehicle.vin)}`}
          </p>
        </div>
      </section>

      <Separator />

      <ValueCard vehicle={vehicle} />

      {/* Recalls come from NHTSA and stand on their own; maintenance is still
          unsourced, so they are separate sections rather than one merged list. */}
      <CollapsibleSection title="Safety Recalls">
        {recalls.error ? (
          <ErrorState message={recalls.error.message} />
        ) : recalls.data ? (
          <RecallsList report={recalls.data} />
        ) : (
          <ListSkeleton rows={2} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Scheduled Maintenance">
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
          <KnownIssuesList report={issues.data} vehicle={vehicle} />
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
