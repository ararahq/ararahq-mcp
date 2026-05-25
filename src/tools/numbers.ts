import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPatch, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

const BASE = "/v1/organizations/me/numbers";

export const registerNumberTools = (server: McpServer) => {
  server.tool(
    "list_numbers",
    "List WhatsApp phone numbers assigned to the organization. Each row shows the WhatsApp Business Quality Score (HIGH/MEDIUM/LOW/FLAGGED), Messaging Tier (TIER_1K through TIER_UNLIMITED), default flag, and recent send volume. Use get_number_health for a deep read on one number.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet(BASE, {
          tokenOverride: apiKey,
          toolName: "list_numbers",
        });
        const numbers: any[] = response.data?.data ?? response.data ?? [];
        if (numbers.length === 0) return successResponse("No phone numbers assigned.");
        const lines = numbers.map((n: any) =>
          `- ${n.id ?? "?"} | ${n.phoneNumber ?? n.number ?? "?"} | alias: ${n.alias ?? "-"} | default: ${n.isDefault ? "yes" : "no"} | quality: ${n.qualityScore ?? "?"} | tier: ${n.messagingTier ?? "?"} | last 7d: ${n.messagesLast7d ?? 0}`,
        );
        return successResponse(`Numbers (${numbers.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_number_health",
    "Deep WhatsApp Business health check on one number: Meta Quality Rating (HIGH/MEDIUM/LOW/FLAGGED — affects daily quota and delivery), Messaging Tier (cap on daily unique recipients, set by Meta based on volume + quality), verification timestamp, last health refresh, and 7-day / 30-day send volume. Use this BEFORE running a large campaign to confirm the sender is healthy.",
    {
      apiKey: z.string().optional(),
      numberId: z.string().describe("UUID returned by list_numbers"),
    },
    async ({ apiKey, numberId }) => {
      try {
        const response = await apiGet(BASE, {
          tokenOverride: apiKey,
          toolName: "get_number_health",
        });
        const numbers: any[] = response.data?.data ?? response.data ?? [];
        const n = numbers.find((x: any) => x.id === numberId);
        if (!n) return errorResponse(`Number ${numberId} not found in this organization.`);
        const quality = String(n.qualityScore ?? "UNKNOWN");
        const tier = String(n.messagingTier ?? "UNKNOWN");
        const advisories: string[] = [];
        if (quality === "LOW" || quality === "FLAGGED") {
          advisories.push("Quality Rating is degraded. Meta will reduce daily quota. Audit recent template content and customer responses before sending more.");
        }
        if (tier === "TIER_1K" || tier === "UNKNOWN") {
          advisories.push("Messaging Tier is at the entry cap. Ramp up gradually (warming) to unlock higher tiers from Meta.");
        }
        const lines = [
          `Number ${n.phoneNumber ?? "?"} (${numberId})`,
          `  Alias:         ${n.alias ?? "-"}`,
          `  Default:       ${n.isDefault ? "yes" : "no"}`,
          `  Provider:      ${n.provider ?? "?"}`,
          `  Quality:       ${quality}`,
          `  Tier:          ${tier}`,
          `  Verified:      ${n.verifiedAt ?? "not verified"}`,
          `  Last health:   ${n.lastHealthCheckAt ?? "never"}`,
          `  Sent last 7d:  ${n.messagesLast7d ?? 0}`,
          `  Sent last 30d: ${n.messagesLast30d ?? 0}`,
        ];
        if (advisories.length > 0) {
          lines.push("", "Advisories:");
          for (const a of advisories) lines.push(`  - ${a}`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Health check failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "update_number",
    "Update alias or default-flag of a phone number.",
    {
      apiKey: z.string().optional(),
      numberId: z.string(),
      alias: z.string().optional(),
      isDefault: z.boolean().optional(),
    },
    async ({ apiKey, numberId, alias, isDefault }) => {
      try {
        const body: Record<string, unknown> = {};
        if (alias !== undefined) body.alias = alias;
        if (isDefault !== undefined) body.isDefault = isDefault;
        await apiPatch(`${BASE}/${numberId}`, body, {
          tokenOverride: apiKey,
          toolName: "update_number",
        });
        return successResponse(`Number ${numberId} updated.`);
      } catch (error) {
        return errorResponse(`Update failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "request_new_number",
    "Submit a request for a new WhatsApp number (Twilio or Meta). Arara ops reviews and provisions. Includes name/business details required by Meta.",
    {
      apiKey: z.string().optional(),
      requestedNumber: z.string().optional().describe("Specific number to request (E.164) if you have one in mind"),
      businessName: z.string(),
      reason: z.string().optional().describe("Why you need this number (optional, helps approval)"),
    },
    async ({ apiKey, requestedNumber, businessName, reason }) => {
      try {
        const response = await apiPost(`${BASE}/request`, {
          requestedNumber, businessName, reason,
        }, {
          tokenOverride: apiKey,
          toolName: "request_new_number",
        });
        const r = response.data ?? {};
        return successResponse([
          `Number request submitted.`,
          `  Request ID: ${r.id ?? "N/A"}`,
          `  Status:     ${r.status ?? "PENDING"}`,
          `  Track with list_number_requests.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Request failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_number_requests",
    "List all open and historical number-provisioning requests for this org.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet(`${BASE}/requests`, {
          tokenOverride: apiKey,
          toolName: "list_number_requests",
        });
        const items: any[] = response.data?.data ?? response.data ?? [];
        if (items.length === 0) return successResponse("No number requests yet.");
        const lines = items.map((r: any) =>
          `- ${r.id} | ${r.status} | requested ${r.requestedNumber ?? "?"} | created ${r.createdAt ?? ""}`,
        );
        return successResponse(`Number requests (${items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "sync_number_with_meta",
    "Force a sync of one number's profile (display name, photo, vertical) with Meta. Use after editing the profile in WhatsApp Business app.",
    {
      apiKey: z.string().optional(),
      numberId: z.string(),
    },
    async ({ apiKey, numberId }) => {
      try {
        await apiPost(`${BASE}/${numberId}/sync`, {}, {
          tokenOverride: apiKey,
          toolName: "sync_number_with_meta",
        });
        return successResponse(`Sync triggered for number ${numberId}.`);
      } catch (error) {
        return errorResponse(`Sync failed: ${extractError(error)}`);
      }
    },
  );
};
