/**
 * Vercel serverless entry for the API.
 *
 * Wraps the same `createApp` the long-running server uses, so routes, auth, paywall gating and
 * error handling are identical here and under `npm run dev`. There is no second copy of the
 * mount order to keep in sync -- see apps/api/src/app.ts, where that order is load-bearing.
 *
 * Deliberately does NOT reproduce apps/api/src/index.ts's boot sequence. That file's
 * `assertAuthConfigured` / `assertSchemaPresent` checks call `process.exit(1)` on failure, which
 * is right for a server you are watching start and wrong here: in a function it aborts the one
 * invocation, and `assertSchemaPresent` would add a database round trip to every cold start to
 * re-answer a question that does not change between deploys. Misconfiguration surfaces instead
 * as the first request's error.
 *
 * `.mjs` rather than `.ts` or `.js` on purpose: the root package.json has no `"type": "module"`,
 * so a root-level `.js` would be treated as CommonJS and could not `import` the ESM output in
 * apps/api/dist. The extension is what makes this file ESM regardless of the package type.
 */
import { createApp } from '../apps/api/dist/app.js';
import { getDb } from '../apps/api/dist/db/index.js';

// Module scope, so a warm instance reuses one pool across invocations rather than opening a
// fresh one per request. A missing DATABASE_URL throws here, at cold start, with the message
// getDb() already writes for that case.
const app = createApp(getDb());

export default app;
