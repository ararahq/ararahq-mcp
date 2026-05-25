import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerTemplateTools = (server: McpServer) => {
  server.tool(
    "list_templates",
    "List all templates owned by the organization. Each entry shows id, name, providerStatus (PENDING/APPROVED/REJECTED/PAUSED), category and language. Filter by name (substring) or status (exact provider status).",
    {
      apiKey: z.string().optional(),
      filterByName: z.string().optional().describe("Substring match on template name"),
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED"]).optional().describe("Filter by Meta provider status. PAUSED templates have been throttled by Meta due to low quality."),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ apiKey, filterByName, status, limit }) => {
      try {
        const params: Record<string, unknown> = { limit };
        if (filterByName) params.name = filterByName;
        if (status) params.status = status;
        const response = await apiGet("/v1/templates", {
          tokenOverride: apiKey,
          params,
          toolName: "list_templates",
        });
        const templates: any[] = response.data?.data ?? response.data ?? [];
        if (templates.length === 0) return successResponse("No templates found.");
        const lines = templates.map((t: any) =>
          `- ${t.id} | ${t.name} | ${t.providerStatus ?? t.status ?? "?"} | ${t.category ?? "?"} | ${t.language ?? "?"}`,
        );
        return successResponse(`Templates (${templates.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_paused_templates",
    "List templates currently PAUSED by Meta (quality throttling). A paused template cannot be used until Meta reviews. Use this as an early warning — paused templates usually mean recipients are reporting your messages, and account-level Quality Rating may follow.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/templates", {
          tokenOverride: apiKey,
          params: { status: "PAUSED" },
          toolName: "list_paused_templates",
        });
        const templates: any[] = response.data?.data ?? response.data ?? [];
        if (templates.length === 0) {
          return successResponse("No paused templates. Quality rating is likely healthy.");
        }
        const lines = templates.map((t: any) =>
          `- ${t.name} (${t.id}) | ${t.category ?? "?"} | ${t.language ?? "?"}`,
        );
        return successResponse([
          `Paused templates (${templates.length}):`,
          ``,
          lines.join("\n"),
          ``,
          `Action: review template content for compliance, check inbound complaints, and consider rotating to a fresh template. Audit Number Quality via get_number_health.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Paused list failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "create_template",
    "Submit a new WhatsApp template for Meta approval. Approval typically takes a few minutes. Use {{1}} {{2}} placeholders in body for positional variables.",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Unique template name (lowercase, underscores)"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      body: z.string().describe("Template body with positional placeholders like {{1}}, {{2}}"),
      language: z.string().optional().default("pt_BR"),
      header: z.string().optional().describe("Header text or media URL"),
      headerType: z.enum(["text", "media", "document"]).optional().describe("Defaults to 'text' when header is plain text"),
      footer: z.string().optional(),
      samples: z.record(z.string()).optional().describe("Variable examples keyed by index, e.g. {\"1\": \"John\"}"),
    },
    async ({ apiKey, name, category, body, language, header, headerType, footer, samples }) => {
      try {
        const payload: Record<string, unknown> = { name, category, body, language: language ?? "pt_BR" };
        if (header) {
          payload.header = header;
          payload.headerType = headerType ?? "text";
        }
        if (footer) payload.footer = footer;
        if (samples) payload.samples = samples;
        const response = await apiPost("/v1/templates", payload, {
          tokenOverride: apiKey,
          toolName: "create_template",
        });
        return successResponse([
          `Template submitted.`,
          `  ID:     ${response.data?.id ?? "N/A"}`,
          `  Name:   ${name}`,
          `  Status: ${response.data?.status ?? "PENDING"}`,
          `  Approval typically takes 1–5 minutes. Poll with get_template_status.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Create failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_template_status",
    "Check Meta approval status of a template (APPROVED / PENDING / REJECTED).",
    {
      apiKey: z.string().optional(),
      templateId: z.string(),
    },
    async ({ apiKey, templateId }) => {
      try {
        const response = await apiGet(`/v1/templates/${templateId}/status`, {
          tokenOverride: apiKey,
          toolName: "get_template_status",
        });
        const data = response.data ?? {};
        const status = data.status ?? (typeof data === "string" ? data : "UNKNOWN");
        const lines = [`Template ${templateId}: ${status}`];
        if (data.category) lines.push(`  Category:  ${data.category}`);
        if (data.rejectionReason) lines.push(`  Reason:    ${data.rejectionReason}`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Status failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_template_analytics",
    "Aggregated delivery metrics for a template: sent/delivered/read/failed counts and rates. Useful to decide whether to keep using or pause.",
    {
      apiKey: z.string().optional(),
      templateId: z.string(),
    },
    async ({ apiKey, templateId }) => {
      try {
        const response = await apiGet(`/v1/templates/${templateId}/analytics`, {
          tokenOverride: apiKey,
          toolName: "get_template_analytics",
        });
        const a = response.data ?? {};
        return successResponse([
          `Template Analytics — ${templateId}`,
          `  Sent:          ${a.sent ?? 0}`,
          `  Delivered:     ${a.delivered ?? 0}`,
          `  Read:          ${a.read ?? 0}`,
          `  Failed:        ${a.failed ?? 0}`,
          `  Delivery Rate: ${a.deliveryRate ?? a.delivery_rate ?? "N/A"}%`,
          `  Read Rate:     ${a.readRate ?? a.read_rate ?? "N/A"}%`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Analytics failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "delete_template",
    "Permanently delete an approved or rejected template. Cannot be undone. Templates currently in use by scheduled campaigns will continue to work for those sends.",
    {
      apiKey: z.string().optional(),
      templateId: z.string(),
    },
    async ({ apiKey, templateId }) => {
      try {
        await apiDelete(`/v1/templates/${templateId}`, {
          tokenOverride: apiKey,
          toolName: "delete_template",
        });
        return successResponse(`Template ${templateId} deleted.`);
      } catch (error) {
        return errorResponse(`Delete failed: ${extractError(error)}`);
      }
    },
  );
};
