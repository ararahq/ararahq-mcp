import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { guardian, getCustomRules } from "../lib/guardian.js";

export const registerMessagingTools = (server: McpServer) => {
  const interactiveSchema = z.object({
    type: z.enum(["list", "button"]),
    body: z.string(),
    buttonText: z.string().optional().describe("Required when type=list — label shown to open the list"),
    sections: z.array(z.object({
      title: z.string(),
      rows: z.array(z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
      })),
    })).optional().describe("Required when type=list — up to 10 rows total across all sections"),
    buttons: z.array(z.object({
      id: z.string(),
      title: z.string(),
    })).max(3).optional().describe("Required when type=button — up to 3 quick-reply buttons"),
  });

  const locationSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  });

  const reactionSchema = z.object({
    emoji: z.string().min(1).max(8).describe("Single emoji character to react with (max 8 bytes — WhatsApp accepts one grapheme)"),
    messageId: z.string().describe("Internal ID of the message you are reacting to"),
  });

  server.tool(
    "send_message",
    "Send a single WhatsApp message. Choose exactly one of: text (session message, needs open 24h window), template (always allowed), interactive (list or button, needs open window), location, or reaction. Use replyTo to quote a previous message. For 2+ recipients with the same template, use send_template_to_many.",
    {
      apiKey: z.string().optional().describe("Arara API key. Falls back to ARARA_API_KEY env var."),
      to: z.string().describe("Recipient phone in E.164, e.g. +5511999999999"),
      text: z.string().optional().describe("Free text body (session message, requires open 24h window)"),
      templateName: z.string().optional().describe("Approved template name"),
      templateVariables: z.array(z.string()).optional().describe("Positional template variables, e.g. [\"John\", \"R$ 99,90\"]"),
      interactive: interactiveSchema.optional().describe("Interactive list or button payload (session message)"),
      location: locationSchema.optional().describe("Location pin payload"),
      reaction: reactionSchema.optional().describe("React to a previous message with an emoji"),
      replyTo: z.string().optional().describe("Internal ID of the message being quoted in this reply"),
      sender: z.string().optional().describe("Sender phone in E.164. Omit to use organization default."),
      skipGuardian: z.boolean().optional().default(false).describe("Bypass Guardian content checks. Use only for system messages."),
    },
    async ({ apiKey, to, text, templateName, templateVariables, interactive, location, reaction, replyTo, sender, skipGuardian }) => {
      const provided = [
        !!text, !!templateName, !!interactive, !!location, !!reaction,
      ].filter(Boolean).length;
      if (provided === 0) {
        return errorResponse("Provide exactly one of: text, templateName, interactive, location, reaction.");
      }
      if (provided > 1) {
        return errorResponse("Provide exactly one of: text, templateName, interactive, location, reaction — not multiple.");
      }
      if (!skipGuardian) {
        const checks: string[] = [];
        if (text) checks.push(text);
        if (templateVariables) checks.push(...templateVariables);
        if (interactive) {
          checks.push(interactive.body);
          if (interactive.buttonText) checks.push(interactive.buttonText);
          for (const s of interactive.sections ?? []) {
            checks.push(s.title);
            for (const r of s.rows) {
              checks.push(r.title);
              if (r.description) checks.push(r.description);
            }
          }
          for (const b of interactive.buttons ?? []) checks.push(b.title);
        }
        if (location?.name) checks.push(location.name);
        if (location?.address) checks.push(location.address);
        const customRules = getCustomRules();
        for (const value of checks) {
          const check = guardian(value, customRules);
          if (!check.safe) return errorResponse(`GUARDIAN BLOCKED: ${check.reason}`);
        }
      }
      try {
        const body: Record<string, unknown> = { receiver: to };
        if (sender) body.sender = sender;
        if (replyTo) body.replyTo = replyTo;
        if (text) {
          body.body = text;
          body.type = "text";
        } else if (templateName) {
          body.templateName = templateName;
          body.type = "template";
          if (templateVariables) body.templateVariables = templateVariables;
        } else if (interactive) {
          body.interactive = interactive;
          body.type = "interactive";
        } else if (location) {
          body.location = location;
          body.type = "location";
        } else if (reaction) {
          body.reaction = reaction;
          body.type = "reaction";
        }
        const response = await apiPost("/v1/messages", body, {
          tokenOverride: apiKey,
          toolName: "send_message",
        });
        const data = response.data ?? {};
        return successResponse([
          `Message accepted.`,
          `  ID:       ${data.id ?? "N/A"}`,
          `  Status:   ${data.status ?? "ACCEPTED"}`,
          `  To:       ${to}`,
          `  Cost:     R$ ${Number(data.cost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Send failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "send_template_to_many",
    "Send the same approved template to up to 1000 recipients in a single batch. Each recipient can carry its own positional variables. For a scheduled, named, dashboard-tracked send, use create_campaign instead.",
    {
      apiKey: z.string().optional(),
      templateName: z.string().describe("Approved template name applied to all messages in the batch"),
      messages: z.array(z.object({
        to: z.string().describe("Recipient phone in E.164"),
        variables: z.array(z.string()).optional().describe("Positional variables for this recipient"),
      })).min(1).max(1000),
      skipGuardian: z.boolean().optional().default(false),
    },
    async ({ apiKey, templateName, messages, skipGuardian }) => {
      if (!skipGuardian) {
        const customRules = getCustomRules();
        for (const m of messages) {
          for (const v of m.variables ?? []) {
            const check = guardian(v, customRules);
            if (!check.safe) {
              return errorResponse(`GUARDIAN on ${m.to}: ${check.reason}. Batch blocked.`);
            }
          }
        }
      }
      try {
        const response = await apiPost("/v1/messages/batch", {
          templateName,
          messages: messages.map((m) => ({
            receiver: m.to,
            templateVariables: m.variables ?? [],
          })),
        }, {
          tokenOverride: apiKey,
          toolName: "send_template_to_many",
        });
        const data = response.data ?? {};
        return successResponse([
          `Batch dispatched.`,
          `  Batch ID:  ${data.batchId ?? "N/A"}`,
          `  Template:  ${templateName}`,
          `  Total:     ${data.total ?? messages.length}`,
          `  Accepted:  ${data.accepted ?? 0}`,
          `  Cost:      R$ ${Number(data.totalCost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Batch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_message_status",
    "Retrieve the current delivery status of a single message by its internal ID. Returns status (ACCEPTED/SENT/DELIVERED/READ/FAILED), body, cost, and timing.",
    {
      apiKey: z.string().optional(),
      messageId: z.string().describe("Internal message ID returned by send_message"),
    },
    async ({ apiKey, messageId }) => {
      try {
        const response = await apiGet(`/v1/messages/${messageId}`, {
          tokenOverride: apiKey,
          toolName: "get_message_status",
        });
        const m = response.data ?? {};
        const icons: Record<string, string> = { DELIVERED: "", READ: "", SENT: "", FAILED: "", PENDING: "⏳", ACCEPTED: "" };
        return successResponse([
          `${icons[m.status] ?? ""} Message ${messageId}`,
          `  Status:   ${m.status ?? "N/A"}`,
          `  To:       ${m.receiver ?? "N/A"}`,
          `  Body:     ${m.body ?? "N/A"}`,
          `  Cost:     R$ ${Number(m.cost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Lookup failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_messages",
    "List recent messages with pagination. Useful for auditing recent sends, debugging failures, or reviewing activity.",
    {
      apiKey: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(0).optional().default(0),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE"),
    },
    async ({ apiKey, limit, page, mode }) => {
      try {
        const response = await apiGet("/dashboard/messages", {
          tokenOverride: apiKey,
          params: { limit, page, mode },
          toolName: "list_messages",
        });
        const messages: any[] = response.data?.data ?? response.data ?? [];
        if (messages.length === 0) return successResponse("No messages in this window.");
        const lines = messages.map((m: any) =>
          `- ${m.id} | ${m.receiver ?? m.to ?? "?"} | ${m.status ?? "?"} | ${m.createdAt ?? ""}`,
        );
        return successResponse(`Messages (${messages.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );
};
