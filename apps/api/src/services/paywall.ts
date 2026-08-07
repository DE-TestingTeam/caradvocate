/**
 * The v1 paywall, which takes no money. Tapping unlock charges nothing and opens the feature
 * immediately -- the tap itself is the data, which is what lets the prototype measure
 * willingness to pay without building billing or handling card data.
 *
 * Two offers are shown side by side rather than one -- an Unlimited subscription and a
 * cheaper Per-Incident subscription with a separate per-lookup fee for the parts benchmark --
 * because which shape of pricing people prefer is itself part of what this prototype is
 * testing. The per-incident fee is disclosed but not metered: nothing in v1 charges per use,
 * so picking either offer opens all three paid features the same way. Metering is the natural
 * next step once the model that wins is known.
 *
 * This file is the experiment rather than the product, with two consequences: the recorded
 * price and model travel with the tap (see paywallIntents), since reading them from config at
 * analysis time would re-label every historical row the first time either changed; and the
 * gate has to be real, enforced on the server (middleware/requirePaid.ts) and not only in the
 * client, or some owners get the feature without deciding to.
 *
 * Not a licence check: no expiry, no receipt, nothing to verify, because nothing was sold.
 * Unlocking is one-way and permanent.
 */
import { eq } from 'drizzle-orm';
import type { PaywallStatus, PricingModel, PricingOffer } from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import { paywallIntents, users } from '../db/schema.js';
import { env } from '../env.js';

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

/** Both offers as shown, independent of any particular owner. */
function offers(): PricingOffer[] {
  return [
    {
      model: 'all_you_can_eat',
      priceCents: env.PAYWALL_ALL_YOU_CAN_EAT_PRICE_CENTS,
      currency: 'USD',
      interval: env.PAYWALL_ALL_YOU_CAN_EAT_INTERVAL,
    },
    {
      model: 'per_incident',
      priceCents: env.PAYWALL_PER_INCIDENT_PRICE_CENTS,
      currency: 'USD',
      interval: env.PAYWALL_PER_INCIDENT_INTERVAL,
      perIncidentFeeCents: env.PAYWALL_PER_INCIDENT_FEE_CENTS,
    },
  ];
}

/** Both offers as one line, for the startup banner. */
export function describePrice(): string {
  return offers()
    .map((o) => {
      const base = `${(o.priceCents / 100).toFixed(2)} ${o.currency} / ${o.interval}`;
      const fee = o.perIncidentFeeCents ? ` + ${(o.perIncidentFeeCents / 100).toFixed(2)} ${o.currency}/incident` : '';
      return `${o.model}: ${base}${fee}`;
    })
    .join(', ');
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
  const [row] = await db
    .select({ plan: users.plan, pricingModel: users.pricingModel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    unlocked: row?.plan === 'paid',
    pricingModel: row?.pricingModel ?? undefined,
    offers: offers(),
    includes: INCLUDES,
  };
}

/**
 * Records the tap and opens the feature. The intent row is written whether or not the owner
 * was already unlocked, because a second tap at a different offer is a finding rather than a
 * duplicate. `users.pricingModel` moves with `plan` so the Account screen's "which plan are
 * you on" answer never has to be re-derived from intent history.
 *
 * Returns the resulting status, so the client renders from the server's answer.
 */
export async function recordUnlock(
  db: Database,
  userId: string,
  source: IntentSource,
  model: PricingModel,
): Promise<PaywallStatus> {
  const chosen = offers().find((o) => o.model === model);
  if (!chosen) throw new Error(`Unknown pricing model: ${model}`);

  await db.transaction(async (tx) => {
    await tx.insert(paywallIntents).values({
      userId,
      pricingModel: model,
      priceCents: chosen.priceCents,
      interval: chosen.interval,
      source,
    });

    await tx.update(users).set({ plan: 'paid', pricingModel: model }).where(eq(users.id, userId));
  });

  return { unlocked: true, pricingModel: model, offers: offers(), includes: INCLUDES };
}
