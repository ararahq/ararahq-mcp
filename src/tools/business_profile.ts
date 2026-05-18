import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPatch, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerBusinessProfileTools = (server: McpServer) => {
  server.tool(
    "get_business_profile",
    "Read the WhatsApp Business Profile stored for this organization: display name, vertical, description, contact email, websites, business hours, profile photo, away message. This is what customers see when they tap the business name in WhatsApp. Source of truth lives locally and is pushed to Twilio (which forwards to Meta) on sync.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/organizations/me/business-profile", {
          tokenOverride: apiKey,
          toolName: "get_business_profile",
        });
        const p = response.data ?? {};
        const lines = [
          `Business profile:`,
          `  Display name:   ${p.displayName ?? "-"}`,
          `  Vertical:       ${p.vertical ?? "-"}`,
          `  About:          ${p.aboutShort ?? "-"}`,
          `  Description:    ${p.description ?? "-"}`,
          `  Email:          ${p.email ?? "-"}`,
          `  Websites:       ${(p.websites ?? []).join(", ") || "-"}`,
          `  Away message:   ${p.awayMessage ?? "-"}`,
          `  Photo URL:      ${p.profilePhotoUrl ?? "-"}`,
          `  Meta sync:      ${p.metaSyncStatus ?? "NOT_SYNCED"}`,
          p.metaSyncError ? `  Sync error:     ${p.metaSyncError}` : "",
        ].filter(Boolean);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Profile fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "update_business_profile",
    "Update the WhatsApp Business Profile fields locally. Pass only the fields you want to change — others remain. The local edit succeeds immediately; to publish to the actual WhatsApp sender(s), call sync_business_profile to push to Twilio (which forwards to Meta).",
    {
      apiKey: z.string().optional(),
      displayName: z.string().max(120).optional(),
      vertical: z.enum([
        "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN", "EVENT_PLAN",
        "FINANCE", "GROCERY", "GOVT", "HOTEL", "HEALTH", "NONPROFIT",
        "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT", "NOT_A_BIZ", "OTHER",
      ]).optional().describe("Meta-allowed business vertical. Passing anything else returns 400 INVALID_VERTICAL."),
      description: z.string().optional(),
      aboutShort: z.string().max(140).optional().describe("Short 'About' text shown under business name"),
      email: z.string().email().max(160).optional(),
      websites: z.array(z.string().url()).max(2).optional(),
      businessHours: z.record(z.unknown()).optional().describe("Free-form per-day map, e.g. {\"mon\": \"09:00-18:00\", \"sun\": \"closed\"}"),
      profilePhotoUrl: z.string().url().optional(),
      awayMessage: z.string().optional().describe("Auto-reply sent when no operator answers within X minutes"),
    },
    async ({ apiKey, ...patch }) => {
      try {
        const response = await apiPatch("/v1/organizations/me/business-profile", patch, {
          tokenOverride: apiKey,
          toolName: "update_business_profile",
        });
        const p = response.data ?? {};
        return successResponse([
          `Business profile updated.`,
          `  Display name: ${p.displayName ?? "-"}`,
          `  Meta sync:    ${p.metaSyncStatus ?? "PENDING"}`,
          `  Run sync_business_profile_with_meta to push immediately.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Profile update failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "sync_business_profile",
    "Push the local Business Profile to every active WhatsApp sender of this organization via Twilio Channels Senders API. Twilio forwards the update to Meta. Idempotent. Returns counts of senders updated and failed; status SYNCED when all senders accepted, PARTIAL when some failed, FAILED when all failed, NO_SENDER when there is no verified WhatsApp number to push to.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiPost("/v1/organizations/me/business-profile/sync", {}, {
          tokenOverride: apiKey,
          toolName: "sync_business_profile",
        });
        const d = response.data ?? {};
        const profile = d.profile ?? d;
        const pushed = d.twilioSendersPushed ?? 0;
        const failed = d.twilioSendersFailed ?? 0;
        const total = d.totalSenders ?? (pushed + failed);
        const lines = [
          `Profile sync via Twilio.`,
          `  Status:    ${profile.metaSyncStatus ?? "?"}`,
          `  Pushed:    ${pushed}/${total} sender(s)`,
          `  Failed:    ${failed}`,
          `  Synced at: ${profile.metaSyncedAt ?? "?"}`,
        ];
        if (profile.metaSyncError) lines.push(`  Note:      ${profile.metaSyncError}`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Sync failed: ${extractError(error)}`);
      }
    },
  );
};
