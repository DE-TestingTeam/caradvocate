import express, { type Express } from 'express';
import { attachDb } from './middleware/attachDb.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireUser, type UserResolver } from './middleware/currentUser.js';
import { requirePaid } from './middleware/requirePaid.js';
import { defaultResolver } from './auth/resolvers.js';
import { publicAuthConfig } from './auth/config.js';
import { accountRouter } from './routes/account.js';
import { assessmentsRouter } from './routes/assessments.js';
import { chatRouter } from './routes/chat.js';
import { paywallRouter } from './routes/paywall.js';
import { repairsRouter } from './routes/repairs.js';
import { serviceRecordsRouter } from './routes/serviceRecords.js';
import { vehicleRouter } from './routes/vehicle.js';
import type { Database } from './db/index.js';

export interface AppOptions {
  /**
   * How to identify the caller. Defaults to the resolver in auth/resolvers.ts; tests inject a
   * specific user.
   */
  resolveUser?: UserResolver;
}

/**
 * Builds the Express app around an injected database, so tests can supply their own.
 *
 * Mount order is load-bearing: `express.json` and `attachDb` come first, then the two
 * unauthenticated endpoints, then `requireUser` for everything under /api, and the error handlers
 * last. Adding a route above the `requireUser` line silently exposes it.
 */
export function createApp(db: Database, options: AppOptions = {}): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(attachDb(db));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Which Supabase project the browser should sign in against. Unauthenticated on purpose: the
  // client has to read this before it can authenticate.
  app.get('/api/auth/config', (_req, res) => {
    res.json(publicAuthConfig());
  });

  // Everything below requires an authenticated user. Mounted once here so a new router cannot
  // forget it.
  app.use('/api', requireUser(options.resolveUser ?? defaultResolver()));

  app.use('/api/vehicle', vehicleRouter);
  app.use('/api/service-records', serviceRecordsRouter);
  app.use('/api/paywall', paywallRouter);
  // The one paid surface in v1. See middleware/requirePaid.ts.
  app.use('/api/assessments', requirePaid, assessmentsRouter);
  app.use('/api/repairs', repairsRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/account', accountRouter);

  app.use(notFoundHandler);
  app.use(errorHandler());

  return app;
}
