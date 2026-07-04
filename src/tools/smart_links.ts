import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerSmartLinkTools = (server: McpServer) => {
  server.tool(
    "create_smart_link",
    "Cria um smart-link de WhatsApp (click-to-chat) RASTREÁVEL: um link curto + QR que abre a conversa no teu número já com um texto pronto. Cada clique é contado. Use pra bio, anúncio ou campanha quando quiser saber de onde o lead veio. (Diferente do botão SMART_LINK de template — este é um link avulso.)",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Nome interno do link, pra você identificar a origem (ex: 'bio-instagram')"),
      phoneNumber: z.string().describe("Número que recebe a conversa, em E.164 (ex: +5583991768778)"),
      defaultText: z
        .string()
        .optional()
        .describe("Texto que já vem preenchido pro cliente enviar, ex: 'Quero saber do plano'"),
      qrCodeColor: z.enum(["BLACK", "BLUE", "GREEN"]).optional().default("BLACK"),
    },
    async ({ apiKey, name, phoneNumber, defaultText, qrCodeColor }) => {
      try {
        const response = await apiPost(
          "/v1/smart-links/whatsapp",
          { name, phoneNumber, defaultText, qrCodeColor: qrCodeColor ?? "BLACK" },
          { tokenOverride: apiKey, toolName: "create_smart_link" },
        );
        const s: any = response.data ?? {};
        return successResponse(
          [
            `Smart-link criado: ${s.shortUrl ?? "N/A"}`,
            `  Nome:   ${s.name ?? name}`,
            `  Código: ${s.code ?? "N/A"}`,
            `  Abre conversa com: ${s.phoneNumber ?? phoneNumber}`,
            `  Cliques começam a contar agora — veja com list_smart_links.`,
          ].join("\n"),
        );
      } catch (error) {
        return errorResponse(`Não criei o smart-link: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_smart_links",
    "Lista os smart-links de WhatsApp da organização, com a contagem de cliques de cada um.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/smart-links/whatsapp", {
          tokenOverride: apiKey,
          toolName: "list_smart_links",
        });
        const items: any[] = Array.isArray(response.data) ? response.data : (response.data?.content ?? []);
        if (items.length === 0) return successResponse("Nenhum smart-link ainda.");
        const lines = items.map((s: any) => `• ${s.name}: ${s.shortUrl} — ${s.clicks ?? 0} cliques`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não listei os smart-links: ${extractError(error)}`);
      }
    },
  );
};
