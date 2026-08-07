import * as React from 'react';
import { Plus } from 'lucide-react';
import { ErrorState } from '@/components/ErrorState';
import { Section } from '@/components/my-car/Section';
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

/**
 * Where the numbers on this page came from, and what they are not.
 *
 * A financial product would carry a regulator and a coverage limit here. Nothing like that
 * applies to a car app, and borrowing the language would be worse than saying nothing -- but the
 * principle underneath it does transfer: name your sources, and state the limits of what you are
 * telling someone, in the place they are reading it rather than in a terms page.
 *
 * Quiet on purpose -- `text-label` in secondary grey, below the fold of everything actionable.
 * Quiet is not the same as hidden: it is on the page, in the owner's reading order, and it says
 * the unflattering part out loud.
 */
function ProvenanceNote() {
  return (
    <footer className="border-t pt-6 text-label leading-relaxed text-muted-foreground">
      <p>
        Recall data comes from the US National Highway Traffic Safety Administration. Known issues
        are drawn from owner complaints filed with NHTSA for this year, make and model. Maintenance
        intervals are the ones you entered, measured against your own service history.
      </p>
      <p className="mt-2">
        This is information to argue with a shop using, not a diagnosis. It is not a substitute for
        an inspection by a qualified mechanic.
      </p>
    </footer>
  );
}

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

      {/* Recalls come from NHTSA and stand on their own; maintenance is the owner's own
          schedule. Separate sections, so a safety recall is never read as one more chore. */}
      <Section title="Safety recalls">
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

      <ProvenanceNote />

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
