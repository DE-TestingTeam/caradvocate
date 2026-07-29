import { summary } from './assert.js';
import { run as runAuth } from './auth.test.js';
import { run as runConnection } from './connection.test.js';
import { run as runSchema } from './schema.test.js';
import { run as runApi } from './api.test.js';
import { run as runIsolation } from './isolation.test.js';
import { run as runOnboarding } from './onboarding.test.js';

await runConnection();
await runAuth();
await runSchema();
await runApi();
await runIsolation();
await runOnboarding();

const { total, failures } = summary();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures === 0 ? 0 : 1);
