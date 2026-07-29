import { createApp } from './app.js';
import { activeDriver, describeTarget, getDb } from './db/index.js';
import { env } from './env.js';

const app = createApp(getDb());

app.listen(env.PORT, () => {
  console.log(`CarAdvocate API listening on http://localhost:${env.PORT}`);
  console.log(`Database: ${describeTarget()}`);

  if (activeDriver() === 'pglite') {
    console.log('  (no DATABASE_URL set, so using the local PGlite dev database)');
  }

  console.log(`Acting as dev user: ${env.DEV_USER_EMAIL} (auth stub -- see src/middleware/currentUser.ts)`);
});
