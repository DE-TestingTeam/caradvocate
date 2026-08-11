import * as React from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';
import { AttentionList } from '@/components/my-car/AttentionList';
import { KnownIssuesList } from '@/components/my-car/KnownIssuesList';
import { ListSkeleton } from '@/components/my-car/ListSkeleton';
import { LogServiceDialog } from '@/components/my-car/LogServiceDialog';
import { MaintenanceItemDialog } from '@/components/my-car/MaintenanceItemDialog';
import { MaintenanceList } from '@/components/my-car/MaintenanceList';
import { MileageCheck } from '@/components/my-car/MileageCheck';
import { RecallsList } from '@/components/my-car/RecallsList';
import { Section } from '@/components/my-car/Section';
import { ServiceHistory } from '@/components/my-car/ServiceHistory';
import { StatStrip } from '@/components/my-car/StatStrip';
import { UpdateMileageDialog } from '@/components/my-car/UpdateMileageDialog';
import { ValueCard } from '@/components/my-car/ValueCard';
import { VehicleImage } from '@/components/my-car/VehicleImage';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

/**
 * The car page as a dashboard: identity and headline numbers on top, then a two-column body --
 * what needs doing and what has been done on the left, what the car is worth and the repair
 * check on the right. The full recall / maintenance / known-issue sections keep their honest
 * states and controls, now behind one disclosure at the foot of the page.
 *
 * WHY ANYTHING FOLDS. Recalls, upkeep and known issues each appeared THREE times on this
 * screen: as a figure in the stat strip, as a row in the attention list, and as a full section
 * below. Known issues managed four, having a sidebar card as well. Three renderings of one fact
 * is not depth, it is the same answer arriving in three voices.
 *
 * So the top of the page has two layers -- the strip says HOW MANY, the attention list says
 * WHAT TO DO -- and one layer opened on request that says everything.
 *
 * WHAT FOLDS AND WHAT DOES NOT, and the line is the kind of thing rather than the length.
 * Recalls and known issues are MODEL-level facts from NHTSA: true of every car like this one,
 * episodic, read when something prompts you. They fold, together, under one control, because
 * "show me what NHTSA says" is a single decision. Scheduled maintenance is THIS car's schedule
 * against THIS odometer -- it changes every month, the owner can edit it, and it is the other
 * half of the Service history beside it -- so it stays on the page.
 *
 * WHAT THE FOLD MUST NOT COST. The full sections are where the honest empty states live -- "not
 * listed by NHTSA", "we could not reach the feed", the VIN caveat on an old model. None of that
 * is hidden by this: a feed that could not be checked still puts its own row in the attention
 * list above, which is what the fold's contents would have told them anyway. What is behind the
 * fold is detail, never the difference between "clean" and "unknown".
 */
/**
 * Section ids that live inside the disclosure, so a scroll to one has to reveal it first.
 * `maintenance` is deliberately absent -- it sits on the page now.
 */
const FOLDED_SECTIONS = new Set(['car-details', 'recalls', 'issues']);

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

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  /** A section id waiting to be scrolled to, once the disclosure holding it has mounted. */
  const [pendingScroll, setPendingScroll] = React.useState<string>();

  /**
   * "See details" in the attention list, and "See all" on its heading.
   *
   * Only a target inside the disclosure needs it opened -- since upkeep moved onto the page,
   * `maintenance` is already mounted and forcing the fold open to reach it would reveal two
   * unrelated sections as a side effect of asking for a third. Opening and scrolling still
   * cannot happen in one go for the ones that do need it: the target does not exist in the DOM
   * until the disclosure has rendered, so the id is parked here and the effect below scrolls on
   * the next commit, by which time it does.
   */
  function handleSeeDetails(id: string) {
    if (FOLDED_SECTIONS.has(id)) setDetailsOpen(true);
    setPendingScroll(id);
  }

  React.useEffect(() => {
    if (pendingScroll === undefined) return;
    // Still waiting on the reveal; this same effect runs again when `detailsOpen` flips.
    if (FOLDED_SECTIONS.has(pendingScroll) && !detailsOpen) return;

    document.getElementById(pendingScroll)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    setPendingScroll(undefined);
  }, [detailsOpen, pendingScroll]);

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
      {/* The masthead: identity on the left, the odometer control on the right -- it sits up
          here because every number below prices or schedules off that one reading. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-5">
          {/*
            The car, back at thumbnail size after losing its half-page slot in the dashboard
            restyle. `w-44` puts its 3:2 height level with the three-line title block beside
            it; phones keep the photo at `w-28`, with the no-photo placeholder dropping its
            caption (`compact`) because the smaller frame cannot fit the words.
          */}
          <div className="w-28 shrink-0 sm:w-44">
            <VehicleImage vehicle={vehicle} compact />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">My car</p>
            {/* The one h1 on the page. Short name -- no trim -- for the reasons on
                vehicleShortName: the decoded trim is not reliably a trim. */}
            <h1 className="mt-1 text-h1 font-bold">{vehicleShortName(vehicle)}</h1>
            <p className="mt-2 text-body text-muted-foreground">
              {formatMileage(vehicle.mileage)}
              {/* No VIN is a normal state for a car added without one. */}
              {vehicle.vin && ` · VIN: ${maskVin(vehicle.vin)}`}
            </p>
          </div>
        </div>
        <UpdateMileageDialog vehicle={vehicle} />
      </header>

      <StatStrip vehicle={vehicle} recalls={recalls.data} maintenance={maintenance.data} />

      {/* Still here alongside the header button: the button waits to be wanted, this asks when
          the reading has actually gone stale. Renders nothing at all when it is fresh. */}
      <MileageCheck vehicle={vehicle} />

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-10 lg:col-span-2">
          {/* The disclosure's control lives on this heading rule, not at the foot of the page
              where it started. This list is what summarises the NHTSA sections, so this is where
              an owner forms the intent to see them -- and "See all" beside the summary reads as
              "there is more of this", which a button several sections further down does not. It
              opens and scrolls in one go; closing does not scroll them back up. */}
          <Section
            title="What needs attention"
            action={
              <button
                type="button"
                onClick={() =>
                  detailsOpen ? setDetailsOpen(false) : handleSeeDetails('car-details')
                }
                aria-expanded={detailsOpen}
                aria-controls="car-details"
                // Muted, not the mockup's green: the house colour means identity and location
                // in this app, never "this is a link" -- see button.tsx. `link-inline` inherits
                // colour and hovers to foreground, so muted is the whole difference needed.
                className="link-inline text-sm text-muted-foreground"
              >
                {detailsOpen ? 'Hide all' : 'See all'}
              </button>
            }
          >
            <AttentionList
              recalls={recalls.data}
              maintenance={maintenance.data}
              issues={issues.data}
              recallsFailed={recalls.error !== undefined}
              maintenanceFailed={maintenance.error !== undefined}
              issuesFailed={issues.error !== undefined}
              onSeeDetails={handleSeeDetails}
            />
          </Section>

          {/*
            Upkeep sits on the page, not behind the disclosure with recalls and known issues,
            because it is not the same kind of thing as either. Those two are model-level facts
            from NHTSA -- true of every car like this one, episodic, read when something prompts
            you. This is THIS car's schedule, computed against THIS odometer, changing every
            month, and the only one of the three the owner can edit. It is also the other half
            of the Service history below it: what is coming and what has been done are one
            conversation, and separating them by a fold split it.

            Plan above record, and both below the triage list -- the column runs down by how
            actionable each block is.

            No "Add an upkeep job" action. This list is the manufacturer's schedule for this car,
            fetched by VIN -- not a to-do list someone builds by hand -- and a control to add rows
            to it invited the owner to fill a gap that is ours to fill. The empty states say which
            kind of empty each car is in; see MaintenanceList. Editing an existing job stays,
            since adjusting an interval is a judgement about a real row rather than an invented one.
          */}
          <Section id="maintenance" title="Scheduled maintenance">
            {maintenance.error ? (
              <ErrorState message={maintenance.error.message} />
            ) : maintenance.data ? (
              <MaintenanceList report={maintenance.data} onEdit={setEditingJob} />
            ) : (
              <ListSkeleton rows={4} />
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
              <ListSkeleton rows={4} />
            )}
          </Section>
        </div>

        {/*
          STICKY, so the rail follows the long column instead of running out under it. The left
          column is three sections deep and this one is two cards; below "Scheduled maintenance"
          a third of the page was permanently blank.

          What that space was costing is not decoration: "Check a repair cost" is the page's one
          route into the paid feature, and it used to scroll away exactly when an owner reached
          the upkeep list -- which is where the intent to price a job actually forms. Now it is
          on screen for the whole of it.

          `self-start` is load-bearing. Grid items stretch to the row height by default, which
          leaves a sticky child no room to move inside its own box; sizing this column to its
          content is what gives `sticky` somewhere to travel.
        */}
        <div className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start">
          {/* The product's core loop, pitched where an owner deciding about a quote is already
              looking. The one green panel on the page, on the BRAND token at the same tint the
              active nav row wears (`bg-brand/10`, see SideNav.rowClass) -- so the promo reads
              as the house colour, not a new green.

              ABOVE THE VALUATION, not below it. Both cards are sticky and both stay on screen,
              so this is about which one an eye entering the rail lands on first: the action, or
              a number the owner did not come here to act on. */}
          <Card className="border-brand/20 bg-brand/10">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div>
                <h2 className="font-semibold">Got a repair quote?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check it against fair pricing before you say yes.
                </p>
              </div>
              <Button asChild className="bg-brand text-primary-foreground hover:bg-brand/90">
                <Link to="/assessments/new">Check a repair cost</Link>
              </Button>
            </CardContent>
          </Card>

          <ValueCard vehicle={vehicle} />

          {/* The Known Issues digest that used to sit here is gone. It listed the same issues,
              with the same severity badges, as the full section further down the SAME page --
              a summary of something already on screen, which is a duplicate rather than a
              digest. What the model is worth watching for now gets one row in the attention
              list, pointed at Ask CA, and the full list is behind "See all". */}
        </div>
      </div>

      {/*
        WHAT IS LEFT BEHIND THE FOLD IS ONE COHERENT THING: what NHTSA knows about this model.
        Recalls and owner complaints are both model-level, both episodic, and neither is about
        this particular car -- which is why upkeep moved out to the column above and these two
        did not. The disclosure is no longer a grab bag of "the long sections".

        Unmounted while closed rather than hidden with CSS. Between them these two render every
        recall's consequence and remedy and every complaint group, and leaving that in the
        accessibility tree and the scroll height while nobody is looking at it is most of what
        the fold is for. The requests still run on mount, so opening is instant and the stat
        strip and attention list above have their numbers either way.
      */}
      {detailsOpen && (
        // `scroll-mt-6` for the same reason `Section` carries it: "See all" scrolls to this
        // wrapper, and without it the first heading lands flush against the top edge.
        <div id="car-details" className="scroll-mt-6 space-y-10">
          {/*
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
          <Section id="recalls" title="Recalls for this model">
            {recalls.error ? (
              <ErrorState message={recalls.error.message} />
            ) : recalls.data ? (
              <RecallsList
                report={recalls.data}
                vin={vehicle.vin}
                year={vehicle.year}
                onStatusChange={handleRecallStatus}
              />
            ) : (
              <ListSkeleton rows={2} />
            )}
          </Section>

          <Section id="issues" title="Known issues for your model">
            {issues.error ? (
              <ErrorState message={issues.error.message} />
            ) : issues.data ? (
              <KnownIssuesList report={issues.data} vehicle={vehicle} />
            ) : (
              <ListSkeleton rows={3} />
            )}
          </Section>
        </div>
      )}

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
