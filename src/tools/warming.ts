import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerWarmingTools = (server: McpServer) => {
  server.tool(
    "get_warming_plan",
    "Compute a warming plan for one WhatsApp number: how many daily sends are recommended given its current Quality Rating, Messaging Tier and days since verification. Use BEFORE a campaign to avoid overshooting the daily cap and damaging quality.",
    {
      apiKey: z.string().optional(),
      numberId: z.string().describe("UUID returned by list_numbers"),
    },
    async ({ apiKey, numberId }) => {
      try {
        const response = await apiGet(`/v1/organizations/me/numbers/${numberId}/warming`, {
          tokenOverride: apiKey,
          toolName: "get_warming_plan",
        });
        const w = response.data ?? {};
        const cap = w.dailyCapByTier === -1 ? "unlimited" : String(w.dailyCapByTier);
        const reco = w.recommendedDailySends === -1 ? "unlimited" : String(w.recommendedDailySends);
        return successResponse([
          `Warming plan for number ${numberId}:`,
          `  Quality:               ${w.qualityScore ?? "?"}`,
          `  Tier:                  ${w.messagingTier ?? "?"}`,
          `  Days since verified:   ${w.daysSinceVerified ?? 0}`,
          `  Daily cap (by tier):   ${cap}`,
          `  Recommended pace:      ${w.recommendedPacePct ?? 0}% of cap`,
          `  Recommended daily:     ${reco}`,
          `  Current daily average: ${w.currentDailyAverage ?? 0}`,
          ``,
          `Recommendation: ${w.recommendation ?? "-"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Warming plan failed: ${extractError(error)}`);
      }
    },
  );
};
