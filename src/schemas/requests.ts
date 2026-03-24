import { z } from "zod";

export const submitSwapRequestSchema = z.object({
  scheduleShiftId: z.string().uuid(),
  reason: z.string().trim().optional().nullable(),
  expiresHours: z.number().int().positive().optional().nullable(),
});

export const submitSwapOfferSchema = z
  .object({
    requestId: z.string().uuid(),
    offerType: z.enum(["cover", "swap"]),
    swapScheduleShiftId: z.string().uuid().optional().nullable(),
    note: z.string().trim().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.offerType === "swap" && !value.swapScheduleShiftId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "swapScheduleShiftId is required for swap offers.",
        path: ["swapScheduleShiftId"],
      });
    }
  });

export const selectOfferSchema = z.object({
  offerId: z.string().uuid(),
});

export const submitTimeOffRequestSchema = z.object({
  storeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().trim().optional().nullable(),
});

export const submitTimesheetChangeSchema = z.object({
  shiftId: z.string().uuid(),
  requestedStartedAt: z.string().optional().nullable(),
  requestedEndedAt: z.string().optional().nullable(),
  reason: z.string().min(1),
});

export const denyRequestSchema = z.object({
  reason: z.string().trim().optional().nullable(),
});

export const submitAdvanceSchema = z.object({
  storeId: z.string().uuid().optional().nullable(),
  advanceDate: z.string().datetime({ offset: true }).optional().nullable(),
  advanceHours: z.number().positive(),
  cashAmountDollars: z.number().nonnegative().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

export const submitCoverageShiftSchema = z.object({
  coverageStoreId: z.string().uuid(),
  shiftDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  timeIn:          z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  timeOut:         z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  notes:           z.string().trim().max(500).optional().nullable(),
});

export type SubmitCoverageShiftInput = z.infer<typeof submitCoverageShiftSchema>;
