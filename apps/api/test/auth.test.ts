/**
 * Token verification and profile provisioning.
 *
 * Supabase cannot be reached from CI, so these tests generate their own RSA
 * keypair, sign tokens with it, and point verification at a local key set. That
 * exercises the real jose verification path -- signature, expiry, audience,
 * issuer and claim handling -- without depending on a live project.
 *
 * What it does NOT prove: that Supabase's tokens carry the claims we expect.
 * Confirm that once against a real project by signing in and decoding the token.
 */
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK, type KeyLike } from 'jose';
import { eq } from 'drizzle-orm';
import { setAuthConfigForTesting } from '../src/auth/config.js';
import { supabaseResolver } from '../src/auth/resolvers.js';
import { setJwksForTesting } from '../src/auth/verifyToken.js';
import { users } from '../src/db/schema.js';
import { createTestDb } from './harness.js';
import { check, section } from './assert.js';
import type { Database } from '../src/db/index.js';
import type { Request } from 'express';

const ISSUER = 'https://demoproject.supabase.co/auth/v1';
// Supabase subjects are UUIDs, and the users.supabase_user_id column is typed so.
const ALEX_SUB = '3f1c9a52-5b7e-4c31-9a2f-6d8e10b4c7a1';
const CASEY_SUB = 'c0a80121-7ac0-4f9d-8b3e-2f5a91d6e408';
const AUDIENCE = 'authenticated';

export async function run(): Promise<void> {
  section('auth: token verification');

  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  setJwksForTesting(createLocalJWKSet({ keys: [jwk] }));

  // env is parsed at import time, so configure through the documented test seam.
  setAuthConfigForTesting({ supabaseUrl: 'https://demoproject.supabase.co' });

  const { db, close } = await createTestDb();

  const sign = async (claims: Record<string, unknown>, options: { expired?: boolean; key?: KeyLike } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt(options.expired ? now - 7200 : now)
      .setExpirationTime(options.expired ? now - 3600 : now + 3600)
      .sign(options.key ?? privateKey);
  };

  const resolve = (token?: string) =>
    supabaseResolver({
      headers: token ? { authorization: `Bearer ${token}` } : {},
      db: db as unknown as Database,
    } as unknown as Request);

  const expectRejected = async (name: string, token?: string) => {
    try {
      await resolve(token);
      check(name, false, 'it was accepted');
    } catch {
      check(name, true);
    }
  };

  /* ---------------------------------------------------------- happy path */

  const valid = await sign({ sub: ALEX_SUB, email: 'alex.rivera@email.com', iss: ISSUER, aud: AUDIENCE });
  const user = await resolve(valid);
  check('a valid token authenticates', Boolean(user?.id));
  check('it resolves to the seeded profile for that email', user.email === 'alex.rivera@email.com');

  /* --------------------------------------------------------- rejections */

  await expectRejected('a missing Authorization header is rejected', undefined);
  await expectRejected('a malformed token is rejected', 'not-a-jwt');

  await expectRejected(
    'an expired token is rejected',
    await sign({ sub: ALEX_SUB, email: 'alex.rivera@email.com', iss: ISSUER, aud: AUDIENCE }, { expired: true }),
  );

  const otherKey = await generateKeyPair('RS256');
  await expectRejected(
    'a token signed with the wrong key is rejected',
    await sign({ sub: ALEX_SUB, email: 'alex.rivera@email.com', iss: ISSUER, aud: AUDIENCE }, { key: otherKey.privateKey }),
  );

  await expectRejected(
    'a token from a different Supabase project is rejected',
    await sign({ sub: ALEX_SUB, email: 'alex.rivera@email.com', iss: 'https://someoneelse.supabase.co/auth/v1', aud: AUDIENCE }),
  );

  await expectRejected(
    'an anon token (wrong audience) is rejected',
    await sign({ sub: ALEX_SUB, email: 'alex.rivera@email.com', iss: ISSUER, aud: 'anon' }),
  );

  await expectRejected(
    'a token with no subject is rejected',
    await sign({ email: 'alex.rivera@email.com', iss: ISSUER, aud: AUDIENCE }),
  );

  await expectRejected(
    'a token with no email is rejected',
    await sign({ sub: CASEY_SUB, iss: ISSUER, aud: AUDIENCE }),
  );

  await expectRejected(
    'a subject that is not a UUID is rejected cleanly, not as a database error',
    await sign({ sub: 'not-a-uuid', email: 'x@example.com', iss: ISSUER, aud: AUDIENCE }),
  );

  /* ------------------------------------------------------- provisioning */

  section('auth: profile provisioning');

  const before = await db.select().from(users);

  // Same identity again: must reuse the row, not create a second one.
  await resolve(valid);
  const afterRepeat = await db.select().from(users);
  check('signing in twice does not duplicate the profile', afterRepeat.length === before.length);

  const [linked] = await db.select().from(users).where(eq(users.email, 'alex.rivera@email.com'));
  check('the seeded profile was adopted by matching email', linked.supabaseUserId === ALEX_SUB);

  // A brand new identity.
  const newcomer = await sign({ sub: CASEY_SUB, email: 'Casey.Nguyen@Example.com', iss: ISSUER, aud: AUDIENCE });
  const created = await resolve(newcomer);
  check('an unknown identity gets a new profile', created.id !== linked.id);
  check('the email is stored lower-cased', created.email === 'casey.nguyen@example.com');

  const [caseyRow] = await db.select().from(users).where(eq(users.id, created.id));
  check('the new profile is linked to its Supabase id', caseyRow.supabaseUserId === CASEY_SUB);
  check('a display name is derived from the email', caseyRow.name === 'Casey Nguyen', `got ${caseyRow.name}`);

  const caseyFeatures = await db.query.userFeatures.findMany({
    where: (row, { eq: equals }) => equals(row.userId, created.id),
  });
  check('default subscription features are created', caseyFeatures.length === 3, `got ${caseyFeatures.length}`);

  // A new user has no car: the app must route them to onboarding, not 500.
  const caseyVehicles = await db.query.vehicles.findMany({
    where: (row, { eq: equals }) => equals(row.userId, created.id),
  });
  check('a new profile starts with no vehicle', caseyVehicles.length === 0);

  await close();
  setJwksForTesting(undefined);
  setAuthConfigForTesting({});
}
