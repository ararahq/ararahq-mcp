import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

const PHONE_E164 = /^\+[1-9]\d{6,14}$/;

export const registerOptOutTools = (server: McpServer) => {
  server.tool(
    "opt_out",
    "Registra que um cliente não quer mais receber mensagens desta organização. Idempotente — registrar duas vezes é seguro. Use quando o cliente responder PARAR/STOP, pedir no suporte ou por escrito. Obrigatório por LGPD: todo envio que atinge um contato em opt-out é violação. Pra conferir/listar opt-outs, leia o resource arara://opt-outs.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE_E164, "Telefone em E.164, ex: +5511999998888"),
      reason: z.string().max(80).optional().describe("Motivo, ex: 'respondeu PARAR', 'pediu no suporte', 'LGPD'"),
    },
    async ({ apiKey, phone, reason }) => {
      try {
        const response = await apiPost("/v1/opt-outs", { phone, reason }, {
          tokenOverride: apiKey,
          toolName: "opt_out",
        });
        const r = response.data ?? {};
        return successResponse([
          `Opt-out registrado pra ${phone}.`,
          `  Canal:      ${r.channel ?? "WHATSAPP"}`,
          `  Motivo:     ${r.reason ?? "-"}`,
          `  Registrado: ${r.createdAt ?? "agora"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Não registrei o opt-out: ${extractError(error)}`);
      }
    },
  );
};
