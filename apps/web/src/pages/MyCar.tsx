import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { CollapsibleSection } from '@/components/my-car/CollapsibleSection';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { ListSkeleton } from '@/components/my-car/ListSkeleton';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceItemDialog } from '@/components/my-car/MaintenanceItemDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { RecallsList } from '@/components/my-car/RecallsList';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { ValueCard } from '@/components/my-car/ValueCard';
import { VehicleImage } from '@/components/my-car/VehicleImage';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
   * Records the owner's answer, then refetches so the list reorders from the server's view
   * rather than an optimistic guess -- a safety warning is the wrong place to be clever.
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
      {/*
        Stacked on phones and tablets, side by side from `lg`. The photo is 3:2 and the details
        beside it are three short lines, so they are centred against it rather than pinned to
        the top -- top-aligned left a column of empty space under the button that read as
        something failing to load.

        `lg:min-w-0` on the text column: a flex child defaults to min-width:auto, which refuses
        to shrink below its longest word, and a long make and model would push the photo narrow
        rather than wrapping.
      */}
      <section className="space-y-4 lg:flex lg:items-center lg:gap-6 lg:space-y-0">
        <div className="lg:w-1/2 lg:shrink-0">
          <VehicleImage vehicle={vehicle} />
        </div>

        <div className="lg:min-w-0 lg:flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{vehicleName(vehicle)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMileage(vehicle.mileage)}
            {/* No VIN is a normal state for a car added without one. */}
            {vehicle.vin && ` · VIN: ${maskVin(vehicle.vin)}`}
          </p>

          {/*
            Editing lives on Account, so this links there rather than opening a second copy of
            the dialog -- two places to change a mileage is two places for them to disagree.
            The hash lands on the vehicle card instead of the top of the page, since arriving at
            a profile form after tapping "Edit" under a car reads as the wrong page.
          */}
          <Button asChild size="sm" className="mt-3">
            <Link to="/account#vehicle">
              <Pencil className="h-4 w-4" />
              Edit car details
            </Link>
          </Button>
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
