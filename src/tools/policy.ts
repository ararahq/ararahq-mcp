import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerPolicyTools = (server: McpServer) => {
  server.tool(
    "list_policy_violations",
    "List policy violations reported by Meta against this organization or its templates. Each entry has type, severity (LOW/MEDIUM/HIGH/CRITICAL), description, source, and whether it has been resolved. Use unresolvedOnly=true to see what still needs action.",
    {
      apiKey: z.string().optional(),
      unresolvedOnly: z.boolean().optional().default(false),
    },
    async ({ apiKey, unresolvedOnly }) => {
      try {
        const response = await apiGet("/v1/policy-violations", {
          tokenOverride: apiKey,
          params: { unresolvedOnly },
          toolName: "list_policy_violations",
        });
        const items: any[] = response.data?.items ?? [];
        const unresolved = response.data?.unresolved ?? 0;
        if (items.length === 0) {
          return successResponse("No policy violations recorded. Account is in good standing.");
        }
        const lines = [`Policy violations (${items.length}, ${unresolved} unresolved):`, ``];
        for (const v of items) {
          const flag = v.resolvedAt ? "resolved" : "OPEN";
          lines.push(`- [${v.severity}] ${v.violationType} | ${flag} | ${v.createdAt ?? ""}`);
          if (v.description) lines.push(`  ${v.description}`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Violations list failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "resolve_policy_violation",
    "Mark a policy violation as resolved with an optional note. Use after you have audited content, removed the offending template, or completed the action Meta required.",
    {
      apiKey: z.string().optional(),
      violationId: z.string(),
      note: z.string().max(2_000).optional(),
    },
    async ({ apiKey, violationId, note }) => {
      try {
        await apiPost(`/v1/policy-violations/${violationId}/resolve`, { note }, {
          tokenOverride: apiKey,
          toolName: "resolve_policy_violation",
        });
        return successResponse(`Violation ${violationId} marked resolved.`);
      } catch (error) {
        return errorResponse(`Resolve failed: ${extractError(error)}`);
      }
    },
  );
};
