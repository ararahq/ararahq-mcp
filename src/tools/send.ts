import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiGet, apiPost } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { guardian, getCustomRules } from "../lib/guardian.js";

const WINDOW_CLOSED_HINTS = ["janela de 24h", "envie um template", "nenhuma conversa iniciada"];
const APPROVED_STATUS = "APPROVED";
const MAX_BROADCAST = 1000;

type BackendError = { status?: number; message: string };

const readBackendError = (error: unknown): BackendError => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined;
    const message = (data?.message as string) || (data?.error as string) || error.message;
    return { status: error.response?.status, message };
  }
  return { message: String(error) };
};

const isWindowClosed = (err: BackendError): boolean => {
  if (err.status !== 422) return false;
  const lower = err.message.toLowerCase();
  return WINDOW_CLOSED_HINTS.some((hint) => lower.includes(hint));
};

const looksLikePhone = (value: string): boolean => /^[+\d][\d\s().-]{7,}$/.test(value.trim());

const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length >= 12 && digits.startsWith("55")) {
    const withoutCountry = digits.slice(2);
    if (withoutCountry.length === 10) {
      const ddd = withoutCountry.slice(0, 2);
      const rest = withoutCountry.slice(2);
      return `+55${ddd}9${rest}`;
    }
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
};

type Recipient = { phone: string; name?: string };

const recipientLabel = (recipient: Recipient): string =>
  recipient.name ? `${recipient.phone} (${recipient.name})` : recipient.phone;

const resolveRecipient = async (
  to: string,
  apiKey?: string,
): Promise<Recipient | { error: string }> => {
  if (looksLikePhone(to)) return { phone: normalizePhone(to) };
  const response = await apiGet("/v1/contacts", {
    tokenOverride: apiKey,
    params: { q: to, page: 0, size: 5 },
    toolName: "send_whatsapp",
  });
  const contacts: Array<{ name?: string; phone?: string }> = response.data?.contacts ?? [];
  const named = contacts.filter((c) => c.phone);
  if (named.length === 0) {
    return { error: `Não achei nenhum contato chamado "${to}". Passe o número direto ou salve o contato com save_contacts.` };
  }
  if (named.length > 1) {
    const options = named.map((c) => `${c.name} (${c.phone})`).join(", ");
    return { error: `"${to}" casa com mais de um contato: ${options}. Use o número específico.` };
  }
  return { phone: normalizePhone(named[0].phone!), name: named[0].name };
};

const fetchApprovedTemplateNames = async (apiKey?: string): Promise<string[]> => {
  try {
    const response = await apiGet("/v1/templates", {
      tokenOverride: apiKey,
      params: { status: APPROVED_STATUS },
      toolName: "send_whatsapp",
    });
    const templates: Array<{ name?: string }> = response.data?.data ?? response.data ?? [];
    return templates.map((t) => t.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
};

const sendText = async (phone: string, message: string, from: string | undefined, apiKey?: string) => {
  const body: Record<string, unknown> = { receiver: phone, body: message, type: "text" };
  if (from) body.sender = from;
  const response = await apiPost("/v1/messages", body, { tokenOverride: apiKey, toolName: "send_whatsapp" });
  return response.data ?? {};
};

const deliveredLine = (recipient: Recipient, data: Record<string, any>): string => {
  const cost = Number(data.cost ?? 0).toFixed(2);
  return `Entregue pra ${recipientLabel(recipient)}. Custo R$ ${cost} (conversa aberta). Pode continuar à vontade.`;
};

const windowClosedGuidance = async (recipient: Recipient, apiKey?: string): Promise<string> => {
  const who = recipientLabel(recipient);
  const approved = await fetchApprovedTemplateNames(apiKey);
  if (approved.length === 0) {
    return [
      `Não enviei pra ${who}: a janela de 24h está fechada, e fora dela a Meta só aceita template aprovado — texto livre não passa.`,
      `Você ainda não tem nenhum template aprovado. Bora aprovar um pra esse tipo de mensagem: me diga o texto fixo que quer enviar`,
      `(ex: "Oi {{1}}, seu pedido {{2}} foi atualizado") e eu submeto com create_template.`,
    ].join(" ");
  }
  return [
    `Não enviei pra ${who}: a janela de 24h está fechada, então texto livre não passa pela Meta.`,
    `Templates aprovados que você pode usar: ${approved.slice(0, 10).join(", ")}.`,
    `Me diga qual encaixa (e as variáveis) que eu envio via send_message, ou bora aprovar um template novo pra esse caso com create_template.`,
  ].join(" ");
};

const registerSendWhatsapp = (server: McpServer) => {
  server.tool(
    "send_whatsapp",
    "Manda uma mensagem de WhatsApp pra UMA pessoa. Você só passa pra quem (número OU nome de contato salvo) e o quê (texto em linguagem natural). A Arara resolve número, formato E.164 e nono dígito. Se a janela de 24h estiver fechada, ela não inventa template — devolve os aprovados pra escolher ou ajuda a aprovar um. Para vários destinatários, use broadcast.",
    {
      to: z.string().describe("Número (qualquer formato) ou nome de um contato salvo. Ex: '+5511999999999', '11999999999' ou 'João'."),
      message: z.string().min(1).describe("O que escrever, em linguagem natural. Sem template, sem variável."),
      from: z.string().optional().describe("Número de origem em E.164. Omita pra usar o padrão da organização."),
      apiKey: z.string().optional().describe("Arara API key. Cai pro ARARA_API_KEY do ambiente."),
    },
    async ({ to, message, from, apiKey }) => {
      const guard = guardian(message, getCustomRules());
      if (!guard.safe) return errorResponse(`Não enviei: ${guard.reason}`);

      let recipient: Recipient | { error: string };
      try {
        recipient = await resolveRecipient(to, apiKey);
      } catch (error) {
        return errorResponse(`Não consegui resolver o destinatário: ${readBackendError(error).message}`);
      }
      if ("error" in recipient) return errorResponse(recipient.error);

      try {
        const data = await sendText(recipient.phone, message, from, apiKey);
        return successResponse(deliveredLine(recipient, data));
      } catch (error) {
        const err = readBackendError(error);
        if (isWindowClosed(err)) return successResponse(await windowClosedGuidance(recipient, apiKey));
        return errorResponse(`Não enviei pra ${recipientLabel(recipient)}: ${err.message}`);
      }
    },
  );
};

const registerBroadcast = (server: McpServer) => {
  server.tool(
    "broadcast",
    "Manda um template aprovado pra várias pessoas de uma vez. Disparo em massa é quase sempre fora da janela de 24h, então a Meta exige template — você escolhe um aprovado, a Arara resolve números/nomes e dispara. Não tem template aprovado? Use check com a lista vazia e aprove um com create_template.",
    {
      templateName: z.string().describe("Nome de um template aprovado (não o ID)."),
      to: z.array(z.string()).min(1).max(MAX_BROADCAST).describe("Lista de números (qualquer formato) ou nomes de contatos salvos."),
      variables: z.array(z.string()).optional().describe("Variáveis posicionais aplicadas a TODOS os destinatários, ex: ['promo de junho']. Para variáveis por pessoa, use o dashboard."),
      name: z.string().optional().describe("Nome da campanha no dashboard. Omita pra gerar automático."),
      from: z.string().optional().describe("Número de origem em E.164. Omita pra usar o padrão da organização."),
      apiKey: z.string().optional(),
    },
    async ({ templateName, to, variables, name, from, apiKey }) => {
      const resolved = await Promise.all(to.map((entry) => resolveRecipient(entry, apiKey).catch(() => ({ error: entry }))));
      const valid = resolved.filter((r): r is Recipient => "phone" in r);
      const failed = resolved.filter((r): r is { error: string } => "error" in r).map((r) => r.error);
      if (valid.length === 0) {
        return errorResponse(`Não disparei: nenhum destinatário válido. Não resolvi: ${failed.join(", ")}`);
      }

      try {
        const payload: Record<string, unknown> = {
          name: name ?? `Broadcast ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          templateName,
          contacts: valid.map((r) => ({ to: r.phone, variables: variables ?? [] })),
        };
        if (from) payload.sender = from;
        const response = await apiPost("/v1/campaigns", payload, { tokenOverride: apiKey, toolName: "broadcast" });
        const c = response.data ?? {};
        const lines = [
          `Disparo criado pra ${valid.length} ${valid.length === 1 ? "pessoa" : "pessoas"} (template '${templateName}').`,
          `  Campanha: ${c.id ?? "N/A"}`,
          `  Custo total: R$ ${Number(c.totalCost ?? 0).toFixed(2)}`,
        ];
        if (failed.length > 0) lines.push(`  Não resolvi ${failed.length}: ${failed.slice(0, 10).join(", ")}`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        const err = readBackendError(error);
        return errorResponse(`Não disparei: ${err.message}`);
      }
    },
  );
};

const registerCheckStatus = (server: McpServer) => {
  server.tool(
    "check_status",
    "Responde 'chegou? respondeu? posso falar agora?'. Passe uma pessoa (número ou nome) pra saber se a janela de 24h está aberta, ou um messageId pra ver o status de entrega de uma mensagem específica.",
    {
      to: z.string().optional().describe("Número ou nome de contato — pergunta se dá pra mandar texto livre agora."),
      messageId: z.string().optional().describe("ID interno de uma mensagem — retorna status de entrega."),
      apiKey: z.string().optional(),
    },
    async ({ to, messageId, apiKey }) => {
      if (!to && !messageId) return errorResponse("Passe 'to' (pessoa) ou 'messageId' (mensagem).");

      if (messageId) {
        try {
          const response = await apiGet(`/v1/messages/${messageId}`, { tokenOverride: apiKey, toolName: "check_status" });
          const m = response.data ?? {};
          return successResponse(`Mensagem ${messageId}: ${m.status ?? "N/A"} (pra ${m.receiver ?? "?"}, custo R$ ${Number(m.cost ?? 0).toFixed(2)}).`);
        } catch (error) {
          return errorResponse(`Não achei a mensagem: ${readBackendError(error).message}`);
        }
      }

      let recipient: Recipient | { error: string };
      try {
        recipient = await resolveRecipient(to!, apiKey);
      } catch (error) {
        return errorResponse(`Não resolvi o destinatário: ${readBackendError(error).message}`);
      }
      if ("error" in recipient) return errorResponse(recipient.error);

      try {
        const response = await apiPost("/v1/conversations/window-status", { phones: [recipient.phone] }, {
          tokenOverride: apiKey,
          toolName: "check_status",
        });
        const result = (response.data?.results ?? [])[0];
        const who = recipientLabel(recipient);
        if (!result || !result.isWindowOpen) {
          return successResponse(`${who}: janela FECHADA. Pra falar agora, só com template aprovado (send_whatsapp lista os seus se você tentar).`);
        }
        const hrs = result.hoursRemaining != null ? `${Number(result.hoursRemaining).toFixed(1)}h` : "aberta";
        return successResponse(`${who}: janela ABERTA (${hrs} restantes). Pode mandar texto livre via send_whatsapp.`);
      } catch (error) {
        return errorResponse(`Não consegui checar: ${readBackendError(error).message}`);
      }
    },
  );
};

export const registerSendTool = (server: McpServer) => {
  registerSendWhatsapp(server);
  registerBroadcast(server);
  registerCheckStatus(server);
};
