import { summary } from './assert.js';
import { run as runConnection } from './connection.test.js';
import { run as runSchema } from './schema.test.js';
import { run as runApi } from './api.test.js';
import { run as runIsolation } from './isolation.test.js';

await runConnection();
await runSchema();
await runApi();
await runIsolation();

const { total, failures } = summary();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures === 0 ? 0 : 1);
