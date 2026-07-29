/**
 * Zod schemas for every request body the API accepts.
 *
 * The API validates with these; the web app can reuse them for client-side form
 * validation so both sides reject the same input. Response shapes are described
 * by the interfaces in domain.ts -- we validate what comes in, not what we emit.
 */
import { z } from 'zod';

/** ISO calendar date, e.g. "2026-07-28". Rejects datetimes and impossible dates. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

/** Whole dollars. The product has no use for cents and Postgres stores integers. */
export const moneySchema = z.number().int('Amounts are whole dollars').min(0).max(1_000_000);

export const newServiceRecordSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(200),
  date: isoDateSchema,
  cost: moneySchema,
});

export const newAssessmentSchema = z.object({
  repairId: z.string().uuid('Pick a repair from the catalog'),
  /** Omitted when the user chose "No, not yet". */
  quoteAmount: moneySchema.positive().optional(),
  quoteFileName: z.string().trim().max(255).optional(),
});

export const completeAssessmentSchema = z.object({
  cost: moneySchema,
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const updateVehicleSchema = z
  .object({
    model: z.string().trim().min(1).max(80),
    trim: z.string().trim().max(80).optional(),
    vin: z.string().trim().length(17, 'A VIN is 17 characters'),
    mileage: z.number().int().min(0).max(2_000_000),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const sendChatMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

export type NewServiceRecordInput = z.infer<typeof newServiceRecordSchema>;
export type NewAssessmentInput = z.infer<typeof newAssessmentSchema>;
export type CompleteAssessmentInput = z.infer<typeof completeAssessmentSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
