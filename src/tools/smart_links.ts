import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPut, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerSmartLinkTools = (server: McpServer) => {
  server.tool(
    "create_smart_link",
    "Create a trackable WhatsApp Smart Link. The user gets a short URL (e.g. ararahq.com/l/ABC); when clicked, it opens WhatsApp pre-filled with your default text targeting the configured phone. Each click is recorded for analytics. Diferencial Arara: replaces wa.me with click tracking + per-link QR code.",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Internal name for this link (e.g. 'Footer LP', 'Instagram bio')"),
      phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
      defaultText: z.string().optional().describe("Pre-filled message when the user opens WhatsApp"),
      qrCodeColor: z.enum(["BLACK", "BRAND"]).optional().default("BLACK"),
    },
    async ({ apiKey, name, phoneNumber, defaultText, qrCodeColor }) => {
      try {
        const response = await apiPost("/v1/smart-links/whatsapp", {
          name, phoneNumber, defaultText, qrCodeColor,
        }, {
          tokenOverride: apiKey,
          toolName: "create_smart_link",
        });
        const l = response.data ?? {};
        return successResponse([
          `Smart Link created.`,
          `  ID:        ${l.id ?? "N/A"}`,
          `  Name:      ${name}`,
          `  Short URL: ${l.shortUrl ?? "N/A"}`,
          `  Code:      ${l.code ?? "N/A"}`,
          `  Phone:     ${phoneNumber}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Create failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_smart_links",
    "List all Smart Links in the organization with click counts.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/smart-links/whatsapp", {
          tokenOverride: apiKey,
          toolName: "list_smart_links",
        });
        const links: any[] = response.data ?? [];
        if (links.length === 0) return successResponse("No Smart Links yet. Create one with create_smart_link.");
        const lines = links.map((l: any) =>
          `- ${l.id} | ${l.name} | ${l.shortUrl} | ${l.clicks ?? 0} clicks | phone ${l.phoneNumber}`,
        );
        return successResponse(`Smart Links (${links.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "update_smart_link",
    "Update a Smart Link's name, default text, or QR code color. Phone number cannot change after creation (delete + recreate if needed).",
    {
      apiKey: z.string().optional(),
      linkId: z.string(),
      name: z.string().optional(),
      defaultText: z.string().optional(),
      qrCodeColor: z.enum(["BLACK", "BRAND"]).optional(),
    },
    async ({ apiKey, linkId, name, defaultText, qrCodeColor }) => {
      try {
        const response = await apiPut(`/v1/smart-links/whatsapp/${linkId}`, {
          name, defaultText, qrCodeColor,
        }, {
          tokenOverride: apiKey,
          toolName: "update_smart_link",
        });
        const l = response.data ?? {};
        return successResponse(`Smart Link updated. ${l.shortUrl ?? linkId}`);
      } catch (error) {
        return errorResponse(`Update failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_smart_link_stats",
    "Click count and analytics for one Smart Link.",
    {
      apiKey: z.string().optional(),
      linkId: z.string(),
    },
    async ({ apiKey, linkId }) => {
      try {
        const response = await apiGet(`/v1/smart-links/whatsapp/${linkId}/stats`, {
          tokenOverride: apiKey,
          toolName: "get_smart_link_stats",
        });
        const s = response.data ?? {};
        return successResponse([
          `Smart Link ${linkId}`,
          `  Total clicks: ${s.totalClicks ?? 0}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Stats failed: ${extractError(error)}`);
      }
    },
  );
};
