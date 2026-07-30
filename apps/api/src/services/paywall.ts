/**
 * The v1 paywall, which takes no money.
 *
 * Paid features sit behind a price. Tapping unlock charges nothing and opens the
 * feature immediately -- the tap itself is the data. That is the spec's design, and
 * it is what lets the prototype measure willingness to pay at a price point without
 * building billing, handling card data, or taking on the obligations of charging
 * someone for numbers that are still placeholders.
 *
 * ====================== THIS IS A MEASUREMENT INSTRUMENT =====================
 * Everything else in this app is the product. This file is the experiment. Two
 * consequences worth holding on to:
 *
 *   - The recorded price travels with the tap (see paywallIntents). Reading the
 *     price from config at analysis time would silently re-label every historical
 *     row the first time the price changed.
 *   - The gate has to be real. If a free owner can reach the paid pages another
 *     way, the taps stop being a measure of anything -- some people got the
 *     feature without deciding to. Hence enforcement on the server (see
 *     middleware/requirePaid.ts), not only in the client.
 * =============================================================================
 *
 * What it deliberately is NOT: a licence check. There is no expiry, no receipt and
 * nothing to verify, because nothing was sold. Unlocking is one-way and permanent.
 */
import { and, eq } from 'drizzle-orm';
import type { PaywallStatus } from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import { paywallIntents, userFeatures, users } from '../db/schema.js';
import { env } from '../env.js';

/**
 * The paid feature, named as the spec names it. One string, because v1 has exactly
 * one paid surface -- the Repair Cost Checker page -- and the Account screen shows a
 * row per feature that has to agree with the gate.
 */
export const PAID_FEATURE = 'Repair Cost Checker';

/**
 * What unlocking opens, in the order the paywall lists them.
 *
 * The spec's three paid capabilities. Worded as the owner's benefit rather than as
 * the feature names, because this is the copy on the one screen where someone is
 * deciding whether it is worth money.
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
 * Records the tap and opens the feature.
 *
 * The intent row is written whether or not the owner was already unlocked, because
 * a second tap at a different price is a finding rather than a duplicate. The plan
 * and the Account feature row move together so the two can never disagree about
 * whether someone is past the gate.
 *
 * Returns the resulting status, so the client renders from the server's answer
 * rather than assuming the write worked.
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

    // Only the paid row. The Account screen reads these, so a stale 'Locked' would
    // tell the owner the feature is shut while the gate is letting them through --
    // but widening this to every row would relabel 'My Car' and 'Ask CA', which are
    // 'Included' and were never gated.
    await tx
      .update(userFeatures)
      .set({ status: 'Active' })
      .where(and(eq(userFeatures.userId, userId), eq(userFeatures.name, PAID_FEATURE)));
  });

  return { unlocked: true, ...shown };
}
