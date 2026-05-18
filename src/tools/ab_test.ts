import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerAbTestTools = (server: McpServer) => {
  server.tool(
    "create_ab_test",
    "Create an A/B test on a campaign. The campaign sends variant A to half of a small sample, variant B to the other half, then the winner gets the rest. Define which metric decides the winner (DELIVERED / READ / CLICKED / CONVERTED) and how long to wait before deciding. Set autopilot=true to auto-promote the winner.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string().describe("UUID of the campaign that will run the test"),
      variantATemplateName: z.string().describe("Approved template name for variant A"),
      variantBTemplateName: z.string().describe("Approved template name for variant B"),
      metric: z.enum(["DELIVERED", "READ", "CLICKED", "CONVERTED"]),
      samplePct: z.number().int().min(1).max(100).optional().default(20).describe("Percent of the audience to run the test on before promoting the winner"),
      splitPct: z.number().int().min(1).max(99).optional().default(50).describe("Percent of the sample that gets variant A"),
      decisionWindowMinutes: z.number().int().min(15).max(10_080).optional().default(240),
      autopilot: z.boolean().optional().default(false),
    },
    async ({ apiKey, campaignId, variantATemplateName, variantBTemplateName, metric, samplePct, splitPct, decisionWindowMinutes, autopilot }) => {
      try {
        const response = await apiPost(`/v1/campaigns/${campaignId}/ab-test`, {
          variantATemplateName, variantBTemplateName, metric,
          samplePct, splitPct, decisionWindowMinutes, autopilot,
        }, {
          tokenOverride: apiKey,
          toolName: "create_ab_test",
        });
        const t = response.data ?? {};
        return successResponse([
          `A/B test created on campaign ${campaignId}.`,
          `  Variant A:    ${t.variantATemplateName ?? variantATemplateName}`,
          `  Variant B:    ${t.variantBTemplateName ?? variantBTemplateName}`,
          `  Metric:       ${t.metric ?? metric}`,
          `  Sample:       ${t.samplePct ?? samplePct}% (split ${t.splitPct ?? splitPct}/${100 - (t.splitPct ?? splitPct)})`,
          `  Decide after: ${t.decisionWindowMinutes ?? decisionWindowMinutes} min`,
          `  Autopilot:    ${t.autopilot ?? autopilot}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`A/B test creation failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_ab_test",
    "Retrieve the current state of an A/B test on a campaign: variants, metric, winner (if decided), p-value, relative lift, per-variant metrics.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string(),
    },
    async ({ apiKey, campaignId }) => {
      try {
        const response = await apiGet(`/v1/campaigns/${campaignId}/ab-test`, {
          tokenOverride: apiKey,
          toolName: "get_ab_test",
        });
        const t = response.data ?? {};
        const lines = [
          `A/B test on campaign ${campaignId}:`,
          `  Variants:     A=${t.variantATemplateName} vs B=${t.variantBTemplateName}`,
          `  Metric:       ${t.metric}`,
          `  Winner:       ${t.winner ?? "undecided"} (${t.decidedReason ?? "running"})`,
          `  p-value:      ${t.pValue ?? "n/a"}`,
          `  Lift:         ${t.relativeLiftPct ?? "n/a"}%`,
          `  Created at:   ${t.createdAt ?? "?"}`,
          `  Decided at:   ${t.decidedAt ?? "still running"}`,
        ];
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`A/B test fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "force_ab_test_winner",
    "Manually declare a winner before the decision window closes. Use only when you have business reason that overrides the statistical signal. Marks decidedReason=FORCED_MANUAL.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string(),
      winner: z.enum(["A", "B"]),
    },
    async ({ apiKey, campaignId, winner }) => {
      try {
        await apiPost(`/v1/campaigns/${campaignId}/ab-test/winner`, { winner }, {
          tokenOverride: apiKey,
          toolName: "force_ab_test_winner",
        });
        return successResponse(`Winner forced to ${winner} on campaign ${campaignId}.`);
      } catch (error) {
        return errorResponse(`Winner force failed: ${extractError(error)}`);
      }
    },
  );
};
