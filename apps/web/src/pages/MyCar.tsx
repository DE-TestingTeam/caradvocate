import * as React from 'react';
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
import { formatMileage, maskVin, vehicleShortName } from '@/lib/format';
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

        {/*
          `lg:aspect-[3/2]` is what makes this column end level with the photo, and it is exact
          rather than tuned. Both columns are the same width -- one `grid-cols-2`, one gap -- and
          the photo's frame is `aspect-[3/2]` of that width, so the same ratio on this column
          resolves to the same pixel height at every window size.

          It replaced a hardcoded height on the trend plot, which could not work: the photo's
          height moves with the window while the card's does not, so any single number was right
          at one width and wrong at every other.

          The card takes `flex-1` and the plot inside it takes the slack, so the column absorbs
          the difference in the one place that has height to spare.
        */}
        <div className="flex min-w-0 flex-col gap-4 lg:aspect-[3/2]">
          <div>
            {/* The one h1 on the page. Everything below is a signpost within it. */}
            {/* Short name: year, make, model and nothing else. The trim is still on the Account
                page, where it is one field among several rather than the car's title. */}
            <h1 className="text-h2 font-bold">{vehicleShortName(vehicle)}</h1>
            <p className="mt-2 text-body text-muted-foreground">
              {formatMileage(vehicle.mileage)}
              {/* No VIN is a normal state for a car added without one. */}
              {vehicle.vin && ` · VIN: ${maskVin(vehicle.vin)}`}
            </p>
          </div>

          <ValueCard vehicle={vehicle} className="lg:min-h-0 lg:flex-1" />
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

      {/*
        No "Add an upkeep job" action. This list is the manufacturer's schedule for this car,
        fetched by VIN -- not a to-do list someone builds by hand -- and a control to add rows to
        it invited the owner to fill a gap that is ours to fill. The empty states below say which
        kind of empty each car is in; see MaintenanceList. Editing an existing job stays, since
        adjusting an interval is a judgement about a real row rather than an invented one.
      */}
      <Section title="Scheduled maintenance">
        {maintenance.error ? (
          <ErrorState message={maintenance.error.message} />
        ) : maintenance.data ? (
          <MaintenanceList report={maintenance.data} onEdit={setEditingJob} />
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
      <Section title="Service history" action={<LogServiceDialog jobs={maintenance.data?.items ?? []} />}>
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
      <MaintenanceItemDialog
        key={editingJob?.id}
        item={editingJob}
        open={editingJob !== undefined}
        onOpenChange={(open) => !open && setEditingJob(undefined)}
      />
      <LogServiceDialog
        key={editingRecord?.id}
        jobs={maintenance.data?.items ?? []}
        record={editingRecord}
        open={editingRecord !== undefined}
        onOpenChange={(open) => !open && setEditingRecord(undefined)}
      />
    </div>
  );
}
