import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, extractError } from "../lib/api.js";

const safeJson = (data: unknown): string => {
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
};

const errorContent = (uri: URL, error: unknown) => ({
  contents: [{
    uri: uri.toString(),
    mimeType: "text/plain",
    text: `Failed to load resource: ${extractError(error)}`,
  }],
});

export const registerAllResources = (server: McpServer): void => {
  server.registerResource(
    "organization",
    "arara://organization/me",
    {
      title: "Current organization",
      description: "Name, plan, consumption, primary number of the authenticated org. Read this before any decision that depends on plan limits.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/v1/organizations/me/plan", { toolName: "resource:org" });
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson(response.data),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "wallet_balance",
    "arara://wallet/balance",
    {
      title: "Wallet balance",
      description: "Current wallet balance in BRL. Refresh before estimating campaign cost or running batches.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/dashboard/wallet/balance", { toolName: "resource:wallet" });
        const data = response.data ?? {};
        const balance = data.balance ?? data;
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson({ balanceBrl: Number(balance) }),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "templates_approved",
    "arara://templates/approved",
    {
      title: "Approved templates",
      description: "All templates ready to use (status APPROVED). Use this to pick a templateName for send_message or create_campaign without listing manually.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/v1/templates", {
          params: { limit: 100 },
          toolName: "resource:templates",
        });
        const all: any[] = response.data?.data ?? response.data ?? [];
        const approved = all.filter((t: any) => t.status === "APPROVED");
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson(approved.map((t: any) => ({
              id: t.id,
              name: t.name,
              category: t.category,
              language: t.language,
            }))),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "numbers",
    "arara://numbers",
    {
      title: "WhatsApp numbers",
      description: "Numbers assigned to this org with status and default flag. Useful to pick a `sender` for send_message.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/v1/organizations/me/numbers", { toolName: "resource:numbers" });
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson(response.data),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "numbers_health",
    "arara://numbers/health",
    {
      title: "Numbers health snapshot",
      description: "Quality Rating, Messaging Tier and recent volume for every number, with advisories when a number is degraded or capped. Read this before dispatching a large campaign.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/v1/organizations/me/numbers", { toolName: "resource:numbers_health" });
        const numbers: any[] = response.data?.data ?? response.data ?? [];
        const summary = numbers.map((n: any) => {
          const quality = String(n.qualityScore ?? "UNKNOWN");
          const tier = String(n.messagingTier ?? "UNKNOWN");
          const advisories: string[] = [];
          if (quality === "LOW" || quality === "FLAGGED") {
            advisories.push("quality_degraded");
          }
          if (tier === "TIER_1K" || tier === "UNKNOWN") {
            advisories.push("low_tier_warming_needed");
          }
          return {
            id: n.id,
            phoneNumber: n.phoneNumber,
            alias: n.alias,
            isDefault: n.isDefault,
            qualityScore: quality,
            messagingTier: tier,
            verifiedAt: n.verifiedAt,
            lastHealthCheckAt: n.lastHealthCheckAt,
            messagesLast7d: n.messagesLast7d ?? 0,
            messagesLast30d: n.messagesLast30d ?? 0,
            advisories,
          };
        });
        const degraded = summary.filter((s) => s.advisories.length > 0).length;
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson({
              totalNumbers: summary.length,
              degraded,
              numbers: summary,
            }),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "campaigns_recent",
    "arara://campaigns/recent",
    {
      title: "Recent campaigns",
      description: "Latest 10 campaigns with status and counts. Use to summarize recent activity without calling list_campaigns.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const response = await apiGet("/v1/campaigns", {
          params: { page: 0, size: 10 },
          toolName: "resource:campaigns",
        });
        const items: any[] = response.data?.content ?? response.data?.data ?? response.data ?? [];
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson(items.map((c: any) => ({
              id: c.id,
              name: c.name,
              status: c.status,
              templateName: c.templateName,
              sent: c.sentCount ?? 0,
              total: c.totalMessages ?? 0,
              cost: Number(c.totalCost ?? 0),
            }))),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );

  server.registerResource(
    "recovery_funnel",
    "arara://recovery/funnel",
    {
      title: "Recovery funnel snapshot",
      description: "Recent recovery ingests grouped by status (PROCESSED/FAILED/SKIPPED). Quick read of how the Arara Recovery feature is performing this week.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const [endpoint, ingests] = await Promise.all([
          apiGet("/v1/recovery/endpoint", { toolName: "resource:recovery" }),
          apiGet("/v1/recovery/ingests", { params: { page: 0, size: 100 }, toolName: "resource:recovery" }),
        ]);
        const items: any[] = ingests.data?.content ?? [];
        const grouped: Record<string, number> = {};
        for (const it of items) {
          const status = it.status ?? "UNKNOWN";
          grouped[status] = (grouped[status] ?? 0) + 1;
        }
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: "application/json",
            text: safeJson({
              endpoint: {
                active: endpoint.data?.active,
                code: endpoint.data?.code,
              },
              recentIngests: {
                total: items.length,
                byStatus: grouped,
              },
            }),
          }],
        };
      } catch (error) {
        return errorContent(uri, error);
      }
    },
  );
};
