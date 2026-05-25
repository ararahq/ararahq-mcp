import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerAccountTools = (server: McpServer) => {
  server.tool(
    "get_wallet_balance",
    "Show the current Arara wallet balance in BRL. Use to decide whether you can dispatch a campaign before estimating cost.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/dashboard/wallet/balance", {
          tokenOverride: apiKey,
          toolName: "get_wallet_balance",
        });
        const data = response.data ?? {};
        const balance = data.balance ?? data;
        return successResponse(`Wallet balance: R$ ${Number(balance).toFixed(2)}`);
      } catch (error) {
        return errorResponse(`Balance fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_organization_info",
    "Show the active organization: name, plan, current consumption, primary number.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/organizations/me/plan", {
          tokenOverride: apiKey,
          toolName: "get_organization_info",
        });
        return successResponse(`Organization:\n\n${JSON.stringify(response.data, null, 2)}`);
      } catch (error) {
        return errorResponse(`Org fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_delivery_metrics",
    "Aggregated delivery metrics: sent / delivered / read / failed counts + delivery rate over the recent window. Use to monitor overall health.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/dashboard/metrics", {
          tokenOverride: apiKey,
          toolName: "get_delivery_metrics",
        });
        const m = response.data ?? {};
        return successResponse([
          `Delivery metrics`,
          `  Sent:          ${m.sent ?? 0}`,
          `  Delivered:     ${m.delivered ?? 0}`,
          `  Read:          ${m.read ?? 0}`,
          `  Failed:        ${m.failed ?? 0}`,
          `  Pending:       ${m.pending ?? 0}`,
          `  Delivery rate: ${m.deliveryRate ?? m.delivery_rate ?? "N/A"}%`,
          `  Total spend:   R$ ${Number(m.totalCost ?? m.total_cost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Metrics fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_brain_metrics",
    "Metrics specific to Brain usage: interactions, suggestions accepted, handoff rate, token cost.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/dashboard/brain-metrics", {
          tokenOverride: apiKey,
          toolName: "get_brain_metrics",
        });
        return successResponse(`Brain metrics:\n\n${JSON.stringify(response.data, null, 2)}`);
      } catch (error) {
        return errorResponse(`Brain metrics failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_wallet_transactions",
    "Recent wallet transactions: recharges, debits per message, refunds.",
    {
      apiKey: z.string().optional(),
      page: z.number().int().min(0).optional().default(0),
      size: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ apiKey, page, size }) => {
      try {
        const response = await apiGet("/v1/wallet/transactions", {
          tokenOverride: apiKey,
          params: { page, size },
          toolName: "list_wallet_transactions",
        });
        const items: any[] = response.data?.content ?? response.data?.data ?? response.data ?? [];
        if (items.length === 0) return successResponse("No wallet transactions in this window.");
        const lines = items.map((t: any) =>
          `- ${t.createdAt ?? ""} | ${t.type ?? "?"} | R$ ${Number(t.amount ?? 0).toFixed(2)} | ${t.description ?? ""}`,
        );
        return successResponse(`Transactions (${items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`Transactions failed: ${extractError(error)}`);
      }
    },
  );
};
