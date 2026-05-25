import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

const PHONE_E164 = /^\+[1-9]\d{6,14}$/;

export const registerOptOutTools = (server: McpServer) => {
  server.tool(
    "register_opt_out",
    "Record that a customer has opted out of receiving WhatsApp messages from this organization. Idempotent — registering twice is safe. Use when the customer replies STOP/PARAR, fills a form, or asks verbally. Required for LGPD compliance: every outbound that hits an opted-out contact is a violation. Returns the stored record with timestamp.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE_E164, "Phone must be E.164, e.g. +5511999998888"),
      reason: z.string().max(80).optional().describe("Why they opted out, e.g. 'replied STOP', 'requested via support', 'GDPR delete'"),
    },
    async ({ apiKey, phone, reason }) => {
      try {
        const response = await apiPost("/v1/opt-outs", { phone, reason }, {
          tokenOverride: apiKey,
          toolName: "register_opt_out",
        });
        const r = response.data ?? {};
        return successResponse([
          `Opt-out recorded for ${phone}.`,
          `  Channel:   ${r.channel ?? "WHATSAPP"}`,
          `  Reason:    ${r.reason ?? "-"}`,
          `  Recorded:  ${r.createdAt ?? "now"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Opt-out registration failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "revoke_opt_out",
    "Remove a previously registered opt-out (the customer changed their mind, OR you got fresh consent through a new channel). The contact will receive messages again. Use sparingly — opt-outs exist for a reason; you should only revoke when the customer explicitly opts back in.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE_E164, "Phone must be E.164"),
    },
    async ({ apiKey, phone }) => {
      try {
        await apiDelete(`/v1/opt-outs/${encodeURIComponent(phone)}`, {
          tokenOverride: apiKey,
          toolName: "revoke_opt_out",
        });
        return successResponse(`Opt-out for ${phone} revoked. The contact can receive messages again.`);
      } catch (error) {
        return errorResponse(`Opt-out revocation failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "check_opt_out",
    "Check whether a specific phone is currently opted out from this organization. Cheap call — use before every send when in doubt. Returns optedOut: true/false.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE_E164, "Phone must be E.164"),
    },
    async ({ apiKey, phone }) => {
      try {
        const response = await apiGet(`/v1/opt-outs/${encodeURIComponent(phone)}`, {
          tokenOverride: apiKey,
          toolName: "check_opt_out",
        });
        const r = response.data ?? {};
        const flag = r.optedOut ? "YES" : "NO";
        return successResponse(`Opted out: ${flag} (${phone}, channel ${r.channel ?? "WHATSAPP"})`);
      } catch (error) {
        return errorResponse(`Opt-out check failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_opt_outs",
    "List every phone currently opted out from this organization, most recent first. Use for compliance audits or before exporting a campaign list.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/opt-outs", {
          tokenOverride: apiKey,
          toolName: "list_opt_outs",
        });
        const items: any[] = response.data?.items ?? [];
        if (items.length === 0) return successResponse("No opt-outs recorded.");
        const lines = items.map((o: any) =>
          `- ${o.phone} | ${o.channel ?? "?"} | reason: ${o.reason ?? "-"} | ${o.createdAt ?? ""}`,
        );
        return successResponse(`Opt-outs (${response.data?.total ?? items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );
};
