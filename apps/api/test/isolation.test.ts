/**
 * Tenant isolation.
 *
 * This is the suite that justifies the schema design. Every user-owned table
 * carries userId and every query filters on it; these tests assert that a route
 * which forgot to would be caught. Dana's rows are seeded specifically so Alex
 * can be caught reaching for them.
 */
import { eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { check, section } from './assert.js';
import { startTestServer } from './server.js';

const DANA = 'dana@example.com';

export async function run(): Promise<void> {
  section('tenant isolation');
  const { db, request, close } = await startTestServer();

  /* --------------------------- each user sees only their own aggregate roots */

  const alexVehicle = await request('GET', '/api/vehicle');
  const danaVehicle = await request('GET', '/api/vehicle', { as: DANA });
  check('Alex gets the Civic', alexVehicle.body.model === 'Civic');
  check('Dana gets the RAV4', danaVehicle.body.model === 'RAV4', `got ${danaVehicle.body.model}`);
  check('the two users get different vehicle ids', alexVehicle.body.id !== danaVehicle.body.id);

  const alexHistory = await request('GET', '/api/service-records');
  const danaHistory = await request('GET', '/api/service-records', { as: DANA });
  check('Alex sees 6 service records', alexHistory.body.length === 6, `got ${alexHistory.body.length}`);
  check('Dana sees only her 1 record', danaHistory.body.length === 1, `got ${danaHistory.body.length}`);
  check(
    "Dana's record never appears in Alex's history",
    !alexHistory.body.some((r: any) => r.description.includes('Dana private')),
  );

  // Chat needs no isolation test: conversations are never stored, so there is no row
  // that could be read by the wrong account. Removing the table removed the risk
  // rather than mitigating it -- see apps/api/src/routes/chat.ts.
  const chatHistory = await request('GET', '/api/chat');
  check('no stored conversation exists to be read across accounts', chatHistory.status === 404, `got ${chatHistory.status}`);

  const alexAccount = await request('GET', '/api/account');
  const danaAccount = await request('GET', '/api/account', { as: DANA });
  check('each user gets their own profile', alexAccount.body.email !== danaAccount.body.email);
  check('Dana sees her own name', danaAccount.body.name === 'Dana Whitfield');

  /* -------------------- cross-tenant reads by id return 404, never the row */

  const [danaAssessment] = await db
    .select()
    .from(t.assessments)
    .where(eq(t.assessments.repairName, 'Dana private brake job'));
  check("Dana's assessment exists in the database", Boolean(danaAssessment));

  const stolenRead = await request('GET', `/api/assessments/${danaAssessment.id}`);
  check(
    "Alex reading Dana's assessment by id gets 404",
    stolenRead.status === 404,
    `got ${stolenRead.status}`,
  );
  check('the 404 body leaks nothing about the row', JSON.stringify(stolenRead.body) === JSON.stringify({ error: { code: 'not_found', message: 'Assessment not found' } }));

  const danaReadsOwn = await request('GET', `/api/assessments/${danaAssessment.id}`, { as: DANA });
  check('Dana can read her own assessment', danaReadsOwn.status === 200 && danaReadsOwn.body.repairName === 'Dana private brake job');

  const alexList = await request('GET', '/api/assessments');
  check(
    "Dana's assessment is absent from Alex's list",
    !alexList.body.some((a: any) => a.id === danaAssessment.id),
  );

  /* ------------------------ cross-tenant writes are refused, not silently applied */

  const stolenComplete = await request('POST', `/api/assessments/${danaAssessment.id}/complete`, {
    body: { cost: 999 },
  });
  check(
    "Alex completing Dana's repair gets 404",
    stolenComplete.status === 404,
    `got ${stolenComplete.status}`,
  );

  const [danaAfter] = await db.select().from(t.assessments).where(eq(t.assessments.id, danaAssessment.id));
  check("Dana's assessment was not modified", danaAfter.completedAt === null && danaAfter.completedCost === null);

  const danaRecordsAfter = await db
    .select()
    .from(t.serviceRecords)
    .where(eq(t.serviceRecords.userId, danaAssessment.userId));
  check('no service record was written to Dana on the failed attempt', danaRecordsAfter.length === 1);

  /* ------------------- writes land on the acting user, never on the other one */

  const danaLogged = await request('POST', '/api/service-records', {
    as: DANA,
    body: { description: 'Dana new brakes', date: '2026-07-20', cost: 210 },
  });
  check("Dana's write succeeds", danaLogged.status === 201);

  const alexHistoryAfter = await request('GET', '/api/service-records');
  check(
    "Dana's new record does not appear for Alex",
    !alexHistoryAfter.body.some((r: any) => r.description === 'Dana new brakes'),
  );
  check("Alex's history is unchanged in length", alexHistoryAfter.body.length === 6);

  const danaCreated = await request('POST', '/api/assessments', {
    as: DANA,
    body: { repairId: (await request('GET', '/api/repairs')).body[0].id, quoteAmount: 300 },
  });
  check("Dana's new assessment is attributed to Dana", danaCreated.status === 201);

  const [createdRow] = await db.select().from(t.assessments).where(eq(t.assessments.id, danaCreated.body.id));
  check('the created row carries Dana\'s userId', createdRow.userId === danaAssessment.userId);
  check("the created assessment points at Dana's vehicle", createdRow.vehicleId === danaVehicle.body.id);

  /* ------------------------------- unresolvable user is rejected, not defaulted */

  const ghost = await request('GET', '/api/vehicle', { as: 'nobody@example.com' });
  check('an unknown user gets 401, not someone else\'s data', ghost.status === 401, `got ${ghost.status}`);
  check('the error does not contain vehicle data', !JSON.stringify(ghost.body).includes('Civic'));

  await close();
}
