/**
 * The v1 paywall, which takes no money. Tapping unlock charges nothing and opens the feature
 * immediately -- the tap itself is the data, which is what lets the prototype measure
 * willingness to pay without building billing or handling card data.
 *
 * This file is the experiment rather than the product, with two consequences: the recorded
 * price travels with the tap (see paywallIntents), since reading it from config at analysis
 * time would re-label every historical row the first time the price changed; and the gate
 * has to be real, enforced on the server (middleware/requirePaid.ts) and not only in the
 * client, or some owners get the feature without deciding to.
 *
 * Not a licence check: no expiry, no receipt, nothing to verify, because nothing was sold.
 * Unlocking is one-way and permanent.
 */
import { and, eq } from 'drizzle-orm';
import type { PaywallStatus } from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import { paywallIntents, userFeatures, users } from '../db/schema.js';
import { env } from '../env.js';

/**
 * The paid feature, named as the spec names it. One string, because v1 has exactly one paid
 * surface, and the Account screen's per-feature row has to agree with the gate.
 */
export const PAID_FEATURE = 'Repair Cost Checker';

/**
 * What unlocking opens, in the order the paywall lists them. Worded as the owner's benefit
 * rather than as feature names -- this is the copy on the screen where someone is deciding
 * whether it is worth money.
 */
const INCLUDES = [
  'Whether a recommended repair is actually necessary',
  'Fair price range for the parts, and the markup on your quote',
  'Standard labour time and rate for the job',
];

/** Where an unlock was tapped from. Recorded so conversion can be read by entry point. */
export type IntentSource = 'repair_cost_checker' | 'account';

/** The offer as shown, independent of any particular owner. */
function offer(): Omit<PaywallStatus, 'unlocked'> {
  return {
    priceCents: env.PAYWALL_PRICE_CENTS,
    currency: 'USD',
    interval: env.PAYWALL_INTERVAL,
    includes: INCLUDES,
  };
}

/** The offer as one line, for the startup banner. */
export function describePrice(): string {
  const { priceCents, currency, interval } = offer();
  return `${(priceCents / 100).toFixed(2)} ${currency} / ${interval}`;
}

/** Whether this owner is past the paywall. */
export async function isUnlocked(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.plan === 'paid';
}

/** The paywall as this owner would see it. */
export async function paywallStatusFor(db: Database, userId: string): Promise<PaywallStatus> {
  return { unlocked: await isUnlocked(db, userId), ...offer() };
}

/**
 * Records the tap and opens the feature. The intent row is written whether or not the owner
 * was already unlocked, because a second tap at a different price is a finding rather than a
 * duplicate. The plan and the Account feature row move together so the two cannot disagree.
 *
 * Returns the resulting status, so the client renders from the server's answer.
 */
export async function recordUnlock(
  db: Database,
  userId: string,
  source: IntentSource,
): Promise<PaywallStatus> {
  const shown = offer();

  await db.transaction(async (tx) => {
    await tx.insert(paywallIntents).values({
      userId,
      priceCents: shown.priceCents,
      interval: shown.interval,
      source,
    });

    await tx.update(users).set({ plan: 'paid' }).where(eq(users.id, userId));

    // Only the paid row: a stale 'Locked' would tell the owner the feature is shut while the
    // gate lets them through, but widening this would relabel 'My Car' and 'Ask CA', which
    // are 'Included' and were never gated.
    await tx
      .update(userFeatures)
      .set({ status: 'Active' })
      .where(and(eq(userFeatures.userId, userId), eq(userFeatures.name, PAID_FEATURE)));
  });

  return { unlocked: true, ...shown };
}
