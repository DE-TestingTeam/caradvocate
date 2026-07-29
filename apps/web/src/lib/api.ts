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
  NewServiceRecordInput,
  NewVehicleInput,
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

export function getMaintenance(): Promise<MaintenanceItem[]> {
  return http.get<MaintenanceItem[]>('/vehicle/maintenance');
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

/* -------------------------------------------------------- service history */

export function getServiceHistory(): Promise<ServiceRecord[]> {
  return http.get<ServiceRecord[]>('/service-records');
}

export function addServiceRecord(input: NewServiceRecordInput): Promise<ServiceRecord> {
  return http.post<ServiceRecord>('/service-records', input);
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

export function getChatHistory(): Promise<ChatMessage[]> {
  return http.get<ChatMessage[]>('/chat');
}

export function sendChatMessage(text: string): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  return http.post<{ user: ChatMessage; assistant: ChatMessage }>('/chat', { text });
}

/* ---------------------------------------------------------------- account */

export function getAccount(): Promise<Account> {
  return http.get<Account>('/account');
}

export function updateAccount(patch: UpdateAccountInput): Promise<Account> {
  return http.patch<Account>('/account', patch);
}
