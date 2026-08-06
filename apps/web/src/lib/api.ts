/**
 * The single seam between the UI and the server. Components never call fetch directly --
 * they call these functions, typed by the shared domain contract, so a backend change that
 * breaks a shape fails typechecking here rather than at runtime in a component.
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
  RepairCatalogReport,
  ServiceRecord,
  PaywallStatus,
  UpdateAccountInput,
  UpdateVehicleInput,
  Vehicle,
  VehicleImage,
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

/** Rejects when the VIN cannot be decoded -- callers should fall back to manual entry. */
export function decodeVin(vin: string): Promise<DecodedVin> {
  return http.get<DecodedVin>(`/vehicle/decode/${encodeURIComponent(vin)}`);
}

/**
 * Upkeep jobs with their due status already worked out server-side, so the client never
 * does the arithmetic and cannot disagree with it.
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

/** Open safety recalls. `checked` lets the UI say "none found" only when NHTSA was reached. */
export function getRecalls(): Promise<RecallReport> {
  return http.get<RecallReport>('/vehicle/recalls');
}

/** What the owner says about one recall on their car -- NHTSA cannot tell us. */
export function setRecallRepaired(campaignNumber: string, repaired: boolean): Promise<void> {
  return http.put<void>(`/vehicle/recalls/${encodeURIComponent(campaignNumber)}`, { repaired });
}

/** Returns a recall to "unknown", for when the owner is no longer sure. */
export function clearRecallStatus(campaignNumber: string): Promise<void> {
  return http.delete<void>(`/vehicle/recalls/${encodeURIComponent(campaignNumber)}`);
}

/**
 * The signed URL of a studio photo of the caller's model. Resolves to `{}` rather than
 * rejecting when there is nothing to show, so a missing photo is a placeholder, not an
 * error. The URL expires -- fetch when the image mounts, do not hold it.
 */
export function getVehicleImage(): Promise<VehicleImage> {
  return http.get<VehicleImage>('/vehicle/image');
}

/* ---------------------------------------------------------------- paywall */

/** The offer as shown, plus whether this owner is already past it. */
export function getPaywall(): Promise<PaywallStatus> {
  return http.get<PaywallStatus>('/paywall');
}

/**
 * Records a tap on unlock and opens the paid features. Charges nothing -- the tap is the
 * signal. Pass the screen the owner was actually on: the prototype reads conversion by it.
 */
export function unlockPaywall(source: 'repair_cost_checker' | 'account'): Promise<PaywallStatus> {
  return http.post<PaywallStatus>('/paywall/unlock', { source });
}

/* -------------------------------------------------------- service history */

export function getServiceHistory(): Promise<ServiceRecord[]> {
  return http.get<ServiceRecord[]>('/service-records');
}

export function addServiceRecord(input: NewServiceRecordInput): Promise<ServiceRecord> {
  return http.post<ServiceRecord>('/service-records', input);
}

/**
 * Corrects a record. These rows drive the maintenance calculation, so a mistyped odometer
 * makes the app claim a job is due when it is not.
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

/**
 * The repairs that can be priced for the owner's own car. `checked` tells "the vendor has no
 * pricing for this car" from "we have never reached the vendor", which the picker has to
 * say. Repairs priced against a different vehicle are never included.
 */
export function getRepairCatalog(): Promise<RepairCatalogReport> {
  return http.get<RepairCatalogReport>('/repairs');
}

/* ------------------------------------------------------------------- chat */

/**
 * Sends a question along with the conversation so far. There is no getChatHistory: nothing
 * is stored. The conversation lives in the Ask CA page's state and goes when the page does.
 */
export interface ChatTurn {
  user: ChatMessage;
  assistant: ChatMessage;
}

/**
 * Asks one question and resolves with the finished turn.
 *
 * `onPreview` is called with the answer so far while it is still being written. It is
 * unvalidated model output and exists only so the screen is not blank -- render it, but throw it
 * away when this resolves. The resolved turn is the one the API validated, and it is the only
 * thing carrying urgency and the CTA.
 */
export async function sendChatMessage(
  text: string,
  history: { role: 'user' | 'assistant'; text: string }[],
  onPreview?: (answerSoFar: string) => void,
  signal?: AbortSignal,
): Promise<ChatTurn> {
  let turn: ChatTurn | undefined;
  let preview = '';

  await http.stream(
    '/chat',
    { text, history },
    (event, data) => {
      if (event === 'delta') {
        preview += (data as { text: string }).text;
        onPreview?.(preview);
      } else if (event === 'message') {
        turn = data as ChatTurn;
      }
    },
    signal,
  );

  // The endpoint sends `message` on every path, including refusals and failures. Missing it
  // means the stream died early -- surfaced as an error rather than left as a stale preview.
  if (!turn) throw new Error('The answer did not arrive in full. Try again.');
  return turn;
}

/* ---------------------------------------------------------------- account */

export function getAccount(): Promise<Account> {
  return http.get<Account>('/account');
}

export function updateAccount(patch: UpdateAccountInput): Promise<Account> {
  return http.patch<Account>('/account', patch);
}
