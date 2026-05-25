import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerPricingTools = (server: McpServer) => {
  server.tool(
    "get_pricing",
    "Current WhatsApp send pricing for this organization, in BRL per message. Returns custom org pricing where defined and falls back to global defaults. Use BEFORE running a large campaign to confirm budget — pricing is per message, not per conversation.",
    {
      apiKey: z.string().optional(),
      countryPrefix: z.string().optional().describe("Optional country code filter, e.g. '55' for Brazil"),
    },
    async ({ apiKey, countryPrefix }) => {
      try {
        const response = await apiGet("/v1/pricing/current", {
          tokenOverride: apiKey,
          params: countryPrefix ? { countryPrefix } : undefined,
          toolName: "get_pricing",
        });
        const r = response.data ?? {};
        const categories: any[] = r.categories ?? [];
        const countries: any[] = r.countries ?? [];
        const lines: string[] = [
          `Pricing model: ${r.model ?? "PER_MESSAGE"} (${r.currency ?? "BRL"})`,
          ``,
        ];
        if (categories.length > 0) {
          lines.push(`Per-message price by category:`);
          for (const c of categories) {
            lines.push(`  ${c.category.padEnd(20)} R$ ${Number(c.priceBrl).toFixed(4)}  [${c.source}]`);
          }
          lines.push(``);
        } else {
          lines.push(`No category prices configured.`, ``);
        }
        if (countries.length > 0) {
          lines.push(`Country base costs (Meta-side, USD):`);
          for (const c of countries.slice(0, 25)) {
            lines.push(`  +${c.countryPrefix} ${c.countryName} (${c.category}): US$ ${Number(c.baseCostUsd).toFixed(6)}`);
          }
          if (countries.length > 25) lines.push(`  ... +${countries.length - 25} more (filter by countryPrefix to narrow)`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Pricing fetch failed: ${extractError(error)}`);
      }
    },
  );
};
