#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import crypto from "node:crypto";

// --- BOOTSTRAP ---
const originalLog = console.log;
console.log = () => {};
dotenv.config();
console.log = originalLog;

// --- CONSTANTS ---
const ARARA_BASE = "https://api.ararahq.com/api";
const ABACATE_BASE = "https://api.abacatepay.com/v2";
const SERVER_VERSION = "2.0.0";

// --- SESSION CONTEXT ---
const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();
const sessionKeysArara = new Map<string, string>();
const sessionKeysAbacate = new Map<string, string>();

const IS_SHARED_MODE = !(process.env.ARARA_API_KEY || process.env.ABACATE_API_KEY);

// --- KEY RESOLVERS ---
const getAraraKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context ? sessionKeysArara.get(context.sessionId) : undefined;
  return apiKey || sessionKey || process.env.ARARA_API_KEY;
};

const getAbacateKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context
    ? sessionKeysAbacate.get(context.sessionId) || sessionKeysArara.get(context.sessionId)
    : undefined;
  return apiKey || sessionKey || process.env.ABACATE_API_KEY;
};

// --- ERROR EXTRACTION ---
const extractError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    return data?.error?.message || data?.message || data?.error || error.message;
  }
  return String(error);
};

const errorResponse = (message: string) => ({
  content: [{ type: "text" as const, text: `❌ ${message}` }],
  isError: true,
});

const successResponse = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

// --- GUARDIAN MODE ---
const SENSITIVE_PATTERNS = [
  /password/i, /senha/i, /credit.?card/i, /cartão.?de.?crédito/i,
  /\bcpf\b/i, /\bcnpj\b/i, /\bcvv\b/i, /\btoken\b/i, /api[_-]?key/i, /\bsecret\b/i,
];

const guardianFilter = (text: string): { safe: boolean; reason?: string } => {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Sensitive data detected (pattern: ${pattern.source})` };
    }
  }
  return { safe: true };
};

// --- TOOL REGISTRY ---
function registerTools(serverInstance: McpServer) {

  // ─────────────────────────────────────────────────────────
  // 1. SEND SMART MESSAGE
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "send_smart_message",
    "Send a WhatsApp message to a single recipient. Guardian mode blocks sensitive content by default.",
    {
      apiKey: z.string().optional().describe("Arara API Key (optional if set via session)"),
      to: z.string().describe("Recipient phone in E.164 format (e.g. +5511999999999)"),
      text: z.string().describe("Plain text message body"),
      skipGuardian: z.boolean().optional().default(false).describe("Bypass guardian content filter"),
    },
    async ({ apiKey, to, text, skipGuardian }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      if (!skipGuardian) {
        const check = guardianFilter(text);
        if (!check.safe) return errorResponse(`GUARDIAN INTERCEPT: ${check.reason}`);
      }
      try {
        const response = await axios.post(
          `${ARARA_BASE}/v1/messages`,
          { receiver: to, body: text },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        return successResponse(`✅ Message sent. ID: ${response.data.id} | To: ${to}`);
      } catch (error) {
        return errorResponse(`Send failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 2. SEND BATCH MESSAGES
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "send_batch_messages",
    "Send up to 1000 individual WhatsApp messages in a single API call. Each recipient can have a custom body.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      messages: z.array(z.object({
        to: z.string().describe("Recipient phone in E.164 format"),
        text: z.string().describe("Message body for this recipient"),
      })).min(1).max(1000).describe("List of messages to send (max 1000)"),
    },
    async ({ apiKey, messages }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const payload = messages.map((message) => ({
        receiver: message.to,
        body: message.text,
      }));

      try {
        const response = await axios.post(
          `${ARARA_BASE}/v1/messages/batch`,
          { messages: payload },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        const sent = response.data?.sent ?? messages.length;
        const failed = response.data?.failed ?? 0;
        return successResponse(
          `✅ Batch complete. Sent: ${sent} | Failed: ${failed} | Total: ${messages.length}`,
        );
      } catch (error) {
        return errorResponse(`Batch send failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 3. GET ACCOUNT OVERVIEW — P0
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "get_account_overview",
    "Get a full account snapshot: wallet balance, delivery metrics (sent/delivered/read/failed), total spend and delivery rate.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
    },
    async ({ apiKey }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      try {
        const [balanceResp, metricsResp] = await Promise.all([
          axios.get(`${ARARA_BASE}/dashboard/wallet/balance`, {
            headers: { Authorization: `Bearer ${activeKey}` },
          }),
          axios.get(`${ARARA_BASE}/dashboard/metrics`, {
            headers: { Authorization: `Bearer ${activeKey}` },
          }),
        ]);

        const balance = balanceResp.data?.balance ?? balanceResp.data;
        const metrics = metricsResp.data;

        const report = [
          `💰 ACCOUNT OVERVIEW`,
          ``,
          `Wallet Balance: R$ ${Number(balance).toFixed(2)}`,
          ``,
          `📊 Delivery Metrics:`,
          `  Sent:      ${metrics.sent ?? 0}`,
          `  Delivered: ${metrics.delivered ?? 0}`,
          `  Read:      ${metrics.read ?? 0}`,
          `  Failed:    ${metrics.failed ?? 0}`,
          `  Pending:   ${metrics.pending ?? 0}`,
          ``,
          `  Delivery Rate: ${metrics.deliveryRate ?? metrics.delivery_rate ?? "N/A"}%`,
          `  Total Spend:   R$ ${Number(metrics.totalCost ?? metrics.total_cost ?? 0).toFixed(2)}`,
        ].join("\n");

        return successResponse(report);
      } catch (error) {
        return errorResponse(`Account overview failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 4. MANAGE TEMPLATES — P0
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_templates",
    "Full template lifecycle: list, create, check approval status, view analytics, or delete templates.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum(["list", "create", "get_status", "get_analytics", "delete"]).describe(
        "Action to perform",
      ),
      templateId: z.string().optional().describe("Template ID (required for: get_status, get_analytics, delete)"),
      name: z.string().optional().describe("Template name (required for: create)"),
      language: z.string().optional().default("pt_BR").describe("Language code, e.g. pt_BR, en_US (required for: create)"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional().describe(
        "Template category (required for: create)",
      ),
      bodyText: z.string().optional().describe(
        "Template body text. Use {{1}}, {{2}} for variables (required for: create)",
      ),
      headerText: z.string().optional().describe("Optional header text for the template"),
      footerText: z.string().optional().describe("Optional footer text for the template"),
      filterByName: z.string().optional().describe("Filter templates by name (for: list)"),
      limit: z.number().optional().default(20).describe("Max results to return (for: list)"),
    },
    async ({
      apiKey, action, templateId, name, language, category,
      bodyText, headerText, footerText, filterByName, limit,
    }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "list": {
            const params: Record<string, unknown> = { limit };
            if (filterByName) params.name = filterByName;
            const response = await axios.get(`${ARARA_BASE}/v1/templates`, { headers, params });
            const templates = response.data?.data ?? response.data ?? [];
            if (templates.length === 0) return successResponse("No templates found.");
            const lines = templates.map((t: any) =>
              `- ID: ${t.id} | Name: ${t.name} | Status: ${t.status} | Category: ${t.category} | Lang: ${t.language}`,
            );
            return successResponse(`📋 Templates (${templates.length}):\n\n${lines.join("\n")}`);
          }

          case "create": {
            if (!name || !category || !bodyText) {
              return errorResponse("Fields required for create: name, category, bodyText.");
            }
            const components: any[] = [{ type: "BODY", text: bodyText }];
            if (headerText) components.unshift({ type: "HEADER", format: "TEXT", text: headerText });
            if (footerText) components.push({ type: "FOOTER", text: footerText });

            const response = await axios.post(
              `${ARARA_BASE}/v1/templates`,
              { name, language: language ?? "pt_BR", category, components },
              { headers },
            );
            const created = response.data;
            return successResponse(
              `✅ Template created.\nID: ${created.id}\nName: ${created.name}\nStatus: ${created.status ?? "PENDING"}\n\nApproval by Meta usually takes a few hours to 1 business day.`,
            );
          }

          case "get_status": {
            if (!templateId) return errorResponse("templateId is required for get_status.");
            const response = await axios.get(`${ARARA_BASE}/v1/templates/${templateId}/status`, { headers });
            const status = response.data?.status ?? response.data;
            const icons: Record<string, string> = { APPROVED: "✅", REJECTED: "❌", PENDING: "⏳" };
            const icon = icons[status] ?? "❓";
            return successResponse(`${icon} Template ${templateId} status: ${status}`);
          }

          case "get_analytics": {
            if (!templateId) return errorResponse("templateId is required for get_analytics.");
            const response = await axios.get(`${ARARA_BASE}/v1/templates/${templateId}/analytics`, { headers });
            const a = response.data;
            return successResponse([
              `📊 Template Analytics — ${templateId}`,
              ``,
              `  Sent:      ${a.sent ?? 0}`,
              `  Delivered: ${a.delivered ?? 0}`,
              `  Read:      ${a.read ?? 0}`,
              `  Failed:    ${a.failed ?? 0}`,
              ``,
              `  Delivery Rate: ${a.deliveryRate ?? a.delivery_rate ?? "N/A"}%`,
              `  Read Rate:     ${a.readRate ?? a.read_rate ?? "N/A"}%`,
            ].join("\n"));
          }

          case "delete": {
            if (!templateId) return errorResponse("templateId is required for delete.");
            await axios.delete(`${ARARA_BASE}/v1/templates/${templateId}`, { headers });
            return successResponse(`🗑️ Template ${templateId} deleted successfully.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_templates[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 5. CREATE CAMPAIGN — P0
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "create_campaign",
    "Create and dispatch a WhatsApp template campaign to a list of recipients. Each recipient can have individual template variables.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      templateId: z.string().describe("Approved template ID to use for the campaign"),
      recipients: z.array(z.object({
        phone: z.string().describe("Recipient phone in E.164 format"),
        variables: z.record(z.string()).optional().describe("Template variable values keyed by position, e.g. {\"1\": \"John\", \"2\": \"#ORD-123\"}"),
      })).min(1).describe("List of recipients with optional per-recipient variables"),
      scheduledAt: z.string().optional().describe("ISO 8601 datetime to schedule the campaign, e.g. 2026-03-21T14:00:00Z. Omit to send immediately."),
    },
    async ({ apiKey, templateId, recipients, scheduledAt }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const payload: Record<string, unknown> = { templateId, recipients };
      if (scheduledAt) payload.scheduledAt = scheduledAt;

      try {
        const response = await axios.post(
          `${ARARA_BASE}/v1/campaigns`,
          payload,
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        const campaign = response.data;
        const scheduled = scheduledAt ? `\nScheduled: ${scheduledAt}` : "\nDispatch: Immediate";
        return successResponse(
          `🚀 Campaign created.\nID: ${campaign.id ?? "N/A"}\nTemplate: ${templateId}\nRecipients: ${recipients.length}${scheduled}`,
        );
      } catch (error) {
        return errorResponse(`Campaign creation failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 6. MANAGE MESSAGES — P1
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_messages",
    "List messages from the dashboard or get the status of a specific message by ID.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum(["list", "get_status"]).describe("Action to perform"),
      messageId: z.string().optional().describe("Message ID (required for: get_status)"),
      limit: z.number().optional().default(20).describe("Max results (for: list)"),
      page: z.number().optional().default(0).describe("Page number (for: list)"),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE").describe("Filter by API mode (for: list)"),
    },
    async ({ apiKey, action, messageId, limit, page, mode }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "list": {
            const response = await axios.get(`${ARARA_BASE}/dashboard/messages`, {
              headers,
              params: { limit, page, mode },
            });
            const messages = response.data?.data ?? response.data ?? [];
            if (messages.length === 0) return successResponse("No messages found.");
            const lines = messages.map((m: any) =>
              `- ID: ${m.id} | To: ${m.receiver ?? m.to} | Status: ${m.status} | ${m.createdAt ?? ""}`,
            );
            return successResponse(`📨 Messages (${messages.length}):\n\n${lines.join("\n")}`);
          }

          case "get_status": {
            if (!messageId) return errorResponse("messageId is required for get_status.");
            const response = await axios.get(`${ARARA_BASE}/v1/messages/${messageId}`, { headers });
            const message = response.data;
            const statusIcons: Record<string, string> = {
              DELIVERED: "✅", READ: "👁️", SENT: "📤", FAILED: "❌", PENDING: "⏳",
            };
            const icon = statusIcons[message.status] ?? "❓";
            return successResponse([
              `${icon} Message ${messageId}`,
              `  Status:    ${message.status}`,
              `  To:        ${message.receiver ?? message.to}`,
              `  Body:      ${message.body ?? "N/A"}`,
              `  Created:   ${message.createdAt ?? "N/A"}`,
              `  Updated:   ${message.updatedAt ?? "N/A"}`,
            ].join("\n"));
          }
        }
      } catch (error) {
        return errorResponse(`manage_messages[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 7. MANAGE CONVERSATIONS — P1
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_conversations",
    "List active conversations, retrieve full message history for a conversation, or reply in an open session window.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum(["list", "get_history", "reply"]).describe("Action to perform"),
      conversationId: z.string().optional().describe("Conversation ID (required for: get_history, reply)"),
      replyText: z.string().optional().describe("Reply message body (required for: reply)"),
      replyPhone: z.string().optional().describe("Recipient phone for the reply (required for: reply)"),
      status: z.string().optional().describe("Filter by status: OPEN, CLOSED (for: list)"),
      limit: z.number().optional().default(20).describe("Max results (for: list, get_history)"),
      page: z.number().optional().default(0).describe("Page number (for: list, get_history)"),
    },
    async ({ apiKey, action, conversationId, replyText, replyPhone, status, limit, page }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "list": {
            const params: Record<string, unknown> = { limit, page };
            if (status) params.status = status;
            const response = await axios.get(`${ARARA_BASE}/v1/conversations`, { headers, params });
            const conversations = response.data?.data ?? response.data ?? [];
            if (conversations.length === 0) return successResponse("No conversations found.");
            const lines = conversations.map((c: any) =>
              `- ID: ${c.id} | Phone: ${c.phone ?? c.customerPhone ?? "N/A"} | Status: ${c.status} | Last: ${c.lastMessageAt ?? ""}`,
            );
            return successResponse(`💬 Conversations (${conversations.length}):\n\n${lines.join("\n")}`);
          }

          case "get_history": {
            if (!conversationId) return errorResponse("conversationId is required for get_history.");
            const response = await axios.get(
              `${ARARA_BASE}/v1/conversations/${conversationId}/messages`,
              { headers, params: { limit, page } },
            );
            const messages = response.data?.data ?? response.data ?? [];
            if (messages.length === 0) return successResponse("No messages in this conversation.");
            const lines = messages.map((m: any) => {
              const direction = m.direction === "INBOUND" ? "←" : "→";
              return `${direction} [${m.createdAt ?? ""}] ${m.body ?? ""}`;
            });
            return successResponse(`📜 Conversation ${conversationId} (${messages.length} messages):\n\n${lines.join("\n")}`);
          }

          case "reply": {
            if (!conversationId || !replyText || !replyPhone) {
              return errorResponse("conversationId, replyText, and replyPhone are required for reply.");
            }
            const check = guardianFilter(replyText);
            if (!check.safe) return errorResponse(`GUARDIAN INTERCEPT: ${check.reason}`);
            const response = await axios.post(
              `${ARARA_BASE}/v1/conversations/reply`,
              { conversationId, body: replyText, receiver: replyPhone },
              { headers },
            );
            return successResponse(`✅ Reply sent. Message ID: ${response.data.id}`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_conversations[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 8. GET CUSTOMER INSIGHTS — BML
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "get_customer_insights",
    "Business Memory Layer: combine Arara message history with AbacatePay customer metadata to build a full customer profile.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      phone: z.string().describe("Customer phone number in E.164 format"),
      email: z.string().optional().describe("Customer email for AbacatePay lookup"),
    },
    async ({ apiKey, phone, email }) => {
      const araraKey = getAraraKey(apiKey);
      const abacateKey = getAbacateKey(apiKey);
      if (!araraKey) return errorResponse("Missing Arara API Key.");

      const lines: string[] = [`🧠 Customer Profile — ${phone}`];

      try {
        const araraResp = await axios.get(
          `${ARARA_BASE}/dashboard/messages`,
          { headers: { Authorization: `Bearer ${araraKey}` }, params: { receiver: phone, limit: 10 } },
        );
        const history = araraResp.data?.data ?? araraResp.data ?? [];
        lines.push(`\n📨 Message History:`);
        lines.push(`  Total found: ${history.length}`);
        if (history[0]) {
          lines.push(`  Last message: "${history[0].body ?? "N/A"}" (${history[0].status ?? ""} — ${history[0].createdAt ?? ""})`);
        }
      } catch (_) {
        lines.push(`\n📨 Message History: unavailable`);
      }

      if (email && abacateKey) {
        try {
          const abacateResp = await axios.get(
            `${ABACATE_BASE}/customers/list`,
            { headers: { Authorization: `Bearer ${abacateKey}` }, params: { email } },
          );
          const customer = abacateResp.data?.data?.[0];
          if (customer) {
            lines.push(`\n💳 AbacatePay:`);
            lines.push(`  Status: ACTIVE CUSTOMER`);
            lines.push(`  Name:   ${customer.name ?? "N/A"}`);
            lines.push(`  Email:  ${customer.email ?? email}`);
          } else {
            lines.push(`\n💳 AbacatePay: no customer found for ${email}`);
          }
        } catch (_) {
          lines.push(`\n💳 AbacatePay: unavailable`);
        }
      }

      return successResponse(lines.join("\n"));
    },
  );

  // ─────────────────────────────────────────────────────────
  // 9. MANAGE ORGANIZATION — P2
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_organization",
    "Manage organization settings: list phone numbers, read/update webhook config, read/update AI brain config, list team members.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum([
        "get_numbers",
        "get_webhook",
        "update_webhook",
        "get_brain_config",
        "update_brain_config",
        "list_members",
      ]).describe("Action to perform"),
      webhookUrl: z.string().optional().describe("New webhook URL (required for: update_webhook)"),
      webhookSecret: z.string().optional().describe("New webhook secret (optional for: update_webhook)"),
      brainConfig: z.record(z.unknown()).optional().describe("Brain config fields to update as a JSON object (required for: update_brain_config)"),
    },
    async ({ apiKey, action, webhookUrl, webhookSecret, brainConfig }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "get_numbers": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/numbers`, { headers });
            const numbers = response.data?.data ?? response.data ?? [];
            if (numbers.length === 0) return successResponse("No phone numbers assigned.");
            const lines = numbers.map((n: any) =>
              `- ${n.phoneNumber ?? n.number} | Alias: ${n.alias ?? "none"} | Default: ${n.isDefault ? "yes" : "no"} | Status: ${n.status ?? "active"}`,
            );
            return successResponse(`📱 Numbers (${numbers.length}):\n\n${lines.join("\n")}`);
          }

          case "get_webhook": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/webhook`, { headers });
            const config = response.data;
            return successResponse([
              `🔗 Inbound Webhook Config:`,
              `  URL:    ${config.url ?? config.webhookUrl ?? "not configured"}`,
              `  Secret: ${config.secret ? "••••••••" : "not set"}`,
              `  Status: ${config.status ?? "active"}`,
            ].join("\n"));
          }

          case "update_webhook": {
            if (!webhookUrl) return errorResponse("webhookUrl is required for update_webhook.");
            const body: Record<string, string> = { url: webhookUrl };
            if (webhookSecret) body.secret = webhookSecret;
            await axios.patch(`${ARARA_BASE}/organizations/me/webhook`, body, { headers });
            return successResponse(`✅ Webhook updated.\n  URL: ${webhookUrl}`);
          }

          case "get_brain_config": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/brain-config`, { headers });
            return successResponse(
              `🧠 Brain Config:\n\n${JSON.stringify(response.data, null, 2)}`,
            );
          }

          case "update_brain_config": {
            if (!brainConfig) return errorResponse("brainConfig is required for update_brain_config.");
            await axios.patch(`${ARARA_BASE}/organizations/me/brain-config`, brainConfig, { headers });
            return successResponse(`✅ Brain config updated.`);
          }

          case "list_members": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/members`, { headers });
            const members = response.data?.data ?? response.data ?? [];
            if (members.length === 0) return successResponse("No team members found.");
            const lines = members.map((m: any) =>
              `- ${m.name ?? "N/A"} | Email: ${m.email ?? "N/A"} | Role: ${m.role ?? "N/A"}`,
            );
            return successResponse(`👥 Team Members (${members.length}):\n\n${lines.join("\n")}`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_organization[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 10. MANAGE API KEYS — P2
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_api_keys",
    "List, create or revoke Arara API keys for the organization.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum(["list", "create", "revoke"]).describe("Action to perform"),
      keyId: z.string().optional().describe("API key ID to revoke (required for: revoke)"),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE").describe("API key mode (for: create)"),
      keyName: z.string().optional().describe("Descriptive name for the new key (for: create)"),
    },
    async ({ apiKey, action, keyId, mode, keyName }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "list": {
            const response = await axios.get(`${ARARA_BASE}/api-keys`, { headers });
            const keys = response.data?.data ?? response.data ?? [];
            if (keys.length === 0) return successResponse("No API keys found.");
            const lines = keys.map((k: any) =>
              `- ID: ${k.id} | Name: ${k.name ?? "N/A"} | Mode: ${k.mode ?? "N/A"} | Created: ${k.createdAt ?? "N/A"}`,
            );
            return successResponse(`🔑 API Keys (${keys.length}):\n\n${lines.join("\n")}`);
          }

          case "create": {
            const body: Record<string, string> = { mode: mode ?? "LIVE" };
            if (keyName) body.name = keyName;
            const response = await axios.post(`${ARARA_BASE}/api-keys`, body, { headers });
            const created = response.data;
            return successResponse([
              `✅ API Key created.`,
              `  ID:   ${created.id}`,
              `  Key:  ${created.key ?? created.apiKey ?? "See dashboard"}`,
              `  Mode: ${created.mode ?? mode}`,
              ``,
              `⚠️  Save this key now — it will not be shown again.`,
            ].join("\n"));
          }

          case "revoke": {
            if (!keyId) return errorResponse("keyId is required for revoke.");
            await axios.delete(`${ARARA_BASE}/api-keys/${keyId}`, { headers });
            return successResponse(`🗑️ API key ${keyId} revoked successfully.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_api_keys[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 11. MANAGE KNOWLEDGE BASE — P2
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_knowledge_base",
    "Read and write the AI brain's knowledge base: list entries, save new knowledge, update or delete existing entries.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      action: z.enum(["list", "save", "update", "delete"]).describe("Action to perform"),
      knowledgeId: z.string().optional().describe("Knowledge entry ID (required for: update, delete)"),
      content: z.string().optional().describe("Knowledge content to save or update (required for: save, update)"),
      title: z.string().optional().describe("Title or label for the knowledge entry (for: save, update)"),
    },
    async ({ apiKey, action, knowledgeId, content, title }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        switch (action) {
          case "list": {
            const response = await axios.get(`${ARARA_BASE}/v1/brain/knowledge`, { headers });
            const entries = response.data?.data ?? response.data ?? [];
            if (entries.length === 0) return successResponse("Knowledge base is empty.");
            const lines = entries.map((e: any) =>
              `- ID: ${e.id} | Title: ${e.title ?? "N/A"}\n  ${(e.content ?? "").substring(0, 100)}${(e.content?.length ?? 0) > 100 ? "..." : ""}`,
            );
            return successResponse(`📚 Knowledge Base (${entries.length} entries):\n\n${lines.join("\n\n")}`);
          }

          case "save": {
            if (!content) return errorResponse("content is required for save.");
            const body: Record<string, string> = { content };
            if (title) body.title = title;
            const response = await axios.post(`${ARARA_BASE}/v1/brain/knowledge`, body, { headers });
            return successResponse(`✅ Knowledge entry saved. ID: ${response.data.id}`);
          }

          case "update": {
            if (!knowledgeId || !content) {
              return errorResponse("knowledgeId and content are required for update.");
            }
            const body: Record<string, string> = { content };
            if (title) body.title = title;
            await axios.put(`${ARARA_BASE}/v1/brain/knowledge/${knowledgeId}`, body, { headers });
            return successResponse(`✅ Knowledge entry ${knowledgeId} updated.`);
          }

          case "delete": {
            if (!knowledgeId) return errorResponse("knowledgeId is required for delete.");
            await axios.delete(`${ARARA_BASE}/v1/brain/knowledge/${knowledgeId}`, { headers });
            return successResponse(`🗑️ Knowledge entry ${knowledgeId} deleted.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_knowledge_base[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 12. UPLOAD MEDIA — P3
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "upload_media",
    "Upload a media file to Arara R2 storage from a public URL. Returns the short URL to use in messages.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      fileUrl: z.string().url().describe("Public URL of the file to upload (image, PDF, audio, video)"),
      filename: z.string().optional().describe("Filename to use, e.g. image.jpg. Inferred from URL if omitted."),
      mimeType: z.string().optional().describe("MIME type, e.g. image/jpeg. Inferred if omitted."),
    },
    async ({ apiKey, fileUrl, filename, mimeType }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      try {
        const fileResp = await axios.get(fileUrl, { responseType: "arraybuffer" });
        const inferredMime = mimeType ?? (fileResp.headers["content-type"] as string) ?? "application/octet-stream";
        const inferredName = filename ?? fileUrl.split("/").pop()?.split("?")[0] ?? "file";

        const formData = new FormData();
        formData.append(
          "file",
          new Blob([fileResp.data as ArrayBuffer], { type: inferredMime }),
          inferredName,
        );

        const uploadResp = await axios.post(`${ARARA_BASE}/v1/media/upload`, formData, {
          headers: { Authorization: `Bearer ${activeKey}` },
        });

        const result = uploadResp.data;
        return successResponse([
          `✅ Media uploaded.`,
          `  Short URL: ${result.shortUrl ?? result.url}`,
          `  Full URL:  ${result.directUrl ?? result.direct_url ?? "N/A"}`,
          `  Filename:  ${result.filename ?? inferredName}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`upload_media failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 13. CHECK REVENUE LEAKS (AbacatePay)
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "check_revenue_leaks",
    "Monitor AbacatePay checkouts for failed, pending, or expired payments. Identify revenue recovery opportunities.",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      limit: z.number().optional().default(20).describe("Max checkouts to scan"),
    },
    async ({ apiKey, limit }) => {
      const activeKey = getAbacateKey(apiKey);
      if (!activeKey) return errorResponse("Missing AbacatePay API Key.");

      try {
        const response = await axios.get(`${ABACATE_BASE}/checkouts/list`, {
          headers: { Authorization: `Bearer ${activeKey}` },
          params: { limit },
        });
        const allCheckouts = response.data?.data ?? [];
        const leaks = allCheckouts.filter((b: any) =>
          ["PENDING", "EXPIRED", "CANCELLED"].includes(b.status),
        );

        if (leaks.length === 0) {
          return successResponse("✅ No revenue leaks found. Funnels are healthy.");
        }

        const lines = leaks.map((l: any) =>
          `- ID: ${l.id} | Customer: ${l.customer?.name ?? "N/A"} | Status: ${l.status} | Amount: R$ ${((l.amount ?? 0) / 100).toFixed(2)}`,
        );
        return successResponse(
          `🚨 Revenue Leaks (${leaks.length}):\n\n${lines.join("\n")}\n\nUse 'negotiate_payment' to offer a recovery link.`,
        );
      } catch (error) {
        return errorResponse(`check_revenue_leaks failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 14. NEGOTIATE PAYMENT (AbacatePay)
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "negotiate_payment",
    "Atomically create a product and checkout link via AbacatePay for a negotiated or discounted offer.",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      customerEmail: z.string().email().describe("Customer email"),
      customerPhone: z.string().describe("Customer phone (for WhatsApp delivery after checkout creation)"),
      amount: z.number().int().positive().describe("Amount in centavos (BRL), e.g. 9990 = R$99.90"),
      description: z.string().describe("Offer description shown to the customer"),
    },
    async ({ apiKey, customerEmail, customerPhone, amount, description }) => {
      const activeKey = getAbacateKey(apiKey);
      if (!activeKey) return errorResponse("Missing AbacatePay API Key.");

      try {
        const productResp = await axios.post(
          `${ABACATE_BASE}/products/create`,
          { externalId: `neg-${Date.now()}`, name: description, price: amount, currency: "BRL" },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        const productId = productResp.data?.data?.id;

        const checkoutResp = await axios.post(
          `${ABACATE_BASE}/checkouts/create`,
          {
            items: [{ id: productId, quantity: 1 }],
            methods: ["PIX", "CARD"],
            returnUrl: "https://ararahq.com/",
            completionUrl: "https://ararahq.com/paid",
          },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );

        const checkout = checkoutResp.data?.data;
        return successResponse([
          `💎 Checkout created for ${customerPhone}`,
          `  Link:        ${checkout.url}`,
          `  Checkout ID: ${checkout.id}`,
          `  Amount:      R$ ${(amount / 100).toFixed(2)}`,
          `  Status:      PENDING`,
          ``,
          `Next: use 'send_smart_message' to send the link to ${customerPhone}.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`negotiate_payment failed: ${extractError(error)}`);
      }
    },
  );

  // ─────────────────────────────────────────────────────────
  // 15. CONFIRM PAYMENT HANDSHAKE (AbacatePay)
  // ─────────────────────────────────────────────────────────
  serverInstance.tool(
    "confirm_payment_handshake",
    "Verify the real-time payment status of an AbacatePay checkout by ID.",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      checkoutId: z.string().describe("Checkout ID to verify"),
    },
    async ({ apiKey, checkoutId }) => {
      const activeKey = getAbacateKey(apiKey);
      if (!activeKey) return errorResponse("Missing AbacatePay API Key.");

      try {
        const response = await axios.get(`${ABACATE_BASE}/checkouts/get`, {
          headers: { Authorization: `Bearer ${activeKey}` },
          params: { id: checkoutId },
        });
        const checkout = response.data?.data;
        const status = checkout?.status ?? "UNKNOWN";
        const icons: Record<string, string> = { PAID: "✅", PENDING: "⏳", EXPIRED: "❌", CANCELLED: "🚫" };
        const icon = icons[status] ?? "❓";
        return successResponse(`${icon} Checkout ${checkoutId}: ${status}`);
      } catch (error) {
        return errorResponse(`confirm_payment_handshake failed: ${extractError(error)}`);
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────
// LANDING PAGE
// ─────────────────────────────────────────────────────────────
const getLandingPage = (activeSessions: number) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arara Revenue OS | MCP v${SERVER_VERSION}</title>
  <style>
    :root { --primary: #FF6B00; --bg: #050505; --text: #FFFFFF; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .container { text-align: center; padding: 2.5rem; border-radius: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); max-width: 440px; width: 90%; }
    .logo { font-size: 3rem; font-weight: 900; letter-spacing: -2px; margin-bottom: 0.5rem; background: linear-gradient(135deg, #fff 0%, var(--primary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,255,128,0.1); color: #00FF80; padding: 10px 20px; border-radius: 99px; font-size: 0.9rem; font-weight: 700; margin-bottom: 2rem; border: 1px solid rgba(0,255,128,0.2); }
    .dot { width: 10px; height: 10px; background: #00FF80; border-radius: 50%; box-shadow: 0 0 15px #00FF80; animation: pulse 1.5s infinite; }
    .tools { background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; text-align: left; font-size: 0.8rem; opacity: 0.7; margin-bottom: 1.5rem; }
    .tools li { padding: 2px 0; }
    p { opacity: 0.7; line-height: 1.6; font-size: 0.95rem; }
    @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.5; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Arara OS</div>
    <div class="status"><span class="dot"></span> Online — v${SERVER_VERSION}</div>
    <ul class="tools">
      <li>✅ send_smart_message</li>
      <li>✅ send_batch_messages</li>
      <li>✅ get_account_overview</li>
      <li>✅ manage_templates</li>
      <li>✅ create_campaign</li>
      <li>✅ manage_messages</li>
      <li>✅ manage_conversations</li>
      <li>✅ get_customer_insights</li>
      <li>✅ manage_organization</li>
      <li>✅ manage_api_keys</li>
      <li>✅ manage_knowledge_base</li>
      <li>✅ upload_media</li>
      <li>✅ check_revenue_leaks</li>
      <li>✅ negotiate_payment</li>
      <li>✅ confirm_payment_handshake</li>
    </ul>
    <p>Active sessions: <b>${activeSessions}</b></p>
    <p style="font-size:0.75rem; margin-top:1.5rem; opacity:0.4;">© 2026 AraraHQ • MCP v${SERVER_VERSION}</p>
  </div>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────
// SERVER BOOTSTRAP
// ─────────────────────────────────────────────────────────────
const server = new McpServer({ name: "arara-revenue-os", version: SERVER_VERSION });

async function run() {
  const isSSE =
    process.env.MCP_TRANSPORT === "sse" ||
    (process.env.PORT !== undefined && !process.argv.includes("--stdio"));

  if (isSSE) {
    const app = express();

    app.use((req, _res, next) => {
      console.error(`[${req.method}] ${req.url}`);
      next();
    });

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const transports = new Map<string, SSEServerTransport>();

    const getDeterministicSessionId = (req: express.Request): string | null => {
      const araraToken =
        (req.headers["x-arara-key"] as string) ||
        req.headers.authorization ||
        (req.query.Authorization as string);
      const abacateToken = req.headers["x-abacate-key"] as string;
      const token = araraToken || abacateToken;
      if (!token) return null;
      return "v-" + crypto.createHash("md5").update(token.toString().replace(/^Bearer\s+/i, "").trim()).digest("hex").substring(0, 12);
    };

    app.get("/", (_req, res) => res.send(getLandingPage(transports.size)));
    app.get("/debug", (req, res) => {
      res.json({
        headers: req.headers,
        query: req.query,
        ip: req.ip,
        deterministicId: getDeterministicSessionId(req),
        activeSessions: Array.from(transports.keys()),
      });
    });

    app.get("/.well-known/mcp/server-card.json", (req, res) => {
      const host = req.get("host") ?? "mcp.ararahq.com";
      const protocol = (req.headers["x-forwarded-proto"] as string) ?? (req.secure ? "https" : "http");
      res.json({
        mcpServers: {
          ararahq: {
            name: "Arara Revenue OS",
            version: SERVER_VERSION,
            url: `${protocol}://${host}/sse`,
            transport: "sse",
          },
        },
      });
    });

    const handleConnect = async (req: express.Request, res: express.Response) => {
      try {
        if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
          return res.send(getLandingPage(transports.size));
        }
        console.error(`[SSE] Connecting from ${req.ip}`);

        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Cache-Control", "no-cache, no-transform");

        const transport = new SSEServerTransport("/sse", res);
        const sessionId = transport.sessionId;

        transports.set(sessionId, transport);

        const araraToken = (req.headers["x-arara-key"] as string) || req.headers.authorization || (req.query.Authorization as string);
        const abacateToken = req.headers["x-abacate-key"] as string;
        if (araraToken) sessionKeysArara.set(sessionId, araraToken.toString().replace(/^Bearer\s+/i, "").trim());
        if (abacateToken) sessionKeysAbacate.set(sessionId, abacateToken.toString().replace(/^Bearer\s+/i, "").trim());

        const sessionServer = new McpServer({ name: "arara-revenue-os", version: SERVER_VERSION });
        registerTools(sessionServer);
        await sessionServer.connect(transport);

        res.write(":" + " ".repeat(128) + "\n\n");
        console.error(`[SSE] Session ready: ${sessionId}`);

        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(": keep-alive\n\n");
        }, 20000);

        res.on("close", () => {
          console.error(`[SSE] Session closed: ${sessionId}`);
          clearInterval(heartbeat);
          transports.delete(sessionId);
          sessionKeysArara.delete(sessionId);
          sessionKeysAbacate.delete(sessionId);
          sessionServer.close().catch(() => {});
        });
      } catch (error: any) {
        console.error(`[SSE FATAL] ${error.message}`);
        if (!res.headersSent) res.status(500).send(`Server Error: ${error.message}`);
      }
    };

    const handleMessage = async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = (req.query.sessionId as string) || getDeterministicSessionId(req);
        const transport = transports.get(sessionId ?? "");
        if (transport) {
          await sessionContext.run({ sessionId: sessionId! }, async () => {
            await transport.handlePostMessage(req, res, req.body);
          });
        } else {
          console.error(`[SSE] Session ${sessionId} not found. Active: [${Array.from(transports.keys()).join(",")}]`);
          res.status(400).send("Session not found. Connect via GET /sse first.");
        }
      } catch (error: any) {
        console.error(`[SSE FATAL] handleMessage: ${error.message}`);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
      }
    };

    app.all("/sse", (req, res) => {
      const isSSEInit = req.headers.accept?.includes("text/event-stream") || req.method === "GET";
      return isSSEInit ? handleConnect(req, res) : handleMessage(req, res);
    });

    app.all("/connect", (req, res) => handleConnect(req, res));
    app.all("/messages", (req, res) => handleMessage(req, res));

    const port = process.env.PORT ?? 3333;
    app.listen(port, () => {
      console.error(`Arara Revenue OS v${SERVER_VERSION} listening on port ${port} (SSE)`);
    });
  } else {
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Arara Revenue OS v${SERVER_VERSION} listening (stdio)`);
  }
}

export function createSandboxServer() { return server; }

const isScan =
  process.argv.includes("--scan") ||
  process.argv.some((arg) => arg.includes("smithery")) ||
  process.env.SMITHERY === "true";

if (process.env.NODE_ENV !== "test" && !isScan) {
  run().catch((error) => { console.error("Fatal:", error); process.exit(1); });
}
