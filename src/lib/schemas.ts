import { z } from "zod";

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const identitySchema = z
  .object({ name: z.string(), email: z.string().email() })
  .passthrough();
export const planSchema = z.record(jsonValueSchema);

export const paginationSchema = z.object({
  page: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  totalElements: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const inboxRowSchema = z
  .object({
    id: z.string(),
    customerPhone: z.string(),
    customerName: z.string().nullable().optional(),
    status: z.string(),
    lastInteractionAt: z.string().nullable().optional(),
    windowExpiresAt: z.string().nullable().optional(),
    isWindowOpen: z.boolean(),
    leadSummary: z.string().nullable().optional(),
    originatingCampaignId: z.string().nullable().optional(),
    routineKey: z.string(),
    stage: z.string().nullable().optional(),
    nextStep: z.string().nullable().optional(),
    slaDueAt: z.string().nullable().optional(),
    overdue: z.boolean(),
    ownerId: z.string().nullable().optional(),
    ownerName: z.string().nullable().optional(),
    claimedAt: z.string().nullable().optional(),
    lastMessagePreview: z.string().nullable().optional(),
    lastMessageDirection: z.string().nullable().optional(),
  })
  .passthrough();

export const pagedInboxSchema = z
  .object({
    content: z.array(inboxRowSchema),
    page: z.number().int().nonnegative(),
    size: z.number().int().positive(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    attention: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
  })
  .transform(
    ({ content, page, size, totalElements, totalPages, waiting, attention, unassigned }) => ({
      data: content,
      pagination: { page, size, totalElements, totalPages },
      summary: { waiting, attention, unassigned },
    }),
  );
export const todaySchema = z.record(jsonValueSchema);
export const coverageSchema = z.record(jsonValueSchema);
export const routineSchema = z
  .object({ key: z.string(), name: z.string().optional(), published: z.boolean() })
  .passthrough();
export const routinesSchema = z.array(routineSchema);

export const messageSchema = z.object({ id: z.string().nullable() }).passthrough();
export const pagedMessagesSchema = z
  .object({
    content: z.array(messageSchema),
    page: z.number().int().nonnegative(),
    size: z.number().int().positive(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .transform(({ content, page, size, totalElements, totalPages }) => ({
    data: content,
    pagination: { page, size, totalElements, totalPages },
  }));
export const mutationSchema = z.record(jsonValueSchema);

export const automationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    trigger: z.string(),
    triggerConfig: jsonValueSchema,
    active: z.boolean(),
    steps: z.array(z.object({ type: z.string(), config: jsonValueSchema }).passthrough()),
    costPerRunBrl: z.number(),
    stats: jsonValueSchema.optional(),
    webhookUrl: z.string().nullable().optional(),
  })
  .passthrough();
export const automationsSchema = z.array(automationSchema);

export const templateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    formattedName: z.string().optional(),
    category: z.string(),
    language: z.string(),
    providerStatus: z.string(),
    availableForSending: z.boolean(),
  })
  .passthrough();
export const templatesSchema = z.array(templateSchema);

export const numberSchema = z.record(jsonValueSchema);
export const numbersSchema = z.object({
  numbers: z.array(numberSchema),
  slot: jsonValueSchema.nullable().optional(),
});
export const campaignSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    totalMessages: z.number().int().nonnegative(),
    totalCost: z.number(),
    scheduledAt: z.string().nullable().optional(),
  })
  .passthrough();
