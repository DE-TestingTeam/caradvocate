import express, { type Express } from 'express';
import { attachDb } from './middleware/attachDb.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireUser, type UserResolver } from './middleware/currentUser.js';
import { defaultResolver } from './auth/resolvers.js';
import { publicAuthConfig } from './auth/config.js';
import { accountRouter } from './routes/account.js';
import { assessmentsRouter } from './routes/assessments.js';
import { chatRouter } from './routes/chat.js';
import { repairsRouter } from './routes/repairs.js';
import { serviceRecordsRouter } from './routes/serviceRecords.js';
import { vehicleRouter } from './routes/vehicle.js';
import type { Database } from './db/index.js';

/**
 * Builds the Express app against an injected database, so tests can hand it a
 * PGlite instance and the dev server can hand it a real pool.
 */
export interface AppOptions {
  /**
   * How to identify the caller. Defaults to the dev stub in
   * middleware/currentUser.ts; tests inject a specific user, and real session
   * verification will be passed in here.
   */
  resolveUser?: UserResolver;
}

export function createApp(db: Database, options: AppOptions = {}): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(attachDb(db));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Tells the browser how to sign in -- or that it need not, in dev mode. Both
   * values are public by design. Unauthenticated on purpose: the client has to
   * read it before it can authenticate.
   */
  app.get('/api/auth/config', (_req, res) => {
    res.json(publicAuthConfig());
  });

  // Everything below this line requires an authenticated user. Mounting the
  // middleware once here means a new router cannot forget it.
  app.use('/api', requireUser(options.resolveUser ?? defaultResolver()));

  app.use('/api/vehicle', vehicleRouter);
  app.use('/api/service-records', serviceRecordsRouter);
  app.use('/api/assessments', assessmentsRouter);
  app.use('/api/repairs', repairsRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/account', accountRouter);

  app.use(notFoundHandler);
  app.use(errorHandler());

  return app;
}
