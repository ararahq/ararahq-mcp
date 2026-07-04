import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerTemplateTools = (server: McpServer) => {
  server.tool(
    "create_template",
    "Submete um template novo pra aprovação da Meta. Use quando a janela de 24h está fechada e você precisa de uma mensagem com texto fixo aprovado. Aprovação costuma levar alguns minutos. Use {{1}} {{2}} no corpo pra variáveis. Pra ver os templates que você já tem, leia o resource arara://templates/approved.",
    {
      apiKey: z.string().optional(),
      name: z.string().describe("Nome único do template (minúsculo, com underscores)"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      body: z.string().describe("Corpo do template com placeholders posicionais tipo {{1}}, {{2}}"),
      language: z.string().optional().default("pt_BR"),
      header: z.string().optional().describe("Texto do cabeçalho ou URL de mídia"),
      headerType: z.enum(["text", "media", "document"]).optional().describe("Default 'text' quando o header é texto"),
      footer: z.string().optional(),
      samples: z.record(z.string()).optional().describe("Exemplos de variável por índice, ex: {\"1\": \"João\"}"),
      buttons: z
        .array(
          z.object({
            type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER", "SMART_LINK", "COPY_CODE"]),
            text: z.string().describe("Rótulo do botão"),
            url: z
              .string()
              .optional()
              .describe(
                "URL do botão. Para SMART_LINK, é o DESTINO real (ex: https://wa.me/5583999999999?text=Oi) — a Arara encurta e conta cada clique no relatório da campanha.",
              ),
            phone: z.string().optional().describe("Número E.164, só para PHONE_NUMBER"),
          }),
        )
        .max(2)
        .optional()
        .describe("Até 2 botões. Use SMART_LINK para link rastreável (o clique aparece no get_campaign)."),
    },
    async ({ apiKey, name, category, body, language, header, headerType, footer, samples, buttons }) => {
      try {
        const payload: Record<string, unknown> = { name, category, body, language: language ?? "pt_BR" };
        if (header) {
          payload.header = header;
          payload.headerType = headerType ?? "text";
        }
        if (footer) payload.footer = footer;
        if (samples) payload.samples = samples;
        if (buttons && buttons.length > 0) payload.buttons = buttons;
        const response = await apiPost("/v1/templates", payload, {
          tokenOverride: apiKey,
          toolName: "create_template",
        });
        return successResponse([
          `Template submetido.`,
          `  ID:     ${response.data?.id ?? "N/A"}`,
          `  Nome:   ${name}`,
          `  Status: ${response.data?.status ?? "PENDING"}`,
          `  Aprovação leva 1–5 minutos. Acompanhe com get_template_status.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Não submeti: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_template_status",
    "Confere o status de aprovação de um template na Meta (APPROVED / PENDING / REJECTED).",
    {
      apiKey: z.string().optional(),
      templateId: z.string(),
    },
    async ({ apiKey, templateId }) => {
      try {
        const response = await apiGet(`/v1/templates/${templateId}/status`, {
          tokenOverride: apiKey,
          toolName: "get_template_status",
        });
        const data = response.data ?? {};
        const status = data.status ?? (typeof data === "string" ? data : "UNKNOWN");
        const lines = [`Template ${templateId}: ${status}`];
        if (data.category) lines.push(`  Categoria: ${data.category}`);
        if (data.rejectionReason) lines.push(`  Motivo:    ${data.rejectionReason}`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não consegui o status: ${extractError(error)}`);
      }
    },
  );
};
