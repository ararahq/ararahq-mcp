import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerApiKeyTools = (server: McpServer) => {
  server.tool(
    "list_api_keys",
    "List all API keys for the current user. Shows id, name, mode (LIVE/TEST), scope, lastUsedAt, expiresAt.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/api-keys", {
          tokenOverride: apiKey,
          toolName: "list_api_keys",
        });
        const keys: any[] = response.data ?? [];
        if (keys.length === 0) return successResponse("No API keys yet.");
        const lines = keys.map((k: any) =>
          `- ${k.id} | ${k.name ?? "—"} | ${k.mode ?? "?"} | scope ${k.scope ?? "?"} | last used ${k.lastUsedAt ?? "never"}`,
        );
        return successResponse(`API Keys (${keys.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "create_api_key",
    "Create a new API key. The full token is shown ONCE in the response — save it immediately. Use scope READ for read-only, SEND for messaging + campaigns, ADMIN for everything.",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Descriptive name (e.g. 'WordPress', 'CI pipeline')"),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE"),
      scope: z.enum(["READ", "SEND", "ADMIN"]).optional().default("ADMIN"),
      expiresAt: z.string().optional().describe("ISO 8601 timestamp; omit for no expiration"),
      ipAllowlist: z.string().optional().describe("CSV of IPs or CIDR ranges. Business plan only."),
    },
    async ({ apiKey, name, mode, scope, expiresAt, ipAllowlist }) => {
      try {
        const response = await apiPost("/v1/api-keys", {
          name, scope, expiresAt, ipAllowlist,
        }, {
          tokenOverride: apiKey,
          params: { mode },
          toolName: "create_api_key",
        });
        const r = response.data ?? {};
        return successResponse([
          `API key created.`,
          `  ID:    ${r.id ?? "N/A"}`,
          `  Key:   ${r.key ?? r.apiKey ?? "—"}`,
          `  Mode:  ${r.mode ?? mode}`,
          `  Scope: ${r.scope ?? scope}`,
          ``,
          ` Save this key — it will not be shown again.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Create failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "rotate_api_key",
    "Rotate an API key: revokes the old one and returns a new one with the same name/scope. Use to handle key compromise without downtime — the new key is returned immediately.",
    {
      apiKey: z.string().optional(),
      keyId: z.string(),
    },
    async ({ apiKey, keyId }) => {
      try {
        const response = await apiPost(`/v1/api-keys/${keyId}/rotate`, {}, {
          tokenOverride: apiKey,
          toolName: "rotate_api_key",
        });
        const r = response.data ?? {};
        return successResponse([
          `Key rotated.`,
          `  New ID:  ${r.id ?? "N/A"}`,
          `  New Key: ${r.key ?? r.apiKey ?? "—"}`,
          ``,
          ` Replace usages of the old key immediately.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Rotate failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "revoke_api_key",
    "Permanently revoke an API key. Any caller using it gets 401 immediately. Cannot be undone — use rotate_api_key instead if you want a replacement.",
    {
      apiKey: z.string().optional(),
      keyId: z.string(),
    },
    async ({ apiKey, keyId }) => {
      try {
        await apiDelete(`/v1/api-keys/${keyId}`, {
          tokenOverride: apiKey,
          toolName: "revoke_api_key",
        });
        return successResponse(`Key ${keyId} revoked.`);
      } catch (error) {
        return errorResponse(`Revoke failed: ${extractError(error)}`);
      }
    },
  );
};
