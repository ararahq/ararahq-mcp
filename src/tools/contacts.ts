import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerContactTools = (server: McpServer) => {
  server.tool(
    "save_contacts",
    "Salva (cria ou atualiza) contatos pra você mandar mensagem por nome em vez de número. Até 1000 de uma vez. Telefone em E.164 (+55...). Pra listar/ver contatos, leia o resource arara://contacts/recent.",
    {
      apiKey: z.string().optional(),
      contacts: z.array(z.object({
        name: z.string().max(255),
        phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Telefone em E.164, ex: +5511999998888"),
        email: z.string().max(255).optional(),
        attributes: z.record(z.unknown()).optional().describe("Atributos livres (qualquer JSON)"),
      })).min(1).max(1000),
    },
    async ({ apiKey, contacts }) => {
      try {
        const response = await apiPost("/v1/contacts/batch", contacts, {
          tokenOverride: apiKey,
          toolName: "save_contacts",
        });
        const r = response.data ?? {};
        const lines = [
          `Contatos salvos.`,
          `  Criados:      ${r.created ?? 0}`,
          `  Atualizados:  ${r.updated ?? 0}`,
          `  Ignorados:    ${r.skipped ?? 0}`,
        ];
        if (Array.isArray(r.errors) && r.errors.length > 0) {
          lines.push(``, `Erros (${r.errors.length}):`);
          for (const e of r.errors.slice(0, 10)) {
            lines.push(`  [${e.index}] ${e.phone ?? "?"} — ${e.reason}`);
          }
          if (r.errors.length > 10) lines.push(`  ... +${r.errors.length - 10} mais`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não salvei: ${extractError(error)}`);
      }
    },
  );
};
