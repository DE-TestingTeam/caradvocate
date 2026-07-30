/**
 * The single seam between the UI and the server.
 *
 * Components never call fetch directly and never import from @caradvocate/shared
 * schemas for transport concerns -- they call these functions. Every response is
 * typed by the shared domain contract, so a backend change that breaks a shape
 * fails typechecking here rather than at runtime in a component.
 */
import type {
  Account,
  Assessment,
  ChatMessage,
  DecodedVin,
  KnownIssueReport,
  MaintenanceItem,
  NewAssessmentInput,
  NewMaintenanceItemInput,
  NewServiceRecordInput,
  NewVehicleInput,
  UpdateMaintenanceItemInput,
  UpdateServiceRecordInput,
  RecallReport,
  RepairCatalogItem,
  ServiceRecord,
  UpdateAccountInput,
  UpdateVehicleInput,
  Vehicle,
} from '@caradvocate/shared';
import { http } from './http';

/* ---------------------------------------------------------------- vehicle */

export function getVehicle(): Promise<Vehicle> {
  return http.get<Vehicle>('/vehicle');
}

export function updateVehicle(patch: UpdateVehicleInput): Promise<Vehicle> {
  return http.patch<Vehicle>('/vehicle', patch);
}

/** Onboarding: adds the signed-in user's first vehicle. */
export function createVehicle(input: NewVehicleInput): Promise<Vehicle> {
  return http.post<Vehicle>('/vehicle', input);
}

/**
 * Looks up a VIN. Rejects when the VIN cannot be decoded, which callers should
 * treat as "fall back to manual entry" rather than as a failure to report.
 */
export function decodeVin(vin: string): Promise<DecodedVin> {
  return http.get<DecodedVin>(`/vehicle/decode/${encodeURIComponent(vin)}`);
}

/**
 * Upkeep jobs with their due status already worked out. The status is computed
 * server-side from the interval, the linked service history and the odometer, so the
 * client never does the arithmetic and cannot disagree with it.
 */
export function getMaintenance(): Promise<MaintenanceItem[]> {
  return http.get<MaintenanceItem[]>('/vehicle/maintenance');
}

export function addMaintenanceItem(input: NewMaintenanceItemInput): Promise<MaintenanceItem> {
  return http.post<MaintenanceItem>('/vehicle/maintenance', input);
}

export function updateMaintenanceItem(id: string, patch: UpdateMaintenanceItemInput): Promise<MaintenanceItem> {
  return http.patch<MaintenanceItem>(`/vehicle/maintenance/${encodeURIComponent(id)}`, patch);
}

export function deleteMaintenanceItem(id: string): Promise<void> {
  return http.delete<void>(`/vehicle/maintenance/${encodeURIComponent(id)}`);
}

/**
 * Curated known issues plus systems owners have complained about to NHTSA.
 * `checked` distinguishes "nothing reported" from "the feed was never reached".
 */
export function getKnownIssues(): Promise<KnownIssueReport> {
  return http.get<KnownIssueReport>('/vehicle/known-issues');
}

/**
 * Open safety recalls. Carries `checked` so the UI can say "none found" only when
 * NHTSA was actually reached, rather than implying an all-clear it cannot support.
 */
export function getRecalls(): Promise<RecallReport> {
  return http.get<RecallReport>('/vehicle/recalls');
}

/**
 * Records what the owner says about one recall on their car. NHTSA cannot tell us
 * whether the work was done, so this is the only source for it.
 */
export function setRecallRepaired(campaignNumber: string, repaired: boolean): Promise<void> {
  return http.put<void>(`/vehicle/recalls/${encodeURIComponent(campaignNumber)}`, { repaired });
}

/** Returns a recall to "unknown", for when the owner is no longer sure. */
export function clearRecallStatus(campaignNumber: string): Promise<void> {
  return http.delete<void>(`/vehicle/recalls/${encodeURIComponent(campaignNumber)}`);
}

/* -------------------------------------------------------- service history */

export function getServiceHistory(): Promise<ServiceRecord[]> {
  return http.get<ServiceRecord[]>('/service-records');
}

export function addServiceRecord(input: NewServiceRecordInput): Promise<ServiceRecord> {
  return http.post<ServiceRecord>('/service-records', input);
}

/**
 * Corrects a record. Worth having beyond tidiness: these rows drive the maintenance
 * calculation, so a mistyped odometer makes the app claim a job is due when it is not.
 */
export function updateServiceRecord(id: string, patch: UpdateServiceRecordInput): Promise<ServiceRecord> {
  return http.patch<ServiceRecord>(`/service-records/${encodeURIComponent(id)}`, patch);
}

export function deleteServiceRecord(id: string): Promise<void> {
  return http.delete<void>(`/service-records/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------ assessments */

export function listAssessments(): Promise<Assessment[]> {
  return http.get<Assessment[]>('/assessments');
}

export function getAssessment(id: string): Promise<Assessment> {
  return http.get<Assessment>(`/assessments/${id}`);
}

export function createAssessment(input: NewAssessmentInput): Promise<Assessment> {
  return http.post<Assessment>('/assessments', input);
}

export function completeAssessment(id: string, cost: number): Promise<Assessment> {
  return http.post<Assessment>(`/assessments/${id}/complete`, { cost });
}

export function getRepairCatalog(): Promise<RepairCatalogItem[]> {
  return http.get<RepairCatalogItem[]>('/repairs');
}

/* ------------------------------------------------------------------- chat */

/**
 * Sends a question along with the conversation so far.
 *
 * There is no getChatHistory: nothing is stored, so there is nothing to fetch. The
 * conversation lives in the Ask CA page's state and goes when the page does -- see
 * apps/api/src/routes/chat.ts for why.
 */
export function sendChatMessage(
  text: string,
  history: { role: 'user' | 'assistant'; text: string }[],
): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  return http.post<{ user: ChatMessage; assistant: ChatMessage }>('/chat', { text, history });
}

/* ---------------------------------------------------------------- account */

export function getAccount(): Promise<Account> {
  return http.get<Account>('/account');
}

export function updateAccount(patch: UpdateAccountInput): Promise<Account> {
  return http.patch<Account>('/account', patch);
}
