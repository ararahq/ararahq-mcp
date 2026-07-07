import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { Recipient, readBackendError, recipientLabel, resolveRecipient } from "../lib/recipients.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

type ConversationMessage = {
  direction?: string;
  body?: string;
  templateName?: string;
  createdAt?: string;
};

const isInbound = (direction?: string): boolean => (direction ?? "").toUpperCase() === "INBOUND";

const formatTimestamp = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
};

const formatMessage = (msg: ConversationMessage): string => {
  const who = isInbound(msg.direction) ? "cliente" : "você";
  const when = formatTimestamp(msg.createdAt);
  const text = msg.body?.trim() || (msg.templateName ? `[template ${msg.templateName}]` : "[sem conteúdo]");
  return `[${when}] ${who}: ${text}`;
};

export const registerConversationTools = (server: McpServer) => {
  server.tool(
    "read_conversation",
    "Lê o CONTEÚDO das mensagens trocadas com uma pessoa — o que ela realmente escreveu, direto da timeline de mensagens. NÃO depende de inbox, plano Pro, número dedicado nem do qualificador da Brain: lê a mensagem crua. É como você separa interesse real de auto-resposta de IA antes de julgar o lead. Passe o número (ou nome de contato salvo); o telefone aparece em cada item de arara://conversations/recent. Cada linha marca quem falou (cliente/você) e o horário.",
    {
      to: z.string().describe("Número (qualquer formato) ou nome de contato salvo. O telefone está em 'customerPhone' de arara://conversations/recent."),
      limit: z
        .number()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`Quantas mensagens trazer, mais recentes primeiro. Default ${DEFAULT_LIMIT}.`),
      apiKey: z.string().optional(),
    },
    async ({ to, limit, apiKey }) => {
      let recipient: Recipient | { error: string };
      try {
        recipient = await resolveRecipient(to, apiKey);
      } catch (error) {
        return errorResponse(`Não resolvi o destinatário: ${readBackendError(error).message}`);
      }
      if ("error" in recipient) return errorResponse(recipient.error);

      const label = recipientLabel(recipient);
      const size = limit ?? DEFAULT_LIMIT;
      try {
        const response = await apiGet(`/v1/contacts/${encodeURIComponent(recipient.phone)}/messages`, {
          tokenOverride: apiKey,
          params: { limit: size },
          toolName: "read_conversation",
        });
        const data = response.data ?? {};
        const messages: ConversationMessage[] = data.messages ?? [];
        if (messages.length === 0) {
          return successResponse(`Sem mensagens com ${label} ainda.`);
        }
        const inbound = messages.filter((m) => isInbound(m.direction)).length;
        const total = data.total ?? messages.length;
        const header = `Conversa com ${label} — ${total} mensagem(ns), ${inbound} do cliente (mais recentes primeiro):`;
        return successResponse([header, "", ...messages.map(formatMessage)].join("\n"));
      } catch (error) {
        return errorResponse(`Não li a conversa: ${readBackendError(error).message}`);
      }
    },
  );
};
