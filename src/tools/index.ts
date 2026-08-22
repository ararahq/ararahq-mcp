import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PAGE_SIZE } from "../config.js";
import { apiRequest } from "../lib/api.js";
import { AraraError } from "../lib/errors.js";
import {
  automationSchema,
  automationsSchema,
  campaignSchema,
  coverageSchema,
  identitySchema,
  jsonValueSchema,
  messageSchema,
  mutationSchema,
  pagedInboxSchema,
  pagedMessagesSchema,
  planSchema,
  routineSchema,
  templateSchema,
  templatesSchema,
  todaySchema,
} from "../lib/schemas.js";
import { execute, toolOutputSchema } from "../mcp/result.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const idempotentWrite = { ...write, idempotentHint: true };
const destructive = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
const idSchema = z.string().uuid();
const e164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164, for example +5511999999999.");
const routineKeySchema = z.enum(["support", "billing", "scheduling"]);
const routinesResponseSchema = z.object({ data: z.array(routineSchema) });

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
const register = (
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  annotations: typeof readOnly,
  handler: ToolHandler,
): void => {
  server.registerTool(
    name,
    { description, inputSchema, outputSchema: toolOutputSchema, annotations },
    handler as never,
  );
};

export const TOOL_NAMES = [
  "whoami",
  "get_today",
  "find_conversations",
  "get_conversation",
  "reply_to_conversation",
  "claim_conversation",
  "close_conversation",
  "list_automations",
  "get_automation",
  "prepare_campaign",
  "publish_campaign",
  "send_whatsapp",
  "check_message",
  "save_contacts",
  "create_template",
  "get_template_status",
  "opt_out",
] as const;

export const registerAllTools = (server: McpServer): void => {
  register(
    server,
    "whoami",
    "Return the authenticated AraraHQ identity and organization plan.",
    {},
    readOnly,
    async () =>
      execute(async () => {
        const [identity, plan] = await Promise.all([
          apiRequest("/auth/me", { schema: identitySchema }),
          apiRequest("/v1/organizations/me/plan", { schema: planSchema }),
        ]);
        return {
          data: { identity, plan },
          message: `Authenticated as ${identity.name} (${identity.email}).`,
        };
      }),
  );

  register(
    server,
    "get_today",
    "Return today's Atendimento queue across support, billing and scheduling.",
    {},
    readOnly,
    async () =>
      execute(async () => ({
        data: await apiRequest("/v1/operation/today", { schema: todaySchema }),
        message: "Today's operation loaded.",
      })),
  );

  register(
    server,
    "find_conversations",
    "Find Atendimento conversations with stable pagination. Use this before selecting a conversation.",
    {
      filter: z.string().max(100).optional(),
      page: z.number().int().nonnegative().default(0),
      size: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    },
    readOnly,
    async (input) =>
      execute(async () => {
        const params = new URLSearchParams({ page: String(input.page), size: String(input.size) });
        if (typeof input.filter === "string" && input.filter.length > 0)
          params.set("filter", input.filter);
        const data = await apiRequest(`/v1/operation/inbox?${params.toString()}`, {
          schema: pagedInboxSchema,
        });
        return { data, message: `${data.data.length} conversation(s) loaded.` };
      }),
  );

  register(
    server,
    "get_conversation",
    "Load a paginated message timeline. Conversation metadata comes from find_conversations.",
    {
      conversationId: idSchema,
      page: z.number().int().nonnegative().default(0),
      size: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    },
    readOnly,
    async (input) =>
      execute(async () => {
        const conversationId = idSchema.parse(input.conversationId);
        const page = z.number().int().nonnegative().parse(input.page);
        const size = z.number().int().min(1).max(MAX_PAGE_SIZE).parse(input.size);
        const data = await apiRequest(
          `/v1/conversations/${conversationId}/messages?page=${page}&size=${size}`,
          { schema: pagedMessagesSchema },
        );
        return {
          data: { conversationId, ...data },
          message: `${data.data.length} message(s) loaded.`,
        };
      }),
  );

  register(
    server,
    "reply_to_conversation",
    "Reply inside an Atendimento conversation. Accepted means queued, not delivered.",
    {
      conversationId: idSchema,
      body: z.string().trim().min(1).max(4096),
    },
    write,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/conversations/reply", {
          method: "POST",
          body: input,
          schema: mutationSchema,
          retry: false,
        }),
        message: "Reply accepted and queued for delivery.",
      })),
  );

  register(
    server,
    "claim_conversation",
    "Assign an unowned conversation to the authenticated operator.",
    { conversationId: idSchema },
    idempotentWrite,
    async (input) =>
      execute(async () => {
        const conversationId = idSchema.parse(input.conversationId);
        return {
          data: await apiRequest(`/v1/operation/inbox/${conversationId}/claim`, {
            method: "POST",
            body: {},
            schema: mutationSchema,
            retry: false,
          }),
          message: "Conversation claimed.",
        };
      }),
  );

  register(
    server,
    "close_conversation",
    "Close a conversation after its outcome and next step are resolved.",
    { conversationId: idSchema },
    destructive,
    async (input) =>
      execute(async () => {
        const conversationId = idSchema.parse(input.conversationId);
        return {
          data: await apiRequest(`/v1/conversations/${conversationId}/status`, {
            method: "PATCH",
            body: { status: "CLOSED" },
            schema: mutationSchema,
          }),
          message: "Conversation closed.",
        };
      }),
  );

  register(server, "list_automations", "List configured automations.", {}, readOnly, async () =>
    execute(async () => {
      const data = await apiRequest("/v1/automations", { schema: automationsSchema });
      return { data, message: `${data.length} automation(s) loaded.` };
    }),
  );

  register(
    server,
    "get_automation",
    "Inspect an automation's trigger, steps, cost and status.",
    { automationId: idSchema },
    readOnly,
    async (input) =>
      execute(async () => {
        const automationId = idSchema.parse(input.automationId);
        const data = await apiRequest(`/v1/automations/${automationId}`, {
          schema: automationSchema,
        });
        return { data, message: `Automation ${data.name} loaded.` };
      }),
  );

  register(
    server,
    "prepare_campaign",
    "Load campaign preflight: guidance, published Atendimento routines, approved templates and coverage.",
    {},
    readOnly,
    async () =>
      execute(async () => {
        const [copilot, routines, templates, coverage] = await Promise.all([
          apiRequest("/v1/operation/copilot/campaign", { schema: z.record(jsonValueSchema) }),
          apiRequest("/v1/operation/routines", { schema: routinesResponseSchema }),
          apiRequest("/v1/templates", { schema: templatesSchema }),
          apiRequest("/v1/operation/coverage", { schema: coverageSchema }),
        ]);
        return {
          data: {
            copilot,
            coverage,
            publishedRoutines: routines.data.filter((routine) => routine.published),
            approvedTemplates: templates.filter(
              (template) => template.providerStatus === "APPROVED" && template.availableForSending,
            ),
          },
          message: "Campaign preflight loaded. Review it before publishing.",
        };
      }),
  );

  const campaignContactSchema = z.object({
    to: e164Schema,
    variables: z.array(z.string().max(1024)).max(20).default([]),
  });
  register(
    server,
    "publish_campaign",
    "Publish a template campaign after validating its template and Atendimento destination routine.",
    {
      name: z.string().trim().min(1).max(255),
      templateName: z.string().trim().min(1),
      routineKey: routineKeySchema,
      contacts: z.array(campaignContactSchema).min(1).max(1000),
      sender: e164Schema.optional(),
      scheduledAt: z.string().datetime().optional(),
      idempotencyKey: z.string().uuid().optional(),
    },
    write,
    async (input) =>
      execute(async () => {
        const [routines, templates] = await Promise.all([
          apiRequest("/v1/operation/routines", { schema: routinesResponseSchema }),
          apiRequest("/v1/templates", { schema: templatesSchema }),
        ]);
        const routineKey = routineKeySchema.parse(input.routineKey);
        if (!routines.data.some((routine) => routine.key === routineKey && routine.published)) {
          throw new AraraError(
            "ROUTINE_NOT_PUBLISHED",
            `Atendimento routine '${routineKey}' is not published.`,
            409,
            false,
          );
        }
        if (
          !templates.some(
            (template) =>
              template.name === input.templateName &&
              template.providerStatus === "APPROVED" &&
              template.availableForSending,
          )
        ) {
          throw new AraraError(
            "TEMPLATE_NOT_AVAILABLE",
            `Template '${String(input.templateName)}' is not approved and available.`,
            409,
            false,
          );
        }
        const idempotencyKey =
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : randomUUID();
        const data = await apiRequest("/v1/campaigns", {
          method: "POST",
          body: {
            name: input.name,
            templateName: input.templateName,
            routineKey,
            contacts: input.contacts,
            ...(input.sender === undefined ? {} : { sender: input.sender }),
            ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
          },
          schema: campaignSchema,
          idempotencyKey,
        });
        return {
          data: { ...data, idempotencyKey },
          message: `Campaign '${data.name}' accepted with ${data.totalMessages} message(s).`,
        };
      }),
  );

  register(
    server,
    "send_whatsapp",
    "Send one WhatsApp text message to an E.164 number. Accepted means queued, not delivered.",
    {
      to: e164Schema,
      message: z.string().trim().min(1).max(4096),
      from: e164Schema.optional(),
      idempotencyKey: z.string().uuid().optional(),
    },
    write,
    async (input) =>
      execute(async () => {
        const idempotencyKey =
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : randomUUID();
        const data = await apiRequest("/v1/messages", {
          method: "POST",
          body: {
            receiver: input.to,
            body: input.message,
            type: "text",
            ...(input.from === undefined ? {} : { sender: input.from }),
          },
          schema: messageSchema,
          idempotencyKey,
        });
        return {
          data: { ...data, idempotencyKey },
          message: `Message ${data.id ?? "accepted"} queued. Use check_message to verify delivery.`,
        };
      }),
  );

  register(
    server,
    "check_message",
    "Check the provider delivery state for a message.",
    { messageId: idSchema },
    readOnly,
    async (input) =>
      execute(async () => {
        const messageId = idSchema.parse(input.messageId);
        return {
          data: await apiRequest(`/v1/messages/${messageId}`, { schema: mutationSchema }),
          message: "Message status loaded.",
        };
      }),
  );

  const contactSchema = z.object({
    name: z.string().trim().min(1).max(255),
    phone: e164Schema,
    email: z.string().email().max(255).optional(),
    attributes: z.record(jsonValueSchema).optional(),
  });
  register(
    server,
    "save_contacts",
    "Create or update contacts in one batch.",
    { contacts: z.array(contactSchema).min(1).max(1000) },
    idempotentWrite,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/contacts/batch", {
          method: "POST",
          body: input.contacts,
          schema: mutationSchema,
          retry: false,
        }),
        message: "Contact batch processed.",
      })),
  );

  register(
    server,
    "create_template",
    "Submit a WhatsApp template for Meta approval.",
    {
      name: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .max(512),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      body: z.string().trim().min(1).max(4096),
      language: z.string().default("pt_BR"),
      footer: z.string().max(60).optional(),
    },
    write,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/templates", {
          method: "POST",
          body: input,
          schema: templateSchema,
          retry: false,
        }),
        message: "Template submitted for approval.",
      })),
  );

  register(
    server,
    "get_template_status",
    "Check the Meta approval status for a template.",
    { templateId: idSchema },
    readOnly,
    async (input) =>
      execute(async () => {
        const templateId = idSchema.parse(input.templateId);
        return {
          data: await apiRequest(`/v1/templates/${templateId}/status`, {
            schema: mutationSchema,
          }),
          message: "Template status loaded.",
        };
      }),
  );

  register(
    server,
    "opt_out",
    "Record a WhatsApp opt-out and suppress future sends.",
    { phone: e164Schema, reason: z.string().trim().min(1).max(80).optional() },
    destructive,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/opt-outs", {
          method: "POST",
          body: input,
          schema: mutationSchema,
          retry: false,
        }),
        message: "Opt-out recorded.",
      })),
  );
};
