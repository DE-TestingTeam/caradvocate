/**
 * The Account screen's Subscription list, straight off the pricing sheet. Every free row is
 * `Included` for every owner -- nothing here varies per account except the three paid rows,
 * which move together with `users.plan` (see paywall.ts). That is why there is no per-owner
 * table behind this: ten rows that are either constant or a mirror of one boolean would just
 * be `plan` duplicated ten ways, with a manual step required to keep every copy in sync.
 *
 * The sheet also lists negotiation and an independent post-repair summary report. Neither is
 * built for this prototype, so both are left off this list on purpose -- not an oversight.
 */
import type { AccountFeature } from '@caradvocate/shared';

const FREE_FEATURES = [
  'Recall and maintenance tracker',
  'Pull car history and known issues',
  'AI triage, OBD translation',
  'Chat-based car Q&A',
  'Consolidated ownership view',
  'Car value tracking over time',
  'AI urgency triage and risk prognosis',
];

/** The paid tier, named as the pricing sheet names it. All three unlock together -- see paywall.ts. */
const PAID_FEATURES = ['Repair necessity check', 'OEM labor and time baseline', 'Benchmarking pricing for parts'];

/** The Subscription card's full list, in sheet order, for one owner's plan. */
export function featuresFor(plan: 'free' | 'paid'): AccountFeature[] {
  return [
    ...FREE_FEATURES.map((name) => ({ name, status: 'Included' as const })),
    ...PAID_FEATURES.map((name) => ({ name, status: plan === 'paid' ? ('Active' as const) : ('Locked' as const) })),
  ];
}
