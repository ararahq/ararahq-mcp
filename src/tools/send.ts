import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { guardian, getCustomRules } from "../lib/guardian.js";
import {
  BackendError,
  Recipient,
  readBackendError,
  recipientLabel,
  resolveRecipient,
} from "../lib/recipients.js";

const WINDOW_CLOSED_HINTS = ["janela de 24h", "envie um template", "nenhuma conversa iniciada"];
const APPROVED_STATUS = "APPROVED";
const MAX_BROADCAST = 1000;

const isWindowClosed = (err: BackendError): boolean => {
  if (err.status !== 422) return false;
  const lower = String(err.message ?? "").toLowerCase();
  return WINDOW_CLOSED_HINTS.some((hint) => lower.includes(hint));
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
    `Me diga qual encaixa (e as variáveis) que eu envio via send_template, ou bora aprovar um template novo pra esse caso com create_template.`,
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

const sendTemplate = async (
  phone: string,
  templateName: string,
  variables: string[],
  from: string | undefined,
  apiKey?: string,
) => {
  const body: Record<string, unknown> = { receiver: phone, templateName, variables, type: "template" };
  if (from) body.sender = from;
  const response = await apiPost("/v1/messages", body, { tokenOverride: apiKey, toolName: "send_template" });
  return response.data ?? {};
};

const registerSendTemplate = (server: McpServer) => {
  server.tool(
    "send_template",
    "Manda um template APROVADO pra UMA pessoa, preenchendo as variáveis ({{1}}, {{2}}...) posicionalmente. É o jeito de falar quando a janela de 24h está fechada (a Meta só aceita template fora dela) OU quando você quer uma mensagem estruturada com variáveis. Você passa pra quem (número ou nome), o nome do template e os valores das variáveis na ordem. Pra texto livre dentro da janela, use send_whatsapp. Pra vários destinatários, use broadcast.",
    {
      to: z.string().describe("Número (qualquer formato) ou nome de um contato salvo."),
      templateName: z.string().describe("Nome de um template aprovado (não o ID). Veja os seus em arara://templates/approved."),
      variables: z
        .array(z.string())
        .optional()
        .describe("Valores das variáveis na ordem: ['João', '#12345']. Preenchem {{1}}, {{2}}... Omita se o template não tem variável."),
      from: z.string().optional().describe("Número de origem em E.164. Omita pra usar o padrão da organização."),
      apiKey: z.string().optional().describe("Arara API key. Cai pro ARARA_API_KEY do ambiente."),
    },
    async ({ to, templateName, variables, from, apiKey }) => {
      let recipient: Recipient | { error: string };
      try {
        recipient = await resolveRecipient(to, apiKey);
      } catch (error) {
        return errorResponse(`Não consegui resolver o destinatário: ${readBackendError(error).message}`);
      }
      if ("error" in recipient) return errorResponse(recipient.error);

      try {
        const data = await sendTemplate(recipient.phone, templateName, variables ?? [], from, apiKey);
        const cost = Number(data.cost ?? 0).toFixed(2);
        return successResponse(
          `Template '${templateName}' enviado pra ${recipientLabel(recipient)}. Custo R$ ${cost}. Acompanhe a entrega com check_status (messageId: ${data.id ?? "N/A"}).`,
        );
      } catch (error) {
        return errorResponse(`Não enviei pra ${recipientLabel(recipient)}: ${readBackendError(error).message}`);
      }
    },
  );
};

type ResolvedContact = { phone: string; variables: string[] };

// Cada destinatário do broadcast é ou uma string (número/nome, usa as variáveis globais)
// ou um objeto { to, variables } pra personalizar as variáveis daquela pessoa —
// é assim que se manda "Oi {{1}}" com o nome de cada um numa campanha só.
const broadcastEntrySchema = z.union([
  z.string(),
  z.object({
    to: z.string().describe("Número (qualquer formato) ou nome de contato salvo."),
    variables: z
      .array(z.string())
      .describe("Variáveis SÓ desta pessoa, na ordem: {{1}}, {{2}}... Ex: ['João', '#12345']."),
  }),
]);

type BroadcastEntry = z.infer<typeof broadcastEntrySchema>;

const resolveContacts = async (
  entries: BroadcastEntry[],
  globalVariables: string[],
  apiKey?: string,
): Promise<{ valid: ResolvedContact[]; failed: string[] }> => {
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      const to = typeof entry === "string" ? entry : entry.to;
      const variables = typeof entry === "string" ? globalVariables : entry.variables;
      try {
        const r = await resolveRecipient(to, apiKey);
        if ("error" in r) return { error: to };
        return { phone: r.phone, variables };
      } catch {
        return { error: to };
      }
    }),
  );
  const valid = resolved.filter((r): r is ResolvedContact => "phone" in r);
  const failed = resolved.filter((r): r is { error: string } => "error" in r).map((r) => r.error);
  return { valid, failed };
};

const registerBroadcast = (server: McpServer) => {
  server.tool(
    "broadcast",
    "Manda um template aprovado pra várias pessoas de uma vez. Disparo em massa é quase sempre fora da janela de 24h, então a Meta exige template — você escolhe um aprovado, a Arara resolve números/nomes e dispara. Variáveis: o mesmo valor pra todos vai em 'variables'; valor por pessoa (ex: nome de cada um em {{1}}) vai como objeto {to, variables} dentro de 'to'. Não tem template aprovado? Aprove um com create_template.",
    {
      templateName: z.string().describe("Nome de um template aprovado (não o ID)."),
      to: z
        .array(broadcastEntrySchema)
        .min(1)
        .max(MAX_BROADCAST)
        .describe(
          "Destinatários. Cada item é um número/nome (string) OU um objeto {to, variables} pra personalizar as variáveis daquela pessoa.",
        ),
      variables: z
        .array(z.string())
        .optional()
        .describe("Variáveis posicionais aplicadas aos destinatários passados como string, ex: ['promo de junho']. Ignorada pra quem veio como {to, variables}."),
      name: z.string().optional().describe("Nome da campanha no dashboard. Omita pra gerar automático."),
      from: z.string().optional().describe("Número de origem em E.164. Omita pra usar o padrão da organização."),
      apiKey: z.string().optional(),
    },
    async ({ templateName, to, variables, name, from, apiKey }) => {
      const { valid, failed } = await resolveContacts(to, variables ?? [], apiKey);
      if (valid.length === 0) {
        return errorResponse(`Não disparei: nenhum destinatário válido. Não resolvi: ${failed.join(", ")}`);
      }

      try {
        const payload: Record<string, unknown> = {
          name: name ?? `Broadcast ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          templateName,
          contacts: valid.map((c) => ({ to: c.phone, variables: c.variables })),
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

const registerBroadcastAb = (server: McpServer) => {
  server.tool(
    "broadcast_ab",
    "Dispara uma campanha com TESTE A/B numa chamada só: você escolhe 2 templates aprovados (A e B), a Arara manda pra uma FATIA dos leads, mede a melhor por clique, e dispara o RESTO pela vencedora sozinha (autopilot). Defaults prontos: 20% em teste, 4h de janela, decide por clique. Precisa dos dois templates aprovados (get_template_status).",
    {
      templateName: z.string().describe("Template da variante A (o principal)."),
      variantBTemplateName: z.string().describe("Template da variante B (a copy que compete com a A)."),
      to: z
        .array(broadcastEntrySchema)
        .min(1)
        .max(MAX_BROADCAST)
        .describe(
          "Destinatários. Cada item é um número/nome (string) OU um objeto {to, variables} pra personalizar as variáveis daquela pessoa.",
        ),
      variables: z
        .array(z.string())
        .optional()
        .describe("Variáveis posicionais aplicadas aos destinatários passados como string, ex: ['promo de junho']. Ignorada pra quem veio como {to, variables}."),
      name: z.string().optional().describe("Nome da campanha no dashboard. Omita pra gerar automático."),
      samplePct: z.number().min(1).max(99).optional().describe("% dos leads que entra no teste. Default 20."),
      decisionWindowMinutes: z.number().min(1).optional().describe("Minutos até decidir a vencedora. Default 240 (4h)."),
      metric: z
        .enum(["DELIVERED", "READ", "CLICKED", "CONVERTED"])
        .optional()
        .describe("O que define a vencedora. Default CLICKED."),
      autopilot: z.boolean().optional().describe("Disparar o resto pela vencedora sozinho. Default true."),
      from: z.string().optional().describe("Número de origem em E.164. Omita pra usar o padrão da org."),
      apiKey: z.string().optional(),
    },
    async ({
      templateName,
      variantBTemplateName,
      to,
      variables,
      name,
      samplePct,
      decisionWindowMinutes,
      metric,
      autopilot,
      from,
      apiKey,
    }) => {
      const { valid, failed } = await resolveContacts(to, variables ?? [], apiKey);
      if (valid.length === 0) {
        return errorResponse(`Não disparei: nenhum destinatário válido. Não resolvi: ${failed.join(", ")}`);
      }
      try {
        const sample = samplePct ?? 20;
        const window = decisionWindowMinutes ?? 240;
        const auto = autopilot ?? true;
        const payload: Record<string, unknown> = {
          name: name ?? `A/B ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          templateName,
          contacts: valid.map((c) => ({ to: c.phone, variables: c.variables })),
          abTest: {
            variantBTemplateName,
            metric: metric ?? "CLICKED",
            samplePct: sample,
            splitPct: 50,
            decisionWindowMinutes: window,
            autopilot: auto,
          },
        };
        if (from) payload.sender = from;
        const response = await apiPost("/v1/campaigns", payload, { tokenOverride: apiKey, toolName: "broadcast_ab" });
        const c = response.data ?? {};
        const lines = [
          `Teste A/B criado pra ${valid.length} ${valid.length === 1 ? "pessoa" : "pessoas"}.`,
          `  A: ${templateName}  vs  B: ${variantBTemplateName}  (métrica: ${metric ?? "CLICKED"})`,
          `  Testa em ${sample}% dos leads por ${window} min` +
            (auto ? ", depois dispara o resto pela vencedora." : " (autopilot OFF: você decide o resto)."),
          `  Campanha: ${c.id ?? "N/A"}  ·  Custo total: R$ ${Number(c.totalCost ?? 0).toFixed(2)}`,
          `  Acompanhe com get_campaign.`,
        ];
        if (failed.length > 0) lines.push(`  Não resolvi ${failed.length}: ${failed.slice(0, 10).join(", ")}`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Não disparei o A/B: ${readBackendError(error).message}`);
      }
    },
  );
};

export const registerSendTool = (server: McpServer) => {
  registerSendWhatsapp(server);
  registerSendTemplate(server);
  registerBroadcast(server);
  registerBroadcastAb(server);
  registerCheckStatus(server);
};
