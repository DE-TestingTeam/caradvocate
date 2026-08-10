/**
 * Zod schemas for every request body the API accepts, reusable by the web app so both sides
 * reject the same input. Response shapes live in domain.ts -- we validate what comes in, not
 * what we emit.
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

/** An odometer reading. Generous upper bound; a negative one is a typo. */
export const mileageSchema = z.number().int().min(0).max(2_000_000);

export const newServiceRecordSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(200),
  date: isoDateSchema,
  cost: moneySchema,
  /** Optional, but without it this service cannot measure any interval. */
  mileageAtService: mileageSchema.optional(),
  /** Set when the owner says this counts as one of their upkeep jobs. */
  maintenanceItemId: z.string().uuid().optional(),
});

/**
 * Every field optional, but at least one required -- an empty PATCH is a mistake. The clearable
 * fields also accept `null`, and the difference matters: omitted means "leave it alone", null
 * means "remove it". Without null a wrongly-entered odometer could only be replaced, never
 * withdrawn.
 */
export const updateServiceRecordSchema = newServiceRecordSchema
  .partial()
  .extend({
    mileageAtService: mileageSchema.nullable().optional(),
    maintenanceItemId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/**
 * An upkeep job. Intervals are optional because an owner may want the job listed before they
 * know how often it should happen -- it then reads as "unknown" rather than taking a guess.
 */
export const newMaintenanceItemSchema = z.object({
  label: z.string().trim().min(1, 'Give the job a name').max(120),
  intervalMiles: z.number().int().positive().max(200_000).optional(),
  intervalMonths: z.number().int().positive().max(240).optional(),
});

/** Intervals accept `null` so an owner can withdraw a wrong one, not only replace it. */
export const updateMaintenanceItemSchema = newMaintenanceItemSchema
  .partial()
  .extend({
    intervalMiles: z.number().int().positive().max(200_000).nullable().optional(),
    intervalMonths: z.number().int().positive().max(240).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const newAssessmentSchema = z.object({
  repairId: z.string().uuid('Pick a repair from the catalog'),
  /** Omitted when the user chose "No, not yet". */
  quoteAmount: moneySchema.positive().optional(),
  quoteFileName: z.string().trim().max(255).optional(),
  /**
   * REQUIRED, unlike everything else added here, and it is one tap on the form.
   *
   * The necessity check reads this; without it there is nothing to reason from but a repair name
   * and a price, which is the position the feature has been stuck in. Making it optional would
   * mean building the judgement on a field that is empty exactly when someone rushed the form --
   * and a rushed form is not correlated with an easy case.
   *
   * Existing rows carry null and stay that way: they were never asked, which the API must keep
   * able to say. Only new assessments are held to this.
   */
  promptedBy: z.enum(['symptom', 'warning_light', 'routine_service', 'shop_suggested', 'other'], {
    errorMap: () => ({ message: 'Tell us what prompted this repair' }),
  }),
  /** What they notice, or what the shop said. Free text -- this is the part worth reading. */
  symptomNotes: z.string().trim().max(1000).optional(),
  symptomDuration: z.enum(['days', 'weeks', 'months', 'unsure']).optional(),
});

export const completeAssessmentSchema = z.object({
  cost: moneySchema,
});

/**
 * An NHTSA campaign number, e.g. "20V314000" -- two digits, a letter, then six.
 * Validated so a junk path segment is a 422 rather than a row keyed on nonsense.
 */
export const campaignNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z][0-9]{3,6}$/, 'That does not look like an NHTSA campaign number');

/** What an owner tells us about a recall on their own car. */
export const recallStatusSchema = z.object({
  repaired: z.boolean(),
});

/** A VIN is 17 characters and never contains I, O or Q, to avoid digit confusion. */
export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(17, 'A VIN is exactly 17 characters')
  .regex(/^[A-HJ-NPR-Z0-9]+$/, 'A VIN cannot contain the letters I, O or Q');

/** A 5-digit US zip. Optional everywhere it appears -- see `zip` on the Vehicle contract. */
export const zipSchema = z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit zip code');

export const newVehicleSchema = z.object({
  year: z
    .number()
    .int()
    .min(1900, 'Year looks too early')
    // Manufacturers sell next year's models, so allow one year ahead.
    .max(new Date().getFullYear() + 1, 'Year looks too far in the future'),
  make: z.string().trim().min(1, 'Make is required').max(60),
  model: z.string().trim().min(1, 'Model is required').max(80),
  trim: z.string().trim().max(80).optional(),
  /** Optional: plenty of owners cannot find their VIN on the spot. */
  vin: vinSchema.optional(),
  mileage: z.number().int().min(0).max(2_000_000),
  /** Optional: needed to price the car, but nobody should be blocked on it at onboarding. */
  zip: zipSchema.optional(),
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
    zip: zipSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/**
 * Ask CA conversations are not stored, so the client sends the turns so far along with
 * the question -- see routes/chat.ts for why nothing is persisted.
 *
 * The cap is here rather than only server-side so an oversized body is rejected as a
 * validation error instead of being silently trimmed.
 */
/**
 * How many prior messages a request may carry. Exported because the client has to slice to it
 * before sending: the browser now keeps a transcript for the life of the tab, so a long
 * conversation will sail past this cap, and a rejected request would break the chat for good
 * rather than just for one message.
 *
 * The API only reads the last few of these -- see HISTORY_MESSAGES in routes/chat.ts. This is
 * the ceiling on what may arrive, not what gets used.
 */
export const CHAT_HISTORY_LIMIT = 40;

export const sendChatMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(CHAT_HISTORY_LIMIT)
    .optional()
    .default([]),
});

export type NewVehicleInput = z.infer<typeof newVehicleSchema>;
export type NewServiceRecordInput = z.infer<typeof newServiceRecordSchema>;
export type NewAssessmentInput = z.infer<typeof newAssessmentSchema>;
export type CompleteAssessmentInput = z.infer<typeof completeAssessmentSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type RecallStatusInput = z.infer<typeof recallStatusSchema>;
export type UpdateServiceRecordInput = z.infer<typeof updateServiceRecordSchema>;
export type NewMaintenanceItemInput = z.infer<typeof newMaintenanceItemSchema>;
export type UpdateMaintenanceItemInput = z.infer<typeof updateMaintenanceItemSchema>;
