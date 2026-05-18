import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerCampaignTools = (server: McpServer) => {
  server.tool(
    "create_campaign",
    "Create and dispatch a named template campaign to a list of contacts. Each contact can have its own positional variables. Returns the campaign ID and total cost. For a one-off batch without dashboard tracking, prefer send_template_to_many.",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Campaign name shown in dashboard"),
      templateName: z.string().describe("Approved template name (not ID)"),
      sender: z.string().optional().describe("Sender phone in E.164. Omit for organization default."),
      contacts: z.array(z.object({
        to: z.string().describe("Recipient phone in E.164"),
        variables: z.array(z.string()).optional().describe("Positional template variables"),
      })).min(1),
      idempotencyKey: z.string().optional().describe("Optional UUID/random key to safely retry on network errors without double-sending"),
    },
    async ({ apiKey, name, templateName, sender, contacts, idempotencyKey }) => {
      try {
        const payload: Record<string, unknown> = {
          name,
          templateName,
          contacts: contacts.map((c) => ({ to: c.to, variables: c.variables ?? [] })),
        };
        if (sender) payload.sender = sender;
        const response = await apiPost("/v1/campaigns", payload, {
          tokenOverride: apiKey,
          idempotencyKey,
          toolName: "create_campaign",
        });
        const c = response.data ?? {};
        return successResponse([
          `Campaign created.`,
          `  ID:           ${c.id ?? "N/A"}`,
          `  Name:         ${name}`,
          `  Template:     ${templateName}`,
          `  Contacts:     ${contacts.length}`,
          `  Total cost:   R$ ${Number(c.totalCost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Create failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_campaigns",
    "List campaigns with pagination. Shows status, template, sent count, and cost.",
    {
      apiKey: z.string().optional(),
      page: z.number().int().min(0).optional().default(0),
      size: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ apiKey, page, size }) => {
      try {
        const response = await apiGet("/v1/campaigns", {
          tokenOverride: apiKey,
          params: { page, size },
          toolName: "list_campaigns",
        });
        const items: any[] = response.data?.content ?? response.data?.data ?? response.data ?? [];
        if (items.length === 0) return successResponse("No campaigns found.");
        const lines = items.map((c: any) =>
          `- ${c.id} | ${c.name} | ${c.status} | ${c.templateName} | sent ${c.sentCount ?? 0}/${c.totalMessages ?? 0} | R$ ${Number(c.totalCost ?? 0).toFixed(2)}`,
        );
        return successResponse(`Campaigns (${items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_campaign",
    "Get full details of one campaign: status, counts (sent/delivered/read/clicked/converted), cost.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string(),
    },
    async ({ apiKey, campaignId }) => {
      try {
        const response = await apiGet(`/v1/campaigns/${campaignId}`, {
          tokenOverride: apiKey,
          toolName: "get_campaign",
        });
        const c = response.data ?? {};
        return successResponse([
          `Campaign ${campaignId}`,
          `  Name:        ${c.name ?? "N/A"}`,
          `  Status:      ${c.status ?? "N/A"}`,
          `  Template:    ${c.templateName ?? "N/A"}`,
          `  Total:       ${c.totalMessages ?? 0}`,
          `  Sent:        ${c.sentCount ?? 0}`,
          `  Delivered:   ${c.deliveredCount ?? 0}`,
          `  Read:        ${c.readCount ?? 0}`,
          `  Clicked:     ${c.clickedCount ?? 0}`,
          `  Converted:   ${c.convertedCount ?? 0}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Get failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "estimate_campaign_cost",
    "Preview the cost of a campaign before dispatching it. Helpful when budget is constrained.",
    {
      apiKey: z.string().optional(),
      templateName: z.string(),
      contactsCount: z.number().int().positive(),
    },
    async ({ apiKey, templateName, contactsCount }) => {
      try {
        const response = await apiGet("/v1/campaigns/estimate", {
          tokenOverride: apiKey,
          params: { templateName, contactsCount },
          toolName: "estimate_campaign_cost",
        });
        const e = response.data ?? {};
        return successResponse([
          `Estimate for ${contactsCount} sends of "${templateName}":`,
          `  Per message: R$ ${Number(e.perMessageCost ?? 0).toFixed(4)}`,
          `  Total:       R$ ${Number(e.totalCost ?? 0).toFixed(2)}`,
          `  Category:    ${e.category ?? "N/A"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Estimate failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "cancel_campaign",
    "Cancel a campaign that is still scheduled or in-flight. Already-sent messages cannot be recalled.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string(),
    },
    async ({ apiKey, campaignId }) => {
      try {
        await apiPost(`/v1/campaigns/${campaignId}/cancel`, {}, {
          tokenOverride: apiKey,
          toolName: "cancel_campaign",
        });
        return successResponse(`Campaign ${campaignId} cancelled. Sent messages are not recalled.`);
      } catch (error) {
        return errorResponse(`Cancel failed: ${extractError(error)}`);
      }
    },
  );
};
