import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRecallComponent } from '@/lib/format';
import { nhtsaVehicleUrl, type VehicleKey } from '@/lib/nhtsa';
import type { KnownIssue, KnownIssueReport, Severity } from '@caradvocate/shared';

const severityVariant: Record<Severity, 'destructive' | 'warning' | 'outline'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'outline',
};

/**
 * What tends to go wrong with this model. Two kinds of row:
 * ours are written for a reader; the rest are NHTSA complaints, which carry their counts instead
 * of being stated as faults, because an owner can weigh "31 reports, 3 involved a crash".
 *
 * The complaint text is not shown -- each runs to paragraphs, and hundreds would bury the list.
 * The NHTSA link has them in full.
 */
export function KnownIssuesList({ report, vehicle }: { report: KnownIssueReport; vehicle: VehicleKey }) {
  if (report.issues.length === 0) {
    return report.checked ? (
      <p className="py-2 text-sm text-muted-foreground">
        Nothing on file for this model, and no owner complaints reported to NHTSA.
      </p>
    ) : (
      <p className="py-2 text-sm text-muted-foreground">
        Nothing on file for this model yet. Owner complaints could not be loaded, so this is not a clean bill of health.
      </p>
    );
  }

  const reported = report.issues.some((issue) => issue.source === 'owner_reports');

  return (
    <>
      <ul className="space-y-2">
        {report.issues.map((issue) => (
          <li key={issue.id}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <span>{issue.source === 'owner_reports' ? formatRecallComponent(issue.label) : issue.label}</span>
                {issue.source === 'owner_reports' && <ReportDetail issue={issue} />}
              </div>
              <Badge variant={severityVariant[issue.severity]} className="shrink-0">
                {issue.severity}
              </Badge>
            </Card>
          </li>
        ))}
      </ul>

      {reported && (
        <p className="mt-3 text-xs text-muted-foreground">
          Report counts come from complaints owners filed with NHTSA for this year, make and model. They are first-hand
          accounts, not verified findings.{' '}
          <a
            href={nhtsaVehicleUrl(vehicle)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          >
            Read them on NHTSA
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </p>
      )}
    </>
  );
}

/** The numbers behind one row. Zero counts are left out rather than printed. */
function ReportDetail({ issue }: { issue: KnownIssue }) {
  const harms = [
    issue.deathCount ? `${issue.deathCount} involved a death` : undefined,
    issue.injuryCount ? `${issue.injuryCount} involved an injury` : undefined,
    issue.crashCount ? `${issue.crashCount} involved a crash` : undefined,
    issue.fireCount ? `${issue.fireCount} involved a fire` : undefined,
  ].filter(Boolean);

  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {issue.reportCount === 1 ? '1 owner report' : `${issue.reportCount} owner reports`}
      {harms.length > 0 && ` · ${harms.join(', ')}`}
      {issue.mileage && (
        <>
          {' · '}
          <span className="text-foreground">
            {issue.mileage.lowMi.toLocaleString('en-US')}–{issue.mileage.highMi.toLocaleString('en-US')} mi
          </span>
          {` in ${issue.mileage.sampleCount} of them`}
        </>
      )}
    </p>
  );
}
