import * as React from 'react';
import { AlertTriangle, HelpCircle, Info, CheckCircle2, Wrench, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ListSkeleton } from './ListSkeleton';
import {
  formatLongDate,
  formatMileage,
  formatNhtsaProse,
  formatRecallComponent,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  KnownIssue,
  KnownIssueReport,
  MaintenanceItem,
  MaintenanceReport,
  RecallReport,
} from '@caradvocate/shared';

/**
 * Everything that wants an ACTION from the owner, in one ranked list, each row carrying its own
 * next step.
 *
 * ONE ROW PER KIND OF THING, which is what keeps the list short. It used to run a row budget --
 * `ROW_BUDGET`, `allot()`, `rowsSpent()` -- handing individual slots to recalls, then to overdue
 * jobs, and folding whatever did not fit into a counted row. All of that arithmetic existed to
 * bound a list that grew a row per recall and per job. Grouping bounds it by construction
 * instead: there are seven kinds of row and most cars have two or three, so there is nothing
 * left to budget.
 *
 * The one thing that may never be folded into a group is a recall NHTSA says to stop driving
 * for. "One of these says park the car" is a different message from "you have three recalls",
 * and it must not be something you find by opening a group -- so it takes its own row, above
 * everything, in the only red on the page.
 *
 * TWO CHANNELS, TWO JOBS. The icon says WHAT KIND of thing a row is -- a triangle for a recall,
 * a wrench for upkeep, an "i" for a model watch. The tint says HOW URGENT it is. They used to be
 * the same channel: every row was a triangle and only the colour varied, which meant an overdue
 * cabin air filter (`alert`, red) rendered louder than an open safety recall (`caution`, amber).
 * The sort order put the recall on top and the colours said the opposite. Now:
 *
 *   red      NHTSA says stop driving this car. Nothing else, ever.
 *   amber    something is wrong, or something we should know is unknown -- an open recall,
 *            overdue upkeep, a feed that could not be reached, a missing VIN.
 *   neutral  a heads-up with nothing wrong yet -- upkeep coming due, a model watch.
 *
 * Same honesty rules as the lists this summarises: "we could not check" is a row, not an
 * omission, so an empty list only ever means the checks ran and came back clean. And a recall
 * nobody has answered "repaired?" for counts as open -- absent means unknown.
 */
export function AttentionList({
  recalls,
  maintenance,
  issues,
  recallsFailed,
  maintenanceFailed,
  issuesFailed,
  onSeeDetails,
}: {
  /** Undefined while in flight; the matching `*Failed` flag says the request died instead. */
  recalls: RecallReport | undefined;
  maintenance: MaintenanceReport | undefined;
  issues: KnownIssueReport | undefined;
  recallsFailed: boolean;
  maintenanceFailed: boolean;
  issuesFailed: boolean;
  /**
   * Take the owner to one of the full sections, by its `Section` id.
   *
   * This used to be a scroll performed here. It is the page's call now, because on My Car those
   * sections start collapsed -- a scroll to an element that is not mounted lands nowhere, so
   * whoever owns the disclosure has to open it first and scroll after the DOM has caught up.
   */
  onSeeDetails: (id: string) => void;
}) {
  const rows: Row[] = [];

  /* ------------------------------------------------------------------ recalls */

  // `repaired !== true`, as everywhere: an unanswered safety question is not a resolved one.
  const open = recalls ? recalls.recalls.filter((recall) => recall.repaired !== true) : [];
  const parkIt = open.filter((recall) => recall.parkIt);
  const ordinary = open.filter((recall) => !recall.parkIt);

  if (parkIt.length > 0) {
    rows.push({
      key: 'recalls-park-it',
      rank: RANK.parkIt,
      tone: 'alert',
      icon: AlertTriangle,
      title:
        parkIt.length === 1
          ? `Stop driving: ${formatRecallComponent(parkIt[0].component)}`
          : `${parkIt.length} recalls say stop driving this car`,
      body:
        parkIt.length === 1
          ? formatNhtsaProse(parkIt[0].consequence || parkIt[0].remedy)
          : listNames(parkIt.map((recall) => formatRecallComponent(recall.component))),
      action: seeDetails('recalls', onSeeDetails),
    });
  }

  if (ordinary.length > 0) {
    rows.push({
      key: 'recalls-open',
      rank: RANK.recall,
      tone: 'caution',
      icon: AlertTriangle,
      title:
        ordinary.length === 1
          ? `Open recall: ${formatRecallComponent(ordinary[0].component)}`
          : `${ordinary.length} open recalls for this model`,
      /*
       * One recall gets its consequence, because the consequence is the reason to act and there
       * is room for exactly one. A group gets the components instead -- there is no single
       * consequence to state, and inventing a shared one would be worse than naming them -- plus
       * the fact that carries the most weight per word in this whole app: the fix is free.
       */
      body:
        ordinary.length === 1
          ? formatNhtsaProse(ordinary[0].consequence || ordinary[0].remedy)
          : `${listNames(ordinary.map((recall) => formatRecallComponent(recall.component)))} · Every recall repair is free at a dealer.`,
      action: seeDetails('recalls', onSeeDetails),
    });
  }

  /* ------------------------------------------------------------------- upkeep */

  const overdue = maintenance?.items.filter((item) => item.status === 'overdue') ?? [];
  const dueSoon = maintenance?.items.filter((item) => item.status === 'due_soon') ?? [];

  if (overdue.length > 0) {
    rows.push({
      key: 'upkeep-overdue',
      rank: RANK.overdue,
      tone: 'caution',
      icon: Wrench,
      title:
        overdue.length === 1
          ? `${overdue[0].label} is overdue`
          : `${overdue.length} upkeep jobs are overdue`,
      body:
        overdue.length === 1
          ? jobBody(overdue[0])
          : listNames(overdue.map((item) => item.label)),
      action: checkPricing,
    });
  }

  if (dueSoon.length > 0) {
    // The nearest job is the only one whose number changes what the owner does this month;
    // the rest are a count. Neutral, not amber: nothing is wrong yet, and that is the point.
    const nearest = [...dueSoon].sort(
      (a, b) => (a.milesRemaining ?? Infinity) - (b.milesRemaining ?? Infinity),
    )[0];
    const others = dueSoon.length - 1;
    rows.push({
      key: 'upkeep-due-soon',
      rank: RANK.dueSoon,
      tone: 'info',
      icon: Wrench,
      title: `${nearest.label} is due soon`,
      body: [jobBody(nearest), others > 0 ? `${others} more due soon` : undefined]
        .filter(Boolean)
        .join(' · '),
      action: checkPricing,
    });
  }

  /* -------------------------------------------------------------- model watch */

  /*
   * Known issues are context rather than actions, which is why they were kept out of this list
   * for so long -- but "ask about it before you authorise the work" IS an action, and Ask CA is
   * the thing that can hold this model's complaint history against the owner's own car. So they
   * get one row, pointed there.
   *
   * ONLY WHEN SOMETHING IS WORTH WATCHING. A `low` top issue would put a row on this list for
   * every car with any complaint on file, which is close to every car. The full section behind
   * the disclosure carries those; a triage list should not.
   */
  // `high` before `medium` explicitly rather than taking the first match, because nothing
  // guarantees the report arrives severity-ordered and the one row this gets should be the
  // worst one. Ties keep the server's order.
  const watch =
    issues?.issues.find((issue) => issue.severity === 'high') ??
    issues?.issues.find((issue) => issue.severity === 'medium');
  if (watch && issues) {
    const others = issues.issues.length - 1;
    rows.push({
      key: 'model-watch',
      rank: RANK.watch,
      tone: 'info',
      icon: Info,
      title: `Model watch: ${issueLabel(watch)}`,
      body: [watchBody(watch), others > 0 ? `${others} more on file` : undefined]
        .filter(Boolean)
        .join(' · '),
      action: (
        <Link to={`/ask?q=${encodeURIComponent(watchQuestion(watch))}`} className="link-inline">
          Ask CA
        </Link>
      ),
    });
  }

  /* ------------------------------------------------------- gaps in what we know */

  if (maintenance?.status === 'no_vin') {
    // The one empty state the owner can clear themselves, so it earns a row with the fix.
    rows.push({
      key: 'maintenance-no-vin',
      rank: RANK.unknown,
      tone: 'caution',
      icon: HelpCircle,
      title: 'Upkeep needs your VIN',
      body: "We look this car's service schedule up by VIN, and this car does not have one on file.",
      action: (
        <Link to="/account#vehicle" className="link-inline">
          Add VIN
        </Link>
      ),
    });
  }

  /*
   * The feeds nobody could get an answer from, merged into one row when more than one failed --
   * three near-identical "couldn't check" rows crowd out the rows that carry real actions. The
   * per-feed wording ("model not listed" vs "unreachable") lives in the sections this points at.
   *
   * Amber, not neutral, even though nothing is known to be wrong. Neutral is for "nothing wrong
   * yet", and an unchecked safety feed has not earned that -- the whole reason this row exists
   * is that silence here must never read as an all-clear.
   */
  const unknowns: { name: string; target: string }[] = [];
  if (recallsFailed || (recalls && recalls.status !== 'ok')) {
    unknowns.push({ name: 'recalls', target: 'recalls' });
  }
  // `unreachable` joins the request failing, for the reason the recall and complaint feeds above
  // are tested on their status and not just their transport: a supplier that refuses every call
  // is as unchecked as one we never got a response from, and `no_vin` has its own row already.
  if (maintenanceFailed || maintenance?.status === 'unreachable') {
    unknowns.push({ name: 'upkeep', target: 'maintenance' });
  }
  if (issuesFailed || (issues && issues.status !== 'ok')) {
    unknowns.push({ name: 'owner complaints', target: 'issues' });
  }
  if (unknowns.length > 0) {
    rows.push({
      key: 'unknowns',
      rank: RANK.unknown,
      tone: 'caution',
      icon: HelpCircle,
      title: `Couldn't check ${listNames(
        unknowns.map((u) => u.name),
        unknowns.length,
      )}`,
      body: 'Not an all-clear — the full lists say what to do in the meantime.',
      action: seeDetails(unknowns[0].target, onSeeDetails),
    });
  }

  /* -------------------------------------------------------------------- render */

  // Ranked by what it is, not by how loud its row looks -- though the two now agree, which they
  // did not when an overdue filter was red and an open recall was amber.
  rows.sort((a, b) => a.rank - b.rank);

  const stillLoading =
    (!recalls && !recallsFailed) || (!maintenance && !maintenanceFailed) || (!issues && !issuesFailed);

  if (rows.length === 0) {
    if (stillLoading) return <ListSkeleton rows={2} />;
    // Only reachable when every check ran and answered: a failed or inconclusive feed would
    // have contributed a "couldn't check" row above, so this line never over-claims.
    return (
      <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Nothing needs attention right now.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => (
          <AttentionRow key={row.key} row={row} />
        ))}
      </ul>
      {/* A feed still in flight may yet add rows; say so rather than looking finished. */}
      {stillLoading && <ListSkeleton rows={1} />}
    </div>
  );
}

type Tone = 'alert' | 'caution' | 'info';

/** The list's order of urgency. Smaller sorts first. */
const RANK = {
  parkIt: 0,
  recall: 1,
  overdue: 2,
  dueSoon: 3,
  watch: 4,
  unknown: 5,
} as const;

interface Row {
  key: string;
  rank: number;
  tone: Tone;
  /** What kind of thing this is. Always set -- the icon is a channel of its own now. */
  icon: LucideIcon;
  title: string;
  body?: string;
  action: React.ReactNode;
}

/**
 * Tints rather than fills, for the reason the Badge variants give: saturated colour repeated
 * down a list shouts until none of it registers. `warning-strong` for the amber icon because
 * the fill amber all but disappears at icon size -- see RecallsList.
 */
const TONE: Record<Tone, { iconClass: string; bg: string }> = {
  alert: { iconClass: 'text-destructive', bg: 'bg-destructive/5' },
  caution: { iconClass: 'text-warning-strong', bg: 'bg-warning/10' },
  info: { iconClass: 'text-muted-foreground', bg: 'bg-muted/50' },
};

function AttentionRow({ row }: { row: Row }) {
  const tone = TONE[row.tone];
  const Icon = row.icon;

  return (
    <li className={cn('flex items-start gap-3 rounded-lg p-4', tone.bg)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{row.title}</div>
        {/* Clamped: NHTSA consequence text runs to paragraphs, and this list is a triage view.
            The full prose is one "See details" away. */}
        {row.body && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{row.body}</p>}
      </div>
      <div className="shrink-0 text-sm">{row.action}</div>
    </li>
  );
}

/** Every upkeep row's action is the same: find out what the job should cost before saying yes. */
const checkPricing = (
  <Link to="/assessments/new" className="link-inline">
    Check pricing
  </Link>
);

function seeDetails(target: string, onSeeDetails: (id: string) => void) {
  return (
    <button type="button" className="link-inline" onClick={() => onSeeDetails(target)}>
      See details
    </button>
  );
}

/** "Cabin air filter, oil & filter change and 2 more" -- the first two names, then a count. */
function listNames(names: string[], showFirst = 2): string {
  const shown = names.slice(0, showFirst);
  const rest = names.length - shown.length;
  const joined = shown.join(shown.length > 1 && rest === 0 ? ' and ' : ', ');
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

/** The row's working, reusing the same vocabulary as MaintenanceList's `Working`. */
function jobBody(item: MaintenanceItem): string | undefined {
  const parts: string[] = [];

  if (item.milesRemaining !== undefined && item.dueAtMileage !== undefined) {
    parts.push(
      item.milesRemaining < 0
        ? `${formatMileage(Math.abs(item.milesRemaining))} past due`
        : `${formatMileage(item.milesRemaining)} to go`,
    );
    parts.push(`due at ${item.dueAtMileage.toLocaleString('en-US')}`);
  } else if (item.dueOn) {
    parts.push(`due ${formatLongDate(item.dueOn)}`);
  }
  if (item.lastServicedMileage !== undefined) {
    parts.push(`last done at ${item.lastServicedMileage.toLocaleString('en-US')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * What is actually known about a watched issue, and nothing more.
 *
 * Owner reports carry their counts, because "31 owners reported this" is something a reader can
 * weigh, where "this is a common problem" is a judgement NHTSA's complaint feed cannot support --
 * the same rule KnownIssuesList follows. A curated entry has no counts and gets no body: it is
 * ours, its label already says what it is, and padding it with a sentence that says nothing is
 * how a row starts sounding more certain than its source.
 */
function watchBody(issue: KnownIssue): string | undefined {
  if (issue.source !== 'owner_reports') return undefined;

  const parts: string[] = [];
  if (issue.reportCount !== undefined) {
    parts.push(`${issue.reportCount} owner ${issue.reportCount === 1 ? 'report' : 'reports'} to NHTSA`);
  }
  // The percentile range, not the extremes -- see MileageAtFailure. Withheld upstream when too
  // few complaints carried an odometer reading, so its presence is itself the sample gate.
  if (issue.mileage) {
    parts.push(`most often around ${formatMileage(issue.mileage.medianMi)}`);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Owner-report labels arrive as NHTSA component caps; curated labels are already prose. */
function issueLabel(issue: KnownIssue): string {
  return issue.source === 'owner_reports' ? formatRecallComponent(issue.label) : issue.label;
}

/**
 * The question this row hands to Ask CA, carried in `?q=` and dropped into the composer.
 *
 * IT IS NEVER SENT FOR THE OWNER -- same rule the Repair Cost Checker's `?repair=` follows: an
 * initial value, fully editable, waiting on the send button. Asking a question on someone's
 * behalf and showing them the answer would make the first thing they read a reply to something
 * they did not write, and this one costs a model call besides.
 *
 * IT ONLY HAS TO NAME THE TOPIC, not carry the evidence. The API assembles the facts block
 * itself -- NHTSA complaints for this model grouped by component, with counts, harms and up to
 * two owners' own words -- so the counts already reach the model whether or not they are in the
 * question. Stuffing them in here would just be our own screen quoted back at us, and the
 * prompt forbids treating a complaint as fact regardless of who says it.
 *
 * The label is QUOTED because it is a category name, not prose. NHTSA components arrive as
 * paths -- "Fuel System, Gasoline · Delivery · Fuel Pump" -- and unquoted in a sentence those
 * separators read as a stutter. In quotes they read as the label they are.
 */
function watchQuestion(issue: KnownIssue): string {
  return `Owners of this model report problems with "${issueLabel(issue)}". What should I know about this for my car?`;
}
