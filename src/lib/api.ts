/**
 * The single seam between the UI and its data.
 *
 * Every function returns a promise and resolves after a short artificial delay so
 * loading states are exercised in development. No component may import from
 * src/mocks -- swapping this file's bodies for `fetch` calls against the Express
 * API is the whole migration.
 */
import { db, nextId } from './store';
import { cannedReplies } from '@/mocks/askResponses';
import { todayIso } from './format';
import type {
  Account,
  Assessment,
  ChatMessage,
  KnownIssue,
  MaintenanceItem,
  NewAssessmentInput,
  NewServiceRecordInput,
  RepairCatalogItem,
  ServiceRecord,
  Vehicle,
} from '@/types';

function delay<T>(value: T, ms = 200 + Math.random() * 200): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(structuredClone(value)), ms));
}

/* ---------------------------------------------------------------- vehicle */

export function getVehicle(): Promise<Vehicle> {
  return delay(db.vehicle);
}

export function updateVehicle(patch: Partial<Pick<Vehicle, 'model' | 'trim' | 'vin' | 'mileage'>>): Promise<Vehicle> {
  db.vehicle = { ...db.vehicle, ...patch };
  return delay(db.vehicle);
}

export function getMaintenance(): Promise<MaintenanceItem[]> {
  return delay(db.maintenance);
}

export function getKnownIssues(): Promise<KnownIssue[]> {
  return delay(db.knownIssues);
}

/* -------------------------------------------------------- service history */

export function getServiceHistory(): Promise<ServiceRecord[]> {
  return delay(sortedHistory());
}

export function addServiceRecord(input: NewServiceRecordInput): Promise<ServiceRecord> {
  const record: ServiceRecord = {
    id: nextId('svc'),
    description: input.description,
    date: input.date,
    cost: input.cost,
    source: 'manual',
  };
  db.serviceHistory = [record, ...db.serviceHistory];
  return delay(record);
}

/* ------------------------------------------------------------ assessments */

export function listAssessments(): Promise<Assessment[]> {
  const sorted = [...db.assessments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return delay(sorted);
}

export function getAssessment(id: string): Promise<Assessment | undefined> {
  return delay(db.assessments.find((a) => a.id === id));
}

export function createAssessment(input: NewAssessmentInput): Promise<Assessment> {
  const template = db.assessments.find((a) => a.repairName === input.repairName) ?? db.assessments[0];
  const created: Assessment = {
    ...structuredClone(template),
    id: nextId('asm'),
    repairName: input.repairName,
    vehicleId: db.vehicle.id,
    mileageAtAssessment: db.vehicle.mileage,
    createdAt: todayIso(),
    completedAt: undefined,
    completedCost: undefined,
    quote: undefined,
  };

  if (typeof input.quoteAmount === 'number') {
    created.quote = buildQuoteEvaluation(created, input.quoteAmount);
  }

  db.assessments = [created, ...db.assessments];
  return delay(created);
}

/**
 * Marks an assessment complete and mirrors it into service history, which is what
 * the Repair Completed dialog promises ("Your service history on My Car has been
 * updated with this repair").
 */
export function completeAssessment(id: string, cost: number): Promise<Assessment> {
  const target = db.assessments.find((a) => a.id === id);
  if (!target) return Promise.reject(new Error(`Assessment ${id} not found`));

  target.completedAt = todayIso();
  target.completedCost = cost;

  db.serviceHistory = [
    {
      id: nextId('svc'),
      description: target.repairName,
      date: target.completedAt,
      cost,
      source: 'repair_cost_checker',
    },
    ...db.serviceHistory,
  ];

  return delay(target);
}

export function getRepairCatalog(): Promise<RepairCatalogItem[]> {
  return delay(db.repairCatalog);
}

/* ------------------------------------------------------------------- chat */

export function getChatHistory(): Promise<ChatMessage[]> {
  return delay(db.chat);
}

/** Appends the user message and one canned assistant reply. No LLM in this build. */
export function sendChatMessage(text: string): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  const user: ChatMessage = { id: nextId('msg'), role: 'user', text };
  const reply = cannedReplies[db.replyCursor % cannedReplies.length];
  db.replyCursor += 1;
  const assistant: ChatMessage = { ...structuredClone(reply), id: nextId('msg') };

  db.chat = [...db.chat, user, assistant];
  return delay({ user, assistant }, 800);
}

/* ---------------------------------------------------------------- account */

export function getAccount(): Promise<Account> {
  return delay(db.account);
}

export function updateAccount(patch: Partial<Pick<Account, 'name' | 'email' | 'phone'>>): Promise<Account> {
  db.account = { ...db.account, ...patch };
  return delay(db.account);
}

/* --------------------------------------------------------------- internal */

function sortedHistory(): ServiceRecord[] {
  return [...db.serviceHistory].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Stands in for the backend's pricing model: fair if the quote lands inside the
 * benchmark range, overpriced above it. Below-range quotes are treated as fair
 * because the wireframes define no third verdict.
 */
function buildQuoteEvaluation(assessment: Assessment, amount: number) {
  const { fairTotalLow, fairTotalHigh, parts, labor } = assessment;
  const overpriced = amount > fairTotalHigh;
  const partsShare = Math.round(amount * (parts.total / (parts.total + labor.total)));
  const laborShare = amount - partsShare;

  return {
    amount,
    parts: partsShare,
    labor: laborShare,
    verdict: overpriced ? ('overpriced' as const) : ('fair' as const),
    explanation: overpriced
      ? `Your quoted price of $${amount.toLocaleString('en-US')} is above the expected range of $${fairTotalLow.toLocaleString('en-US')}-$${fairTotalHigh.toLocaleString('en-US')} for this repair. Both parts and labor are priced above benchmark.`
      : `Your quoted price of $${amount.toLocaleString('en-US')} is within the expected range of $${fairTotalLow.toLocaleString('en-US')}-$${fairTotalHigh.toLocaleString('en-US')} for this repair. Parts and labor are both within normal bounds.`,
  };
}
