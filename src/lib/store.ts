/**
 * In-memory mock database.
 *
 * This is the ONLY module besides lib/api.ts that may import from src/mocks.
 * It exists so mutations (logging a service, completing a repair, creating an
 * assessment) persist across navigation within a session. Reloading resets it.
 *
 * When the Express API lands, delete this file and reimplement lib/api.ts with fetch.
 */
import { account } from '@/mocks/account';
import { assessments } from '@/mocks/assessments';
import { knownIssues } from '@/mocks/knownIssues';
import { maintenanceItems } from '@/mocks/maintenance';
import { repairCatalog } from '@/mocks/repairCatalog';
import { seedMessages } from '@/mocks/askResponses';
import { serviceHistory } from '@/mocks/serviceHistory';
import { vehicle } from '@/mocks/vehicle';
import type {
  Account,
  Assessment,
  ChatMessage,
  KnownIssue,
  MaintenanceItem,
  RepairCatalogItem,
  ServiceRecord,
  Vehicle,
} from '@/types';

interface Db {
  vehicle: Vehicle;
  maintenance: MaintenanceItem[];
  knownIssues: KnownIssue[];
  serviceHistory: ServiceRecord[];
  assessments: Assessment[];
  chat: ChatMessage[];
  account: Account;
  repairCatalog: RepairCatalogItem[];
  replyCursor: number;
}

/** structuredClone keeps the imported fixtures pristine across resets. */
export const db: Db = {
  vehicle: structuredClone(vehicle),
  maintenance: structuredClone(maintenanceItems),
  knownIssues: structuredClone(knownIssues),
  serviceHistory: structuredClone(serviceHistory),
  assessments: structuredClone(assessments),
  chat: structuredClone(seedMessages),
  account: structuredClone(account),
  repairCatalog: structuredClone(repairCatalog),
  replyCursor: 0,
};

let idCounter = 1000;

export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}
