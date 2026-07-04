import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerCampaignTools = (server: McpServer) => {
  server.tool(
    "list_campaigns",
    "Lista as campanhas da organização (mais recentes primeiro), com status e contagens. Filtre por status opcional. Para o relatório completo de uma campanha (com cliques e conversões), use get_campaign.",
    {
      apiKey: z.string().optional(),
      status: z
        .string()
        .optional()
        .describe("Filtra por status: COMPLETED, AB_TESTING, INGESTING, CANCELED, FAILED, COMPLETED_WITH_ERRORS"),
      page: z.number().optional().default(0),
      size: z.number().optional().default(20),
    },
    async ({ apiKey, status, page, size }) => {
      try {
        const qs = new URLSearchParams();
        if (status) qs.set("status", status);
        qs.set("page", String(page ?? 0));
        qs.set("size", String(size ?? 20));
        const response = await apiGet(`/v1/campaigns?${qs.toString()}`, {
          tokenOverride: apiKey,
          toolName: "list_campaigns",
        });
        const content: any[] = response.data?.content ?? [];
        if (content.length === 0) return successResponse("Nenhuma campanha encontrada.");
        const lines = content.map((c: any) =>
          [
            `• ${c.name} [${c.status}]`,
            `  ${c.sentCount}/${c.totalMessages} enviadas · ${c.deliveredCount} entregues · ${c.readCount} lidas · R$ ${Number(
              c.totalCost ?? 0,
            ).toFixed(2)}`,
            `  id: ${c.id} · template: ${c.templateName}`,
          ].join("\n"),
        );
        return successResponse(lines.join("\n\n"));
      } catch (error) {
        return errorResponse(`Não listei as campanhas: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_campaign",
    "Relatório completo de uma campanha: enviados, entregues, lidos, CLIQUES, conversões e custo. É como você sabe qual copy performou — inclui o clique nos smart-links do template.",
    {
      apiKey: z.string().optional(),
      campaignId: z.string(),
    },
    async ({ apiKey, campaignId }) => {
      try {
        const response = await apiGet(`/v1/campaigns/${campaignId}`, {
          tokenOverride: apiKey,
          toolName: "get_campaign",
        });
        const c: any = response.data ?? {};
        const total = Number(c.totalMessages ?? 0);
        const pct = (n: number) => (total > 0 ? ` (${Math.round((Number(n) / total) * 100)}%)` : "");
        const lines = [
          `Campanha: ${c.name} [${c.status}]`,
          `  Template:   ${c.templateName}`,
          `  Total:      ${total}`,
          `  Enviadas:   ${c.sentCount ?? 0}${pct(c.sentCount ?? 0)}`,
          `  Entregues:  ${c.deliveredCount ?? 0}${pct(c.deliveredCount ?? 0)}`,
          `  Lidas:      ${c.readCount ?? 0}${pct(c.readCount ?? 0)}`,
          `  Cliques:    ${c.clickedCount ?? 0}${pct(c.clickedCount ?? 0)}`,
          `  Conversões: ${c.convertedCount ?? 0} — R$ ${Number(c.convertedValue ?? 0).toFixed(2)}`,
          `  Custo:      R$ ${Number(c.totalCost ?? 0).toFixed(2)}`,
        ];
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não peguei o relatório: ${extractError(error)}`);
      }
    },
  );
};
