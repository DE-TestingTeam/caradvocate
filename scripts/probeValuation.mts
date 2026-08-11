/**
 * Prices every car on file through BOTH valuation vendors and prints them side by side.
 *
 *   npm run probe:valuation
 *
 * WHAT IT IS FOR. The app calls one vendor per car -- Vehicle Databases, falling back to
 * MarketCheck -- so in normal running the two are never compared. This asks both about the same
 * car in the same minute, which is the only way to see whether they agree.
 *
 * READ THE TRIM COLUMN FIRST, BEFORE THE MONEY. Every disagreement measured so far has been a
 * disagreement about what the car IS, not what it is worth: on a 2012 Camaro the two decoded a
 * 1SS and a 1LT, roughly $16k against $9k, and each figure was right for the car its vendor
 * believed it had. Both were reading a VIN whose middle digits were invented. **Two prices for
 * two different trims tell you nothing about either vendor.** Only rows where the trims agree are
 * evidence, which is why they are printed side by side rather than the prices alone.
 *
 * READ ONLY -- selects vehicles and calls the vendors; writes nothing, so it cannot mark a car
 * unvaluable or advance any freshness marker.
 *
 * COSTS ONE CALL TO EACH VENDOR PER CAR. Run it deliberately, not routinely.
 */
import { closeDb, getDb } from '../apps/api/src/db/index.js';
import { vehicles } from '../apps/api/src/db/schema.js';
import { fetchMarketValue } from '../apps/api/src/services/marketCheck.js';
import { fetchVehicleValuation } from '../apps/api/src/services/vehicleMarketValue.js';
import { stateForZip } from '../apps/api/src/lib/zipState.js';

const db = getDb();
const fleet = await db.select().from(vehicles);
await closeDb();

const priceable = fleet.filter((vehicle) => vehicle.vin && vehicle.zip);
console.log(`${priceable.length} of ${fleet.length} cars have the VIN and ZIP both vendors need.\n`);

for (const vehicle of priceable) {
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  console.log(`${name} · ${vehicle.mileage.toLocaleString()} mi · ${vehicle.zip} (${stateForZip(vehicle.zip) ?? 'state unknown'})`);

  /*
   * ONE AT A TIME, deliberately, though the two vendors are independent and could overlap.
   *
   * Vehicle Databases sells a credits-per-SECOND limit -- one on the entry plan -- and the first
   * run of this script fired both calls for seven cars as fast as they would go. A 2004 Passat
   * came back `no_record` there and priced normally through the same client minutes later, which
   * is what a throttled request looks like once it has been read as an answer about the car. A
   * probe that manufactures its own false negatives is worse than no probe.
   */
  const vdb = await fetchVehicleValuation({ vin: vehicle.vin!, mileage: vehicle.mileage, zip: vehicle.zip });
  const mc = await fetchMarketValue({ vin: vehicle.vin!, miles: vehicle.mileage, zip: vehicle.zip! });

  if (vdb.outcome === 'ok') {
    const v = vdb.valuation;
    console.log(`   Vehicle Databases  private ${usd(v.privateParty)}  retail ${usd(v.dealerRetail)}  trade-in ${usd(v.tradeInLow)}-${usd(v.tradeInHigh)}`);
    console.log(`                      priced as: ${v.trim ?? '(no trim reported)'}`);
  } else {
    console.log(`   Vehicle Databases  ${vdb.outcome}`);
  }

  console.log(
    mc.outcome === 'ok'
      ? `   MarketCheck        ${usd(mc.price)}`
      : `   MarketCheck        ${mc.outcome}`,
  );

  if (vdb.outcome === 'ok' && mc.outcome === 'ok') {
    const gap = Math.abs(vdb.valuation.dealerRetail - mc.price);
    const pct = Math.round((gap / mc.price) * 100);
    console.log(`   -> retail vs MarketCheck: ${usd(gap)} apart (${pct}%). Check the trims agree before reading anything into that.`);
  }
  console.log();
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
