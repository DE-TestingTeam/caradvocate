import { summary } from './assert.js';
import { goOffline } from './offline.js';
import { run as runAuth } from './auth.test.js';
import { run as runConnection } from './connection.test.js';
import { run as runSchema } from './schema.test.js';
import { run as runApi } from './api.test.js';
import { run as runIsolation } from './isolation.test.js';
import { run as runOnboarding } from './onboarding.test.js';
import { run as runRecalls } from './recalls.test.js';
import { run as runComplaints } from './complaints.test.js';
import { run as runSafetyRatings } from './safetyRatings.test.js';
import { run as runMaintenance } from './maintenance.test.js';
import { run as runAskCa } from './askca.test.js';

// No test reaches NHTSA unless it installs its own fetcher.
goOffline();

await runConnection();
await runAuth();
await runSchema();
await runApi();
await runIsolation();
await runOnboarding();
await runRecalls();
await runComplaints();
await runSafetyRatings();
await runMaintenance();
await runAskCa();

const { total, failures } = summary();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures === 0 ? 0 : 1);
