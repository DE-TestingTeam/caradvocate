import { InfoPopover } from '@/components/InfoPopover';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatMileage } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MaintenanceReport, RecallReport, Vehicle } from '@caradvocate/shared';

/**
 * The dashboard's headline numbers: odometer, value, open recalls, distance to the next
 * service. Four figures an owner can take in before reading a single list.
 *
 * Plain numbers, not links -- the "What needs attention" list right below is where the same
 * facts become actionable, and a stat that is also a button invites a tap that goes nowhere
 * useful. Only the estimated value carries an InfoPopover: it is the one figure on the strip
 * the app produced rather than the owner or a label-stated source, so it is the one that
 * invites "says who?". The odometer is the owner's own reading, and the recall and service
 * labels already state their working -- an "i" on all four was icon soup.
 *
 * The same honesty rules as AtAGlance, which this strip (plus the attention list) replaces:
 * a feed that could not be checked shows an em dash and says "couldn't check", never a zero --
 * a zero here is a claim about the car, and an unreachable database cannot make it.
 */
export function StatStrip({
  vehicle,
  recalls,
  maintenance,
}: {
  vehicle: Vehicle;
  /** Undefined while the request is in flight OR after it failed; both show a placeholder. */
  recalls: RecallReport | undefined;
  maintenance: MaintenanceReport | undefined;
}) {
  return (
    <section aria-label="Your car at a glance" className="grid grid-cols-2 gap-6 border-y py-5 lg:grid-cols-4">
      <Stat value={vehicle.mileage.toLocaleString('en-US')} label="Miles on the odometer" />
      <ValueStat vehicle={vehicle} className="border-l pl-6" infoAlign="end" />
      {/* Third stat starts the second row on phones, so it only draws a divider from `lg`. */}
      <RecallStat report={recalls} className="lg:border-l lg:pl-6" />
      <ServiceStat report={maintenance} className="border-l pl-6" />
    </section>
  );
}

function Stat({
  value,
  unit,
  label,
  info,
  infoAlign = 'start',
  tone,
  loading,
  className,
}: {
  value?: string;
  /**
   * A trailing unit set apart from the figure -- "27,500" then "mi".
   *
   * It is a separate span rather than part of `value` because `tabular-nums` applies to the
   * space character too, and a monospaced space between a number and its unit rendered as a
   * visible gap: "27,500  mi". Set apart it is also easier to read, the figure carrying the
   * size and the unit staying out of its way.
   */
  unit?: string;
  label: string;
  /** The "says who?" answer behind an "i" beside the label. Omitted when there is nothing to
      explain beyond what the label already states. */
  info?: string;
  /** `end` for stats against the right edge, so the panel opens inward. */
  infoAlign?: 'start' | 'end';
  /** Colour for the figure itself; only the open-recall count ever sets it. */
  tone?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        /*
         * The tone sits on an inner span, NOT merged into the outer class list. `cn` runs
         * tailwind-merge, and to its default config `text-h2` (a custom size) and
         * `text-destructive` (a custom colour) are both unknown `text-*` tokens -- it files
         * them in one conflict group and drops the size whenever a tone is present, which is
         * how the open-recall count rendered at body size next to full-size neighbours.
         */
        <div className="truncate text-h2 font-bold tabular-nums">
          {tone ? <span className={tone}>{value}</span> : value}
          {unit && <span className="ml-1 text-body font-medium text-muted-foreground">{unit}</span>}
        </div>
      )}
      {/*
        The label WRAPS rather than truncating. It used to be `truncate`, which clipped the one
        label on the strip carrying a fact the owner could act on -- "OPEN RECALLS — FREE F…".
        A stat label is two or three words and the grid stretches all four cells to a common
        height, so a second line costs the row a few pixels and costs nothing else; a clipped
        one costs the sentence. `items-start` keeps the "i" beside the first line of a label
        that took two.
      */}
      <div className="mt-1 flex items-start gap-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        {info && (
          <InfoPopover label={`About ${label.toLowerCase()}`} align={infoAlign}>
            {info}
          </InfoPopover>
        )}
      </div>
    </div>
  );
}

function ValueStat({
  vehicle,
  className,
  infoAlign,
}: {
  vehicle: Vehicle;
  className?: string;
  infoAlign?: 'start' | 'end';
}) {
  if (vehicle.estMarketValue === undefined) {
    // The ValueCard in the sidebar explains WHY there is no figure; the stat just shows there
    // isn't one. A price invented to fill this box would be the worst thing on the page.
    return <Stat value="—" label="Estimated value" className={className} />;
  }

  const change = trendChange(vehicle);
  return (
    <Stat
      value={formatCurrency(vehicle.estMarketValue)}
      label={change ? `Est. value · ${change}` : 'Estimated value'}
      info={`A dealer-market estimate for this car, priced off the ${formatMileage(vehicle.mileage)} on file. We re-check it about once a month and chart each reading in Value over time.`}
      infoAlign={infoAlign}
      className={className}
    />
  );
}

/**
 * "−3.3% / 5 mo" from the monthly value readings, or nothing before there are two to compare.
 * The window is however many readings exist, and the label says so -- a car three readings in
 * gets "/ 2 mo", not a pretend six-month figure.
 */
function trendChange(vehicle: Vehicle): string | undefined {
  const trend = vehicle.valueTrend;
  if (trend.length < 2) return undefined;

  const first = trend[0].value;
  const last = trend[trend.length - 1].value;
  if (first <= 0) return undefined;

  const pct = ((last - first) / first) * 100;
  const months = trend.length - 1;
  // A real minus sign, not a hyphen: this is arithmetic, and it sits next to currency.
  const sign = pct < 0 ? '−' : '+';
  return `${sign}${Math.abs(pct).toFixed(1)}% / ${months} mo`;
}

function RecallStat({ report, className }: { report: RecallReport | undefined; className?: string }) {
  if (!report) return <Stat loading label="Open recalls" className={className} />;

  // `repaired !== true`, as everywhere: an unanswered safety question is not a resolved one.
  const open = report.recalls.filter((recall) => recall.repaired !== true).length;
  if (open > 0) {
    return (
      <Stat
        value={String(open)}
        // "Free fix" is a fact about recalls, not this one: the remedy is free at a dealer by law.
        label={open === 1 ? 'Open recall — free fix' : 'Open recalls — free fix'}
        tone="text-destructive"
        className={className}
      />
    );
  }
  if (report.recalls.length > 0 || report.status === 'ok') {
    return <Stat value="0" label="Open recalls" className={className} />;
  }
  return <Stat value="—" label="Recalls — couldn't check" className={className} />;
}

function ServiceStat({ report, className }: { report: MaintenanceReport | undefined; className?: string }) {
  if (!report) return <Stat loading label="Until next service" className={className} />;

  // The job due soonest. `milesRemaining` and `dueAtMileage` arrive together (see
  // MaintenanceItem), so a candidate here always has a mileage to name.
  const next = report.items
    .filter((item) => item.milesRemaining !== undefined)
    .sort((a, b) => a.milesRemaining! - b.milesRemaining!)[0];

  if (!next) return <Stat value="—" label="Next service — not tracked" className={className} />;

  const miles = next.milesRemaining!;
  if (miles < 0) {
    return (
      <Stat
        value={Math.abs(miles).toLocaleString('en-US')}
        unit="mi"
        label={`past due — ${next.label}`}
        tone="text-destructive"
        className={className}
      />
    );
  }
  return (
    <Stat
      value={miles.toLocaleString('en-US')}
      unit="mi"
      label={
        next.dueAtMileage !== undefined
          ? `until ${next.dueAtMileage.toLocaleString('en-US')}-mi service`
          : 'until next service'
      }
      className={className}
    />
  );
}
