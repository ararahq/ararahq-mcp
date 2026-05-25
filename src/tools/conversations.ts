import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { guardian, getCustomRules } from "../lib/guardian.js";

export const registerConversationTools = (server: McpServer) => {
  server.tool(
    "list_conversations",
    "List conversations with the customer base. Filter by status (OPEN/CLOSED). Useful to find conversations needing reply.",
    {
      apiKey: z.string().optional(),
      status: z.enum(["OPEN", "CLOSED"]).optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(0).optional().default(0),
    },
    async ({ apiKey, status, limit, page }) => {
      try {
        const params: Record<string, unknown> = { limit, page };
        if (status) params.status = status;
        const response = await apiGet("/v1/conversations", {
          tokenOverride: apiKey,
          params,
          toolName: "list_conversations",
        });
        const items: any[] = response.data?.data ?? response.data ?? [];
        if (items.length === 0) return successResponse("No conversations found.");
        const lines = items.map((c: any) =>
          `- ${c.id} | ${c.phone ?? c.customerPhone ?? "?"} | ${c.status ?? "?"} | last: ${c.lastMessageAt ?? "?"}`,
        );
        return successResponse(`Conversations (${items.length}):\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_conversation_messages",
    "Full message history of one conversation, in chronological order. Direction is INBOUND (from customer) or OUTBOUND (from us).",
    {
      apiKey: z.string().optional(),
      conversationId: z.string(),
      limit: z.number().int().min(1).max(200).optional().default(50),
      page: z.number().int().min(0).optional().default(0),
    },
    async ({ apiKey, conversationId, limit, page }) => {
      try {
        const response = await apiGet(`/v1/conversations/${conversationId}/messages`, {
          tokenOverride: apiKey,
          params: { limit, page },
          toolName: "get_conversation_messages",
        });
        const messages: any[] = response.data?.data ?? response.data ?? [];
        if (messages.length === 0) return successResponse("No messages in this conversation.");
        const lines = messages.map((m: any) => {
          const direction = m.direction === "INBOUND" ? "←" : "→";
          return `${direction} [${m.createdAt ?? ""}] ${m.body ?? ""}`;
        });
        return successResponse(`Conversation ${conversationId}:\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`Fetch failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "reply_in_conversation",
    "Send a free-text reply within an open 24h conversation window. Guardian content checks apply. To reopen a closed window, send a template message via send_message instead.",
    {
      apiKey: z.string().optional(),
      conversationId: z.string(),
      text: z.string().describe("Reply body. Must pass Guardian checks."),
    },
    async ({ apiKey, conversationId, text }) => {
      const check = guardian(text, getCustomRules());
      if (!check.safe) return errorResponse(`GUARDIAN: ${check.reason}`);
      try {
        const response = await apiPost("/v1/conversations/reply", {
          conversationId,
          body: text,
        }, {
          tokenOverride: apiKey,
          toolName: "reply_in_conversation",
        });
        return successResponse(`Reply sent. Message ID: ${response.data?.id ?? "N/A"}`);
      } catch (error) {
        return errorResponse(`Reply failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "check_window_status",
    "Check if the 24h WhatsApp session window is open for a given customer phone. While the window is open, you can send free text (reply_in_conversation or send_message text). After it closes, the only way to reach the customer is an approved template. Returns isOpen, expiresAt and hoursRemaining.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
    },
    async ({ apiKey, phone }) => {
      try {
        const response = await apiPost("/v1/conversations/window-status", { phones: [phone] }, {
          tokenOverride: apiKey,
          toolName: "check_window_status",
        });
        const results: any[] = response.data?.results ?? [];
        const result = results[0];
        if (!result) {
          return successResponse([
            `No conversation found for ${phone}.`,
            `If the customer never messaged you, you must send an approved template to start the window.`,
          ].join("\n"));
        }
        const isOpen = !!result.isWindowOpen;
        const hoursRemaining = result.hoursRemaining != null
          ? Number(result.hoursRemaining).toFixed(1)
          : "0";
        return successResponse([
          `Window status for ${phone}:`,
          `  Open:           ${isOpen ? "YES" : "NO"}`,
          `  Expires at:     ${result.windowExpiresAt ?? "n/a"}`,
          `  Hours left:     ${hoursRemaining}`,
          `  ConversationId: ${result.conversationId ?? "n/a"}`,
          isOpen
            ? `You can send free text via reply_in_conversation or send_message (text or interactive).`
            : `Window closed. Send an approved template via send_message templateName=... to reopen.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Window check failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "bulk_window_check",
    "Check the 24h WhatsApp session window for up to 200 phones in a single call. Returns isWindowOpen, expiresAt and hoursRemaining per phone. Use BEFORE a campaign to split contacts into 'send free text' vs 'must reopen with template'. Phones with no conversation history return isWindowOpen=false.",
    {
      apiKey: z.string().optional(),
      phones: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/, "Each phone must be E.164")).min(1).max(200),
    },
    async ({ apiKey, phones }) => {
      try {
        const response = await apiPost("/v1/conversations/window-status", { phones }, {
          tokenOverride: apiKey,
          toolName: "bulk_window_check",
        });
        const results: any[] = response.data?.results ?? [];
        const truncated: boolean = !!response.data?.truncated;
        const open = results.filter((r) => r.isWindowOpen).length;
        const lines = [
          `Window status (${results.length} phones, ${open} open):`,
          ``,
        ];
        for (const r of results) {
          const hrs = r.hoursRemaining != null ? `${Number(r.hoursRemaining).toFixed(1)}h left` : "closed";
          lines.push(`  ${r.phone}: ${r.isWindowOpen ? "OPEN" : "CLOSED"} (${hrs})`);
        }
        if (truncated) lines.push(``, `Note: list was truncated to first 200 phones.`);
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Bulk window check failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_lead_stats",
    "Aggregate stats on inbound conversations classified as leads (new contacts who messaged you). Use to track top-of-funnel volume.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/conversations/lead-stats", {
          tokenOverride: apiKey,
          toolName: "get_lead_stats",
        });
        const s = response.data ?? {};
        const lines = Object.entries(s).map(([k, v]) => `  ${k.padEnd(20)} ${v}`);
        return successResponse(`Lead stats:\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`Stats failed: ${extractError(error)}`);
      }
    },
  );
};
