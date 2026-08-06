/**
 * Turns a verified Supabase identity into a local profile row, on first authenticated request
 * rather than via a signup webhook -- so there is no window where someone holds a valid
 * session but no profile, and no webhook to go down.
 *
 * Three cases, in order: already linked, return it; same email but unlinked, adopt it (so a
 * seeded or pre-auth profile keeps its data); nothing, create it and its default features.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { userFeatures, users } from '../db/schema.js';
import { PAID_FEATURE } from '../services/paywall.js';
import type { VerifiedIdentity } from './verifyToken.js';

export interface ProfileRef {
  id: string;
  email: string;
}

/**
 * The subscription rows the Account screen renders. The Repair Cost Checker starts `Locked`
 * -- a new account is behind the paywall until they tap through, and services/paywall.ts
 * flips this row when they do.
 */
const DEFAULT_FEATURES = [
  { name: 'My Car', status: 'Included' as const, position: 0 },
  { name: 'Ask CA', status: 'Included' as const, position: 1 },
  { name: PAID_FEATURE, status: 'Locked' as const, position: 2 },
];

export async function provisionUser(db: Database, identity: VerifiedIdentity): Promise<ProfileRef> {
  const linked = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.supabaseUserId, identity.supabaseUserId))
    .limit(1);

  if (linked.length > 0) return linked[0];

  const byEmail = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1);

  if (byEmail.length > 0) {
    await db
      .update(users)
      .set({ supabaseUserId: identity.supabaseUserId })
      .where(eq(users.id, byEmail[0].id));
    return byEmail[0];
  }

  // Profile and features written together, so Account can never render a user with no
  // subscription rows.
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        supabaseUserId: identity.supabaseUserId,
        email: identity.email,
        // Supabase does not collect a name at signup; the user sets it on Account.
        name: defaultNameFor(identity.email),
        phone: '',
        memberSince: new Date().toISOString().slice(0, 10),
        // Every real signup starts behind the paywall -- this is the cohort the prototype
        // measures, so it must not be pre-unlocked.
        plan: 'free',
      })
      .returning({ id: users.id, email: users.email });

    await tx.insert(userFeatures).values(
      DEFAULT_FEATURES.map((feature) => ({ ...feature, userId: created.id })),
    );

    return created;
  });
}

/** "alex.rivera@email.com" -> "Alex Rivera", as a starting point they can edit. */
function defaultNameFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(' ') || 'New driver';
}
