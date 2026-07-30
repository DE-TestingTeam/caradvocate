import * as React from 'react';
import { ErrorState } from '@/components/ErrorState';
import { CollapsibleSection } from '@/components/my-car/CollapsibleSection';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceItemDialog } from '@/components/my-car/MaintenanceItemDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { RecallsList } from '@/components/my-car/RecallsList';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { ValueCard } from '@/components/my-car/ValueCard';
import { VehicleImage } from '@/components/my-car/VehicleImage';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { useToast } from '@/components/ui/toast';
import {
  clearRecallStatus,
  getKnownIssues,
  getMaintenance,
  getRecalls,
  getServiceHistory,
  setRecallRepaired,
} from '@/lib/api';
import { formatMileage, maskVin, vehicleName } from '@/lib/format';
import { invalidateAll, useApi } from '@/lib/useApi';
import type { MaintenanceItem, ServiceRecord } from '@caradvocate/shared';

export function MyCarPage() {
  // Resolved by RequireVehicle, so there is no loading or error state to handle.
  const vehicle = useVehicle();
  const recalls = useApi(getRecalls);
  const maintenance = useApi(getMaintenance);
  const issues = useApi(getKnownIssues);
  const history = useApi(getServiceHistory);
  const toast = useToast();

  const [addingJob, setAddingJob] = React.useState(false);
  const [editingJob, setEditingJob] = React.useState<MaintenanceItem>();
  const [editingRecord, setEditingRecord] = React.useState<ServiceRecord>();

  /**
   * Records the owner's answer, then refetches so the list reorders and the badge
   * changes from the server's view rather than an optimistic guess -- there are
   * three states here and a safety warning is the wrong place to be clever.
   */
  async function handleRecallStatus(campaignNumber: string, repaired: boolean | undefined) {
    try {
      if (repaired === undefined) await clearRecallStatus(campaignNumber);
      else await setRecallRepaired(campaignNumber, repaired);
      invalidateAll();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <VehicleImage vehicle={vehicle} />

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
          <RecallsList report={recalls.data} vin={vehicle.vin} onStatusChange={handleRecallStatus} />
        ) : (
          <ListSkeleton rows={2} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Scheduled Maintenance">
        {maintenance.error ? (
          <ErrorState message={maintenance.error.message} />
        ) : maintenance.data ? (
          <>
            <MaintenanceList items={maintenance.data} onEdit={setEditingJob} />
            <button
              type="button"
              onClick={() => setAddingJob(true)}
              className="mt-3 text-sm underline underline-offset-4 hover:text-foreground"
            >
              Add an upkeep job
            </button>
          </>
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
          <ServiceHistory records={history.data} onEdit={setEditingRecord} />
        ) : (
          <ListSkeleton rows={5} />
        )}
      </CollapsibleSection>

      <LogServiceDialog jobs={maintenance.data ?? []} />

      {/* Edit dialogs live here rather than inside each row, so one mounted dialog
          serves the whole list instead of one per item. */}
      <MaintenanceItemDialog open={addingJob} onOpenChange={setAddingJob} />
      <MaintenanceItemDialog
        key={editingJob?.id}
        item={editingJob}
        open={editingJob !== undefined}
        onOpenChange={(open) => !open && setEditingJob(undefined)}
      />
      <LogServiceDialog
        key={editingRecord?.id}
        jobs={maintenance.data ?? []}
        record={editingRecord}
        open={editingRecord !== undefined}
        onOpenChange={(open) => !open && setEditingRecord(undefined)}
      />
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
