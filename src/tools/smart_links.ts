import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerSmartLinkTools = (server: McpServer) => {
  server.tool(
    "create_smart_link",
    "Cria um smart-link de WhatsApp (click-to-chat) RASTREÁVEL: um link curto + QR que abre a conversa no teu número já com um texto pronto. Cada clique é contado. Use pra bio, anúncio ou campanha quando quiser saber de onde o lead veio. Destino é sempre um NÚMERO (abre o WhatsApp). Pra encurtar uma URL qualquer (site, landing, utm) num link rastreável, use create_short_link.",
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

  server.tool(
    "create_short_link",
    "Encurta QUALQUER URL (site, landing page, link com utm) num link curto RASTREÁVEL: ararahq.com/l/CÓDIGO que redireciona pro destino e conta cada clique. Use pra bio, anúncio, ou pra medir tráfego de uma campanha externa. Diferente do create_smart_link, que abre o WhatsApp num número — aqui o destino é uma URL.",
    {
      apiKey: z.string().optional(),
      url: z.string().describe("URL de destino completa, com http:// ou https:// (ex: https://ararahq.com/?utm_source=bio)."),
      name: z.string().optional().describe("Nome interno pra identificar a origem (ex: 'bio-instagram'). Opcional."),
    },
    async ({ apiKey, url, name }) => {
      try {
        const response = await apiPost(
          "/v1/short-links",
          { url, name },
          { tokenOverride: apiKey, toolName: "create_short_link" },
        );
        const s: any = response.data ?? {};
        return successResponse(
          [
            `Link curto criado: ${s.shortUrl ?? "N/A"}`,
            `  Destino: ${s.originalUrl ?? url}`,
            name ? `  Nome:    ${s.name ?? name}` : undefined,
            `  Código:  ${s.code ?? "N/A"}`,
            `  Cliques começam a contar agora — veja com list_short_links.`,
          ].filter(Boolean).join("\n"),
        );
      } catch (error) {
        return errorResponse(`Não criei o link curto: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_short_links",
    "Lista os links curtos de URL da organização (os criados com create_short_link), com o destino e a contagem de cliques de cada um.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/short-links", {
          tokenOverride: apiKey,
          toolName: "list_short_links",
        });
        const items: any[] = Array.isArray(response.data) ? response.data : (response.data?.content ?? []);
        if (items.length === 0) return successResponse("Nenhum link curto ainda.");
        const lines = items.map(
          (s: any) => `• ${s.name ?? s.code}: ${s.shortUrl} → ${s.originalUrl} — ${s.clicks ?? 0} cliques`,
        );
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não listei os links curtos: ${extractError(error)}`);
      }
    },
  );
};
