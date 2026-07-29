import type { Assessment } from '@caradvocate/shared';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/**
 * The list badge reflects the quote verdict, NOT completion.
 *
 * assessment-list-mobile.png shows Timing Belt Inspection badged ASSESSED while
 * also marked "Repair completed", so the two are independent.
 */
export function verdictBadge(assessment: Assessment): { label: string; variant: BadgeVariant } {
  if (!assessment.quote) return { label: 'Assessed', variant: 'outline' };
  return assessment.quote.verdict === 'fair'
    ? { label: 'Fair', variant: 'outline' }
    : { label: 'Overpriced', variant: 'default' };
}

/** The verdict badge on the detail screen uses the fuller wording from the wireframe. */
export function quoteVerdictBadge(assessment: Assessment): { label: string; variant: BadgeVariant } | undefined {
  if (!assessment.quote) return undefined;
  return assessment.quote.verdict === 'fair'
    ? { label: 'Fair price', variant: 'default' }
    : { label: 'Overpriced', variant: 'destructive' };
}

export function quoteStatusLabel(assessment: Assessment): string {
  return assessment.quote ? 'Quote Evaluated' : 'No Quote';
}

export function isCompleted(assessment: Assessment): boolean {
  return Boolean(assessment.completedAt);
}

/** Cost written to service history when a repair is marked complete. */
export function completionCost(assessment: Assessment): number {
  return assessment.quote?.amount ?? assessment.fairTotalLow;
}
