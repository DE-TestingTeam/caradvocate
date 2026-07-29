/**
 * Turns a verified Supabase identity into a local profile row.
 *
 * Provisioning happens on first authenticated request rather than via a signup
 * webhook, so there is no window where someone holds a valid session but has no
 * profile, and no webhook to go down.
 *
 * Three cases, in order:
 *   1. Already linked      -> return it
 *   2. Same email, unlinked -> adopt it (so the seeded demo account, or a profile
 *                              created before auth existed, keeps its data)
 *   3. Nothing             -> create the profile and its default features
 */
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { userFeatures, users } from '../db/schema.js';
import type { VerifiedIdentity } from './verifyToken.js';

export interface ProfileRef {
  id: string;
  email: string;
}

/** The subscription rows the Account screen renders. */
const DEFAULT_FEATURES = [
  { name: 'My Car', status: 'Included' as const, position: 0 },
  { name: 'Ask CA', status: 'Included' as const, position: 1 },
  { name: 'Repair Cost Checker', status: 'Active' as const, position: 2 },
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

  // New account. Profile and features are written together so the Account screen
  // can never render a user with no subscription rows.
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
        plan: 'paid',
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
