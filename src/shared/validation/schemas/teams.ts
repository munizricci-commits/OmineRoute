import { z } from "zod";

export const TeamBudgetDurationSchema = z.enum(["1d", "7d", "30d"]);

const budgetFields = {
  maxBudgetUsd: z.coerce.number().positive().nullable().optional(),
  budgetDuration: TeamBudgetDurationSchema.nullable().optional(),
};

function validateBudgetPair(
  value: { maxBudgetUsd?: number | null; budgetDuration?: string | null },
  ctx: z.RefinementCtx
) {
  const hasAmount = value.maxBudgetUsd != null;
  const hasDuration = value.budgetDuration != null;
  if (hasAmount !== hasDuration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maxBudgetUsd and budgetDuration must be configured or cleared together",
      path: hasAmount ? ["budgetDuration"] : ["maxBudgetUsd"],
    });
  }
}

export const TeamCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    ...budgetFields,
  })
  .superRefine(validateBudgetPair);

export const TeamUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    ...budgetFields,
  })
  .refine((value) => Object.keys(value).length > 0, "At least one update field is required")
  .superRefine((value, ctx) => {
    if (
      (value.maxBudgetUsd === null && value.budgetDuration !== null) ||
      (value.budgetDuration === null && value.maxBudgetUsd !== null)
    ) {
      validateBudgetPair(value, ctx);
    }
  });

export const TeamMemberAssignmentSchema = z.object({
  apiKeyId: z.string().uuid(),
});
