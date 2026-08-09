import * as React from 'react';
import { Plus } from 'lucide-react';
import { ErrorState } from '@/components/ErrorState';
import { Section } from '@/components/my-car/Section';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { ListSkeleton } from '@/components/my-car/ListSkeleton';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceItemDialog } from '@/components/my-car/MaintenanceItemDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { MileageCheck } from '@/components/my-car/MileageCheck';
import { RecallsList } from '@/components/my-car/RecallsList';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { ValueCard } from '@/components/my-car/ValueCard';
import { VehicleImage } from '@/components/my-car/VehicleImage';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-10">
      {/*
        The masthead: photo on the left, identity and worth on the right. Stacked below `lg`.

        `lg:items-start` rather than centred. The right column is now the taller of the two --
        name, plate line and the whole value card -- so centring would float the photo in the
        middle of it with dead space above and below.

        `min-w-0` on the right column: a grid child defaults to a floor of its content's width,
        and the value card's big currency figure would refuse to shrink, pushing the photo
        narrow instead of wrapping.
      */}
      <section className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <VehicleImage vehicle={vehicle} />

        <div className="min-w-0 space-y-4">
          <div>
            {/* The one h1 on the page. Everything below is a signpost within it. */}
            <h1 className="text-h1 font-bold">{vehicleName(vehicle)}</h1>
            <p className="mt-2 text-body text-muted-foreground">
              {formatMileage(vehicle.mileage)}
              {/* No VIN is a normal state for a car added without one. */}
              {vehicle.vin && ` · VIN: ${maskVin(vehicle.vin)}`}
            </p>
          </div>

          <ValueCard vehicle={vehicle} />
        </div>
      </section>

      {/*
        Full width and below the masthead, not inside it. The prompt is about the mileage printed
        two lines up, so it wants to be near it -- but the right column is already the taller of
        the two, and dropping a form into it would push the value card out of line with the photo
        on every stale car. Renders nothing at all when the reading is fresh.
      */}
      <MileageCheck vehicle={vehicle} />

      {/*
        Recalls come from NHTSA and stand on their own; maintenance is the owner's own
        schedule. Separate sections, so a safety recall is never read as one more chore.

        "for this model", not "Safety recalls", and the wording is load-bearing. NHTSA's feed
        is queried by year/make/model -- it lists every campaign that touched ANY car of this
        model, and each one covers only "certain" vehicles inside a VIN or build-date range
        that NHTSA does not publish. So this list can show a campaign this particular car was
        never subject to, which is exactly why a VIN-level checker can say "no recalls" while
        this section shows several.

        Only the manufacturer knows the per-VIN answer, and there is no API for it -- hence
        the VIN link in the list's footer. Until there is, the heading must not claim more
        than the data supports.
      */}
      <Section title="Recalls for this model">
        {recalls.error ? (
          <ErrorState message={recalls.error.message} />
        ) : recalls.data ? (
          <RecallsList report={recalls.data} vin={vehicle.vin} year={vehicle.year} onStatusChange={handleRecallStatus} />
        ) : (
          <ListSkeleton rows={2} />
        )}
      </Section>

      <Section
        title="Scheduled maintenance"
        action={
          <Button variant="secondary" size="sm" onClick={() => setAddingJob(true)}>
            <Plus className="h-4 w-4" />
            Add an upkeep job
          </Button>
        }
      >
        {maintenance.error ? (
          <ErrorState message={maintenance.error.message} />
        ) : maintenance.data ? (
          <MaintenanceList items={maintenance.data} onEdit={setEditingJob} />
        ) : (
          <ListSkeleton rows={4} />
        )}
      </Section>

      <Section title="Known issues for your model">
        {issues.error ? (
          <ErrorState message={issues.error.message} />
        ) : issues.data ? (
          <KnownIssuesList report={issues.data} vehicle={vehicle} />
        ) : (
          <ListSkeleton rows={3} />
        )}
      </Section>

      {/* Uncontrolled, so this instance renders its own trigger -- which is what sits on the
          heading rule. The controlled instance below, for editing an existing record, does not. */}
      <Section title="Service history" action={<LogServiceDialog jobs={maintenance.data ?? []} />}>
        {history.error ? (
          <ErrorState message={history.error.message} />
        ) : history.data ? (
          <ServiceHistory records={history.data} onEdit={setEditingRecord} />
        ) : (
          <ListSkeleton rows={5} />
        )}
      </Section>

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
