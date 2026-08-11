/**
 * Proves the Vehicle Databases circuit breaker is armed by a refusal and then swallows every
 * further call without touching the network.
 *
 *   npx tsx --env-file-if-exists=.env scripts/probeVendorBreaker.mts
 *
 * COSTS ONE VENDOR CALL, and only one -- which is the whole claim being tested. Run it when the
 * breaker's logic changes, not routinely.
 *
 * WHY IT IS WORTH A SCRIPT. The breaker is invisible when it works: the caller sees `unavailable`
 * whether the vendor refused, timed out, or was never asked, which is correct and also means a
 * broken breaker looks exactly like a working one from every screen in the app. The only
 * observable difference is whether a request left the machine, so that is what this measures --
 * a real call takes hundreds of milliseconds, a short-circuited one takes none.
 *
 * READS NOTHING AND WRITES NOTHING. No database, no owner data; it calls the vendor client
 * directly with a nonsense path, because what is being tested is the gate in front of the call
 * rather than anything about a vehicle.
 */
import { requestVehicleDatabases, vehicleDatabasesIsRefusing } from '../apps/api/src/services/vehicleDatabases.js';
import { env } from '../apps/api/src/env.js';

/** Anything the vendor will answer. The path does not matter -- the gate is in front of it. */
const PATH = '/vehicle-repairs/v2/2019/HONDA/CIVIC';

/** Above this, a call plainly went out over the network. Real ones measured at 300-900ms. */
const NETWORK_MS = 50;

if (!env.VEHICLEDATABASES_API_KEY) {
  console.log('VEHICLEDATABASES_API_KEY is not set, so every call short-circuits for a different');
  console.log('reason and this proves nothing. Set the key and re-run.');
  process.exit(0);
}

console.log(`Refusing before we start? ${vehicleDatabasesIsRefusing()}\n`);

const timings: number[] = [];
for (let attempt = 1; attempt <= 4; attempt += 1) {
  const startedAt = Date.now();
  const result = await requestVehicleDatabases(PATH);
  const ms = Date.now() - startedAt;
  timings.push(ms);
  console.log(
    `call ${attempt}: ${String(ms).padStart(4)}ms  ->  ${result.outcome.padEnd(11)} ` +
      `${ms > NETWORK_MS ? '(went to the vendor)' : '(short-circuited)'}`,
  );
}

const [first, ...rest] = timings;
const refusing = vehicleDatabasesIsRefusing();

console.log(`\nRefusing now? ${refusing}`);

if (!refusing) {
  // Not a failure of the breaker. A vendor answering normally has nothing to trip it, and the
  // timings above will show four real calls -- which is the correct behaviour on a healthy key.
  console.log('\nThe vendor did not refuse, so there was nothing for the breaker to catch.');
  console.log('That is the healthy case. Re-run this when the allowance is spent to see it work.');
  process.exit(0);
}

const wentOut = rest.filter((ms) => ms > NETWORK_MS).length;
console.log(
  wentOut === 0
    ? `\nPASS: one call reached the vendor (${first}ms), the other ${rest.length} never left the machine.`
    : `\nFAIL: ${wentOut} call(s) after the refusal still went to the vendor. The breaker is not holding.`,
);
if (wentOut > 0) process.exitCode = 1;
