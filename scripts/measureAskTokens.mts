/**
 * Measures the real Ask CA prompt against the tokenizer of the model we actually call, so
 * the cost model's assumed input sizes can be re-based from evidence rather than drifting as
 * the system prompt and feeds change.
 *
 * READ ONLY -- selects vehicles and their feeds, writes nothing. Safe against the shared
 * database. Counting uses the token-counting endpoint, which is free and runs no inference.
 *
 *   npx tsx --env-file-if-exists=.env scripts/measureAskTokens.mts
 *
 * Needs ANTHROPIC_API_KEY, and a reachable DATABASE_URL for the per-car half. The
 * cached-prefix figure it prints first needs no database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { desc } from 'drizzle-orm';
import { closeDb, getDb, describeTarget } from '../apps/api/src/db/index.js';
import { vehicles } from '../apps/api/src/db/schema.js';
import { buildVehicleContext } from '../apps/api/src/services/vehicleContext.js';

/** Keep in step with askClaude.ts. Named here so a model change is a one-line edit. */
const MODEL = 'claude-sonnet-5';

/** How many real cars to measure. Enough to show spread without a long run. */
const SAMPLE = 5;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * SYSTEM_PROMPT is module-private in askClaude.ts and should stay that way. Reading the
 * literal out of the source keeps the measurement honest without widening that API.
 */
function readSystemPrompt(): string {
  const src = readFileSync(join(here, '../apps/api/src/services/askClaude.ts'), 'utf8');
  const match = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!match) throw new Error('could not find SYSTEM_PROMPT in askClaude.ts');
  return match[1];
}

/** Strips the crash-test block, so the cost of carrying it is a measured delta. */
function withoutSafety(context: string): string {
  return context
    .split('\n\n')
    .filter((block) => !block.startsWith('CRASH TEST RATINGS'))
    .join('\n\n');
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required (token counting is free, but authenticated)');
  }

  const systemPrompt = readSystemPrompt();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /** Mirrors the message shape askClaude.ts sends, so the count matches production. */
  const count = async (context: string): Promise<number> => {
    const response = await anthropic.messages.countTokens({
      model: MODEL,
      system: [{ type: 'text', text: systemPrompt }],
      messages: [
        // Keep in step with the preamble in askClaude.ts, or the measurement drifts from the
        // prompt it claims to measure.
        {
          role: 'user',
          content: `Reference material: the facts about my car. This is background, not a question — do not reply to it.\n\n${context}`,
        },
        { role: 'assistant', content: 'Understood. I will answer using only those facts.' },
        { role: 'user', content: 'Is this repair actually necessary?' },
      ],
    });
    return response.input_tokens;
  };

  const db = getDb();
  console.log(`model: ${MODEL}`);
  console.log(`database: ${describeTarget()}\n`);

  const systemOnly = await count('');
  console.log(`system prompt + envelope: ${systemOnly} tokens (the cached prefix)\n`);

  const rows = await db.select().from(vehicles).orderBy(desc(vehicles.createdAt)).limit(SAMPLE);
  if (rows.length === 0) {
    console.log('No vehicles in the database, so there is nothing to measure.');
    return;
  }

  const totals: number[] = [];
  const deltas: number[] = [];

  for (const vehicle of rows) {
    const context = await buildVehicleContext(db, vehicle);
    const trimmedContext = withoutSafety(context);
    const [full, trimmed] = await Promise.all([count(context), count(trimmedContext)]);

    totals.push(trimmed);
    deltas.push(full - trimmed);

    console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`  total, with crash tests:    ${full}`);
    console.log(`  total, without crash tests: ${trimmed}`);
    console.log(`  per-car facts (uncached):   ${trimmed - systemOnly}`);
    console.log(`  crash-test block:           ${full - trimmed}\n`);
  }

  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log('---');
  console.log(`cars measured:                 ${rows.length}`);
  console.log(`mean input, crash tests gone:  ${mean(totals)} tokens`);
  console.log(`  of which cached prefix:      ${systemOnly}`);
  console.log(`  of which per-car (uncached): ${mean(totals) - systemOnly}`);
  console.log(`mean saving from removal:      ${mean(deltas)} tokens`);
  console.log(`reused share for the model:    ${(systemOnly / mean(totals)).toFixed(2)}`);
}

try {
  await main();
} finally {
  await closeDb();
}
