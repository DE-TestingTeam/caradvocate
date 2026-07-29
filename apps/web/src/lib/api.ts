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
  KnownIssue,
  MaintenanceItem,
  NewAssessmentInput,
  NewServiceRecordInput,
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

export function getMaintenance(): Promise<MaintenanceItem[]> {
  return http.get<MaintenanceItem[]>('/vehicle/maintenance');
}

export function getKnownIssues(): Promise<KnownIssue[]> {
  return http.get<KnownIssue[]>('/vehicle/known-issues');
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
