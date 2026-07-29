/** Boots the app on an ephemeral port against a PGlite database. */
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/lib/httpError.js';
import { users } from '../src/db/schema.js';
import { createTestDb, type TestDb } from './harness.js';
import type { Database } from '../src/db/index.js';

export interface TestServer {
  db: TestDb;
  /** Issues a request as the given user, defaulting to alex.rivera@email.com. */
  request: (
    method: string,
    path: string,
    options?: { body?: unknown; as?: string },
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const { db, close: closeDb } = await createTestDb();

  // Each request may act as a different user; the app reads it from this holder.
  let actingEmail = 'alex.rivera@email.com';

  const app = createApp(db as unknown as Database, {
    resolveUser: async (req) => {
      const [row] = await req.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, actingEmail))
        .limit(1);
      // Mirrors what real session verification does with an unknown subject.
      if (!row) throw HttpError.unauthenticated(`No such user: ${actingEmail}`);
      return row;
    },
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  const base = `http://127.0.0.1:${address.port}`;

  async function request(method: string, path: string, options: { body?: unknown; as?: string } = {}) {
    actingEmail = options.as ?? 'alex.rivera@email.com';

    const response = await fetch(`${base}${path}`, {
      method,
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    db,
    request,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await closeDb();
    },
  };
}
