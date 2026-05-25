import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPut, apiPatch, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerRecoveryTools = (server: McpServer) => {
  server.tool(
    "get_recovery_endpoint",
    "Show the Arara recovery endpoint that your e-commerce platform should call (with code, signing secret, active flag). This is the URL your cart-abandonment / order events get sent to.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/recovery/endpoint", {
          tokenOverride: apiKey,
          toolName: "get_recovery_endpoint",
        });
        const e = response.data ?? {};
        return successResponse([
          `Recovery endpoint`,
          `  Code:    ${e.code ?? "N/A"}`,
          `  Active:  ${e.active ?? false}`,
          `  URL:     ${e.url ?? "N/A"}`,
          `  Secret:  ${e.secret ? "set (hidden)" : "—"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Endpoint failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "set_recovery_endpoint_active",
    "Toggle the recovery endpoint on/off without rotating the code. Use to pause incoming events temporarily.",
    {
      apiKey: z.string().optional(),
      active: z.boolean(),
    },
    async ({ apiKey, active }) => {
      try {
        await apiPatch("/v1/recovery/endpoint", { active }, {
          tokenOverride: apiKey,
          toolName: "set_recovery_endpoint_active",
        });
        return successResponse(`Recovery endpoint ${active ? "activated" : "paused"}.`);
      } catch (error) {
        return errorResponse(`Toggle failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_recovery_events",
    "List configured recovery events (cart_abandoned, order_placed, pix_pending, etc) and which template each one fires.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/recovery/events", {
          tokenOverride: apiKey,
          toolName: "list_recovery_events",
        });
        const events: any[] = response.data?.events ?? response.data ?? [];
        if (events.length === 0) return successResponse("No recovery events configured.");
        const lines = events.map((e: any) =>
          `- ${e.eventType} | template: ${e.templateName ?? "—"} | enabled: ${e.enabled ?? false} | delayMin: ${e.delayMinutes ?? 0}`,
        );
        return successResponse(`Recovery events (${events.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "configure_recovery_event",
    "Create or update a recovery event: which template fires, after how many minutes, and whether it is enabled. eventType examples: cart_abandoned, order_placed, pix_pending.",
    {
      apiKey: z.string().optional(),
      eventType: z.string().describe("Event identifier from your e-commerce platform"),
      templateName: z.string().describe("Approved template to send when event fires"),
      delayMinutes: z.number().int().min(0).optional().default(0),
      enabled: z.boolean().optional().default(true),
    },
    async ({ apiKey, eventType, templateName, delayMinutes, enabled }) => {
      try {
        await apiPut(`/v1/recovery/events/${eventType}`, {
          templateName, delayMinutes, enabled,
        }, {
          tokenOverride: apiKey,
          toolName: "configure_recovery_event",
        });
        return successResponse(`Recovery event "${eventType}" → template "${templateName}" (${enabled ? "enabled" : "disabled"}, +${delayMinutes}min).`);
      } catch (error) {
        return errorResponse(`Configure failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "test_recovery_event",
    "Fire a test ingest for one event type using your own phone and dummy variables. Lets you preview what the customer would receive without waiting for a real cart abandonment.",
    {
      apiKey: z.string().optional(),
      eventType: z.string(),
    },
    async ({ apiKey, eventType }) => {
      try {
        const response = await apiPost(`/v1/recovery/events/${eventType}/test`, {}, {
          tokenOverride: apiKey,
          toolName: "test_recovery_event",
        });
        const r = response.data ?? {};
        return successResponse([
          `Test ingest fired.`,
          `  Status:    ${r.status ?? "N/A"}`,
          `  Message:   ${r.messageId ?? "—"}`,
          `  Reason:    ${r.reason ?? "—"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Test failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_recovery_ingests",
    "List recent recovery ingests (events received from your e-commerce platform). Filter by eventType or status (PROCESSED/FAILED/SKIPPED).",
    {
      apiKey: z.string().optional(),
      event: z.string().optional(),
      status: z.enum(["PROCESSED", "FAILED", "SKIPPED", "DUPLICATE"]).optional(),
      page: z.number().int().min(0).optional().default(0),
      size: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ apiKey, event, status, page, size }) => {
      try {
        const params: Record<string, unknown> = { page, size };
        if (event) params.event = event;
        if (status) params.status = status;
        const response = await apiGet("/v1/recovery/ingests", {
          tokenOverride: apiKey,
          params,
          toolName: "list_recovery_ingests",
        });
        const items: any[] = response.data?.content ?? [];
        if (items.length === 0) return successResponse("No recovery ingests in this window.");
        const lines = items.map((i: any) =>
          `- ${i.internalId ?? i.id} | ${i.eventType ?? "?"} | ${i.status ?? "?"} | ${i.createdAt ?? ""}`,
        );
        return successResponse(`Ingests (${items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "retry_recovery_ingest",
    "Reprocess a failed recovery ingest. Useful when a previous failure was due to missing template approval or transient network issue.",
    {
      apiKey: z.string().optional(),
      ingestId: z.string(),
    },
    async ({ apiKey, ingestId }) => {
      try {
        const response = await apiPost(`/v1/recovery/ingests/${ingestId}/retry`, {}, {
          tokenOverride: apiKey,
          toolName: "retry_recovery_ingest",
        });
        const r = response.data ?? {};
        return successResponse(`Retry result: ${r.status ?? "N/A"} (${r.reason ?? "—"})`);
      } catch (error) {
        return errorResponse(`Retry failed: ${extractError(error)}`);
      }
    },
  );
};
