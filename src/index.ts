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
const ARARA_BASE = process.env.ARARA_BASE_URL || "https://api.ararahq.com/api";
const ABACATE_BASE = "https://api.abacatepay.com/v2";
const SERVER_VERSION = "2.1.0";

// --- SESSION CONTEXT ---
const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();
const sessionKeysArara = new Map<string, string>();
const sessionKeysAbacate = new Map<string, string>();
const sessionGuardianRules = new Map<string, string[]>(); // custom brand rules per session

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

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 3 — GUARDIAN MODE
// Full-stack brand safety firewall applied to ALL outbound content.
// ─────────────────────────────────────────────────────────────────────────────
const BUILT_IN_SENSITIVE_PATTERNS = [
  /\bpassword\b/i, /\bsenha\b/i, /credit.?card/i, /cartão.?de.?crédito/i,
  /\bcpf\b/i, /\bcnpj\b/i, /\bcvv\b/i, /api[_-]?key/i, /\bsecret\b/i,
  /\btoken\b/i,
];

const guardian = (
  text: string,
  customRules: string[] = [],
): { safe: boolean; reason?: string } => {
  for (const pattern of BUILT_IN_SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Built-in policy violation: sensitive pattern "${pattern.source}"` };
    }
  }
  for (const rule of customRules) {
    const regex = new RegExp(rule, "i");
    if (regex.test(text)) {
      return { safe: false, reason: `Brand policy violation: custom rule "${rule}"` };
    }
  }
  return { safe: true };
};

const getCustomRules = (): string[] => {
  const context = sessionContext.getStore();
  return context ? (sessionGuardianRules.get(context.sessionId) ?? []) : [];
};

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 4 — BUSINESS MEMORY LAYER — Sentiment Engine
// ─────────────────────────────────────────────────────────────────────────────
const POSITIVE_SIGNALS = [
  "obrigado", "obrigada", "ótimo", "perfeito", "adorei", "excelente", "parabéns",
  "funcionou", "resolvido", "show", "boa", "incrível", "top", "satisfeito", "feliz",
];

const NEGATIVE_SIGNALS = [
  "péssimo", "horrível", "absurdo", "decepcionado", "reclamação", "problema",
  "errado", "falhou", "nunca mais", "cancelar", "reembolso", "fraude", "raiva",
  "desapontado", "lamentável",
];

const URGENCY_SIGNALS = [
  "urgente", "urgência", "emergência", "crítico", "perda", "processo",
  "advogado", "procon", "consumidor.gov", "reclame aqui",
];

const scoreSentiment = (messages: any[]): {
  score: number;
  mood: string;
  urgencyFlag: boolean;
  signals: string[];
} => {
  const inbound = messages
    .filter((m: any) => m.direction === "INBOUND" || !m.direction)
    .map((m: any) => (m.body ?? "").toLowerCase())
    .join(" ");

  let score = 0;
  const detectedSignals: string[] = [];

  for (const signal of POSITIVE_SIGNALS) {
    if (inbound.includes(signal)) { score += 1; detectedSignals.push(`+${signal}`); }
  }
  for (const signal of NEGATIVE_SIGNALS) {
    if (inbound.includes(signal)) { score -= 2; detectedSignals.push(`-${signal}`); }
  }

  const urgencyFlag = URGENCY_SIGNALS.some((signal) => inbound.includes(signal));
  if (urgencyFlag) score -= 5;

  const mood = score >= 2 ? "POSITIVE" : score <= -3 ? "NEGATIVE" : "NEUTRAL";
  return { score, mood, urgencyFlag, signals: detectedSignals };
};

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 5 — TRIAGE ENGINE for campaign response classification
// ─────────────────────────────────────────────────────────────────────────────
const QUESTION_PATTERNS = [/\?/, /como\s/, /quando\s/, /onde\s/, /qual\s/, /\bdúvida\b/i, /\bprazo\b/i];
const classifyResponse = (text: string): "URGENT" | "COMPLAINT" | "QUESTION" | "POSITIVE" | "ROUTINE" => {
  const normalized = text.toLowerCase();
  if (URGENCY_SIGNALS.some((s) => normalized.includes(s))) return "URGENT";
  if (NEGATIVE_SIGNALS.some((s) => normalized.includes(s))) return "COMPLAINT";
  if (QUESTION_PATTERNS.some((p) => p.test(normalized))) return "QUESTION";
  if (POSITIVE_SIGNALS.some((s) => normalized.includes(s))) return "POSITIVE";
  return "ROUTINE";
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
function registerTools(serverInstance: McpServer) {

  // ───────────────────────────────────────────────────────
  // PILLAR 3 — Configure Guardian Policy
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "configure_guardian_policy",
    "Set custom brand safety rules for this session. All outbound messages will be blocked if they match any configured rule. Built-in rules (CPF, CVV, passwords, API keys) are always active.",
    {
      rules: z.array(z.string()).describe(
        "Array of regex patterns to block, e.g. [\"concorrente\", \"preço errado\", \"grátis\"]. Case-insensitive.",
      ),
      replace: z.boolean().optional().default(false).describe(
        "If true, replaces all current custom rules. If false (default), appends to existing rules.",
      ),
    },
    async ({ rules, replace }) => {
      const context = sessionContext.getStore();
      if (!context) {
        const sessionId = "default";
        const current = replace ? [] : (sessionGuardianRules.get(sessionId) ?? []);
        sessionGuardianRules.set(sessionId, [...current, ...rules]);
        return successResponse(`🛡️ Guardian policy updated. Active custom rules: ${[...current, ...rules].length}`);
      }
      const current = replace ? [] : (sessionGuardianRules.get(context.sessionId) ?? []);
      const next = [...current, ...rules];
      sessionGuardianRules.set(context.sessionId, next);
      return successResponse([
        `🛡️ Guardian policy updated.`,
        `  Custom rules active: ${next.length}`,
        `  Rules: ${next.map((r) => `"${r}"`).join(", ")}`,
        ``,
        `Built-in protections (always on): CPF, CNPJ, CVV, passwords, API keys, tokens.`,
      ].join("\n"));
    },
  );

  // ───────────────────────────────────────────────────────
  // MESSAGING — send_smart_message (Pillar 3: Guardian)
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "send_smart_message",
    "Send a WhatsApp message to a single recipient. Guardian mode (Pillar 3) blocks sensitive content and brand policy violations.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      to: z.string().describe("Recipient phone in E.164 format (e.g. +5511999999999)"),
      text: z.string().describe("Plain text message body"),
      skipGuardian: z.boolean().optional().default(false).describe("Bypass guardian. Use only for system messages."),
    },
    async ({ apiKey, to, text, skipGuardian }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      if (!skipGuardian) {
        const check = guardian(text, getCustomRules());
        if (!check.safe) return errorResponse(`🛡️ GUARDIAN INTERCEPT: ${check.reason}`);
      }
      try {
        const response = await axios.post(
          `${ARARA_BASE}/v1/messages`,
          { receiver: to, body: text },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        return successResponse(`✅ Sent. ID: ${response.data.id} | To: ${to}`);
      } catch (error) {
        return errorResponse(`Send failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // MESSAGING — send_batch_messages (Pillar 3: Guardian on every body)
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "send_batch_messages",
    "Send up to 1000 WhatsApp messages in a single call. Guardian mode screens every message body before dispatch.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      messages: z.array(z.object({
        to: z.string().describe("Recipient phone in E.164 format"),
        text: z.string().describe("Message body for this recipient"),
      })).min(1).max(1000),
      skipGuardian: z.boolean().optional().default(false),
    },
    async ({ apiKey, messages, skipGuardian }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      if (!skipGuardian) {
        const customRules = getCustomRules();
        for (const message of messages) {
          const check = guardian(message.text, customRules);
          if (!check.safe) {
            return errorResponse(
              `🛡️ GUARDIAN INTERCEPT on message to ${message.to}: ${check.reason}. Entire batch blocked.`,
            );
          }
        }
      }

      try {
        const response = await axios.post(
          `${ARARA_BASE}/v1/messages/batch`,
          { messages: messages.map((m) => ({ receiver: m.to, body: m.text })) },
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        return successResponse(
          `✅ Batch complete. Sent: ${response.data?.sent ?? messages.length} | Failed: ${response.data?.failed ?? 0}`,
        );
      } catch (error) {
        return errorResponse(`Batch send failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 1 — Autonomous Revenue Recovery
  // Scans ALL leaks, enriches with customer message history,
  // calculates total R$ at risk, returns a full action briefing.
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "autonomous_recovery",
    "Pillar 1: Proactively scans AbacatePay for revenue leaks (pending/expired/cancelled checkouts), enriches each with WhatsApp message history, and returns a complete action briefing with total R$ at risk. The agent doesn't wait for orders — it surfaces the opportunity.",
    {
      araraKey: z.string().optional().describe("Arara API Key"),
      abacateKey: z.string().optional().describe("AbacatePay API Key"),
      limit: z.number().optional().default(20).describe("Max checkouts to scan"),
      minAmountBrl: z.number().optional().default(0).describe("Minimum leak amount in BRL to include in briefing"),
    },
    async ({ araraKey, abacateKey, limit, minAmountBrl }) => {
      const activeAraraKey = getAraraKey(araraKey);
      const activeAbacateKey = getAbacateKey(abacateKey);
      if (!activeAbacateKey) return errorResponse("Missing AbacatePay API Key.");

      try {
        const checkoutsResp = await axios.get(`${ABACATE_BASE}/checkouts/list`, {
          headers: { Authorization: `Bearer ${activeAbacateKey}` },
          params: { limit },
        });

        const allCheckouts: any[] = checkoutsResp.data?.data ?? [];
        const leaks = allCheckouts.filter((checkout: any) =>
          ["PENDING", "EXPIRED", "CANCELLED"].includes(checkout.status) &&
          (checkout.amount ?? 0) / 100 >= minAmountBrl,
        );

        if (leaks.length === 0) {
          return successResponse("✅ No revenue leaks detected. All funnels are healthy.");
        }

        const totalAtRisk = leaks.reduce((sum: number, l: any) => sum + ((l.amount ?? 0) / 100), 0);

        // Enrich each leak with customer message history in parallel
        const enriched = await Promise.all(
          leaks.map(async (leak: any) => {
            const customerPhone = leak.customer?.cellphone ?? leak.customer?.phone;
            let lastMessage = "no history";
            let messageCount = 0;

            if (activeAraraKey && customerPhone) {
              try {
                const msgResp = await axios.get(`${ARARA_BASE}/dashboard/messages`, {
                  headers: { Authorization: `Bearer ${activeAraraKey}` },
                  params: { receiver: customerPhone, limit: 5 },
                });
                const msgs: any[] = msgResp.data?.data ?? msgResp.data ?? [];
                messageCount = msgs.length;
                lastMessage = msgs[0]?.body ?? "no history";
              } catch (_) { /* non-critical */ }
            }

            return { leak, customerPhone, messageCount, lastMessage };
          }),
        );

        const briefingLines = [
          `🚨 REVENUE RECOVERY BRIEFING`,
          ``,
          `Total at risk: R$ ${totalAtRisk.toFixed(2)} across ${leaks.length} open checkout(s)`,
          ``,
        ];

        for (const { leak, customerPhone, messageCount, lastMessage } of enriched) {
          const amount = ((leak.amount ?? 0) / 100).toFixed(2);
          briefingLines.push(`━━ Checkout ${leak.id}`);
          briefingLines.push(`   Customer: ${leak.customer?.name ?? "N/A"} | Phone: ${customerPhone ?? "N/A"}`);
          briefingLines.push(`   Amount:   R$ ${amount} | Status: ${leak.status}`);
          briefingLines.push(`   History:  ${messageCount} prior message(s)`);
          briefingLines.push(`   Last msg: "${lastMessage}"`);
          briefingLines.push(`   Action:   use atomic_negotiation_cycle to close this now`);
          briefingLines.push(``);
        }

        briefingLines.push(`Ready to recover. Call atomic_negotiation_cycle for each customer.`);

        return successResponse(briefingLines.join("\n"));
      } catch (error) {
        return errorResponse(`autonomous_recovery failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 2 — Atomic Negotiation Cycle
  // Creates discounted offer → sends link via WhatsApp →
  // returns tracking IDs. One call, full cycle. O diálogo vira o contrato.
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "atomic_negotiation_cycle",
    "Pillar 2: Full negotiation in one atomic call. Creates the product on AbacatePay, generates the checkout, sends the payment link directly to the customer via WhatsApp, and returns all tracking IDs. The conversation becomes the contract.",
    {
      araraKey: z.string().optional().describe("Arara API Key"),
      abacateKey: z.string().optional().describe("AbacatePay API Key"),
      customerPhone: z.string().describe("Customer phone in E.164 format"),
      customerEmail: z.string().email().optional().describe("Customer email (optional but improves checkout experience)"),
      amountCentavos: z.number().int().positive().describe("Negotiated amount in centavos, e.g. 9990 = R$99.90"),
      offerDescription: z.string().describe("Offer description shown to the customer on checkout"),
      whatsappMessage: z.string().describe("The WhatsApp message text to send alongside the payment link"),
    },
    async ({ araraKey, abacateKey, customerPhone, customerEmail, amountCentavos, offerDescription, whatsappMessage }) => {
      const activeAraraKey = getAraraKey(araraKey);
      const activeAbacateKey = getAbacateKey(abacateKey);

      if (!activeAbacateKey) return errorResponse("Missing AbacatePay API Key.");
      if (!activeAraraKey) return errorResponse("Missing Arara API Key.");

      const guardianCheck = guardian(whatsappMessage, getCustomRules());
      if (!guardianCheck.safe) {
        return errorResponse(`🛡️ GUARDIAN INTERCEPT: ${guardianCheck.reason}`);
      }

      let checkoutUrl: string;
      let checkoutId: string;
      let messageId: string;

      // Step 1: Create product on AbacatePay
      try {
        const productResp = await axios.post(
          `${ABACATE_BASE}/products/create`,
          {
            externalId: `neg-${Date.now()}`,
            name: offerDescription,
            price: amountCentavos,
            currency: "BRL",
          },
          { headers: { Authorization: `Bearer ${activeAbacateKey}` } },
        );
        const productId = productResp.data?.data?.id;

        // Step 2: Create checkout
        const checkoutPayload: Record<string, unknown> = {
          items: [{ id: productId, quantity: 1 }],
          methods: ["PIX", "CARD"],
          returnUrl: "https://ararahq.com/",
          completionUrl: "https://ararahq.com/paid",
        };
        if (customerEmail) checkoutPayload.customer = { email: customerEmail, cellphone: customerPhone };

        const checkoutResp = await axios.post(
          `${ABACATE_BASE}/checkouts/create`,
          checkoutPayload,
          { headers: { Authorization: `Bearer ${activeAbacateKey}` } },
        );
        checkoutUrl = checkoutResp.data?.data?.url;
        checkoutId = checkoutResp.data?.data?.id;
      } catch (error) {
        return errorResponse(`Negotiation failed at checkout creation: ${extractError(error)}`);
      }

      // Step 3: Send WhatsApp message with link
      const fullMessage = `${whatsappMessage}\n\n${checkoutUrl}`;
      try {
        const msgResp = await axios.post(
          `${ARARA_BASE}/v1/messages`,
          { receiver: customerPhone, body: fullMessage },
          { headers: { Authorization: `Bearer ${activeAraraKey}` } },
        );
        messageId = msgResp.data?.id;
      } catch (error) {
        return errorResponse(
          `Checkout created (ID: ${checkoutId}) but WhatsApp delivery failed: ${extractError(error)}. Send manually: ${checkoutUrl}`,
        );
      }

      return successResponse([
        `💎 ATOMIC NEGOTIATION COMPLETE`,
        ``,
        `Customer:    ${customerPhone}`,
        `Amount:      R$ ${(amountCentavos / 100).toFixed(2)}`,
        `Checkout ID: ${checkoutId}`,
        `Message ID:  ${messageId}`,
        ``,
        `The payment link was sent directly to the customer via WhatsApp.`,
        `Use confirm_payment_handshake with checkoutId "${checkoutId}" to verify payment.`,
      ].join("\n"));
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 2 — Confirm Payment Handshake
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "confirm_payment_handshake",
    "Pillar 2: Verify real-time payment status of an AbacatePay checkout. Use after atomic_negotiation_cycle to confirm the deal closed.",
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
        const amount = checkout?.amount ? `R$ ${(checkout.amount / 100).toFixed(2)}` : "N/A";
        return successResponse(`${icons[status] ?? "❓"} Checkout ${checkoutId}: ${status} | Amount: ${amount}`);
      } catch (error) {
        return errorResponse(`confirm_payment_handshake failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 4 — Business Memory Layer
  // Deep customer profiling: sentiment, LTV, interaction
  // timeline, mood score. Optionally saves to knowledge base.
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "build_business_memory",
    "Pillar 4: Deep customer intelligence. Analyzes full conversation history for sentiment and mood, estimates LTV from AbacatePay history, builds a structured memory profile, and optionally persists it to the AI knowledge base for long-term recall.",
    {
      araraKey: z.string().optional().describe("Arara API Key"),
      abacateKey: z.string().optional().describe("AbacatePay API Key"),
      phone: z.string().describe("Customer phone in E.164 format"),
      email: z.string().optional().describe("Customer email for AbacatePay lookup"),
      saveToKnowledgeBase: z.boolean().optional().default(false).describe(
        "If true, automatically saves this memory profile to the AI knowledge base for long-term recall",
      ),
    },
    async ({ araraKey, abacateKey, phone, email, saveToKnowledgeBase }) => {
      const activeAraraKey = getAraraKey(araraKey);
      const activeAbacateKey = getAbacateKey(abacateKey);
      if (!activeAraraKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeAraraKey}` };
      const profile: Record<string, unknown> = { phone, email: email ?? "N/A" };

      // Fetch message history (last 50 for meaningful sentiment analysis)
      let messages: any[] = [];
      try {
        const msgResp = await axios.get(`${ARARA_BASE}/dashboard/messages`, {
          headers,
          params: { receiver: phone, limit: 50 },
        });
        messages = msgResp.data?.data ?? msgResp.data ?? [];
        profile.totalMessages = messages.length;
        profile.firstContactAt = messages[messages.length - 1]?.createdAt ?? "unknown";
        profile.lastContactAt = messages[0]?.createdAt ?? "unknown";
        profile.lastMessageBody = messages[0]?.body ?? "N/A";
      } catch (_) {
        profile.totalMessages = 0;
      }

      // Sentiment analysis
      const sentiment = scoreSentiment(messages);
      profile.moodScore = sentiment.score;
      profile.mood = sentiment.mood;
      profile.urgencyFlag = sentiment.urgencyFlag;
      profile.sentimentSignals = sentiment.signals;

      // AbacatePay LTV
      let ltv = 0;
      let totalPurchases = 0;
      if (email && activeAbacateKey) {
        try {
          const checkoutsResp = await axios.get(`${ABACATE_BASE}/checkouts/list`, {
            headers: { Authorization: `Bearer ${activeAbacateKey}` },
            params: { limit: 100 },
          });
          const allCheckouts: any[] = checkoutsResp.data?.data ?? [];
          const customerCheckouts = allCheckouts.filter(
            (checkout: any) => checkout.customer?.email === email,
          );
          const paidCheckouts = customerCheckouts.filter((c: any) => c.status === "PAID");
          ltv = paidCheckouts.reduce((sum: number, c: any) => sum + ((c.amount ?? 0) / 100), 0);
          totalPurchases = paidCheckouts.length;
          profile.ltv = `R$ ${ltv.toFixed(2)}`;
          profile.totalPurchases = totalPurchases;
          profile.pendingCheckouts = customerCheckouts.filter((c: any) => c.status === "PENDING").length;
        } catch (_) {
          profile.ltv = "unavailable";
        }
      }

      // Engagement tier based on LTV + interactions
      let tier = "NEW";
      if (ltv > 1000 || (messages as any[]).length > 20) tier = "ENGAGED";
      if (ltv > 5000) tier = "VIP";
      if (sentiment.urgencyFlag) tier = `${tier} ⚠️ ESCALATE`;
      profile.tier = tier;

      const profileText = [
        `🧠 BUSINESS MEMORY LAYER — ${phone}`,
        ``,
        `📊 Engagement:`,
        `  Total Messages:  ${profile.totalMessages}`,
        `  First Contact:   ${profile.firstContactAt}`,
        `  Last Contact:    ${profile.lastContactAt}`,
        `  Last Message:    "${profile.lastMessageBody}"`,
        `  Tier:            ${tier}`,
        ``,
        `🎭 Sentiment Analysis:`,
        `  Mood Score: ${sentiment.score} (${sentiment.mood})`,
        `  Urgency:    ${sentiment.urgencyFlag ? "⚠️ YES — ESCALATE IMMEDIATELY" : "no"}`,
        `  Signals:    ${sentiment.signals.length > 0 ? sentiment.signals.join(", ") : "neutral"}`,
        ``,
        `💰 Lifetime Value (AbacatePay):`,
        `  LTV:              ${profile.ltv ?? "N/A (no email provided)"}`,
        `  Paid Orders:      ${totalPurchases}`,
        `  Pending Checkout: ${profile.pendingCheckouts ?? 0}`,
      ].join("\n");

      // Optionally persist to knowledge base
      if (saveToKnowledgeBase) {
        try {
          await axios.post(
            `${ARARA_BASE}/v1/brain/knowledge`,
            {
              title: `Customer Profile — ${phone}`,
              content: profileText,
            },
            { headers },
          );
          return successResponse(`${profileText}\n\n✅ Profile saved to knowledge base for long-term AI recall.`);
        } catch (_) {
          return successResponse(`${profileText}\n\n⚠️ Profile built but could not be saved to knowledge base.`);
        }
      }

      return successResponse(profileText);
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 5 — Create Campaign (Mass Orchestration — Dispatch)
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "create_campaign",
    "Pillar 5: Dispatch a template campaign to a segmented list of recipients. Each recipient can have individual variables. Returns campaign ID and dispatch time for use with monitor_campaign_responses.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      templateId: z.string().describe("Approved template ID"),
      recipients: z.array(z.object({
        phone: z.string(),
        variables: z.record(z.string()).optional().describe("Template variable values, e.g. {\"1\": \"John\"}"),
      })).min(1).describe("Recipient list with optional per-recipient variables"),
      scheduledAt: z.string().optional().describe("ISO 8601 datetime to schedule. Omit for immediate dispatch."),
    },
    async ({ apiKey, templateId, recipients, scheduledAt }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const payload: Record<string, unknown> = { templateId, recipients };
      if (scheduledAt) payload.scheduledAt = scheduledAt;

      try {
        const dispatchTime = new Date().toISOString();
        const response = await axios.post(
          `${ARARA_BASE}/v1/campaigns`,
          payload,
          { headers: { Authorization: `Bearer ${activeKey}` } },
        );
        const campaign = response.data;
        return successResponse([
          `🚀 Campaign dispatched.`,
          `  ID:          ${campaign.id ?? "N/A"}`,
          `  Template:    ${templateId}`,
          `  Recipients:  ${recipients.length}`,
          `  Dispatch:    ${scheduledAt ?? "Immediate"}`,
          `  Dispatched at: ${dispatchTime}`,
          ``,
          `To monitor responses: use monitor_campaign_responses with dispatchedAt="${dispatchTime}"`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Campaign creation failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // PILLAR 5 — Monitor Campaign Responses
  // Reads conversations since dispatch, classifies each response,
  // returns triage queue. AI handles routine, escalates critical.
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "monitor_campaign_responses",
    "Pillar 5: After dispatching a campaign, fetch and triage all inbound responses. Classifies each as URGENT / COMPLAINT / QUESTION / POSITIVE / ROUTINE. Returns an action queue: the AI auto-handles routine, escalates only the critical ones to a human.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      dispatchedAt: z.string().optional().describe("ISO 8601 datetime of campaign dispatch. Used to filter recent conversations."),
      limit: z.number().optional().default(50).describe("Max conversations to scan"),
      autoReplyToPositive: z.boolean().optional().default(false).describe(
        "If true, automatically sends a thank-you reply to POSITIVE responses.",
      ),
      autoReplyMessage: z.string().optional().describe("Message to auto-send to POSITIVE responses (required if autoReplyToPositive is true)"),
    },
    async ({ apiKey, dispatchedAt, limit, autoReplyToPositive, autoReplyMessage }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");

      const headers = { Authorization: `Bearer ${activeKey}` };

      try {
        const convsResp = await axios.get(`${ARARA_BASE}/v1/conversations`, {
          headers,
          params: { limit, status: "OPEN" },
        });
        const conversations: any[] = convsResp.data?.data ?? convsResp.data ?? [];

        const triage: Record<string, any[]> = {
          URGENT: [], COMPLAINT: [], QUESTION: [], POSITIVE: [], ROUTINE: [],
        };

        for (const conv of conversations) {
          // Fetch latest inbound message for this conversation
          let lastInboundText = "";
          try {
            const histResp = await axios.get(
              `${ARARA_BASE}/v1/conversations/${conv.id}/messages`,
              { headers, params: { limit: 5 } },
            );
            const msgs: any[] = histResp.data?.data ?? histResp.data ?? [];
            const lastInbound = msgs.find((m: any) => m.direction === "INBOUND" || !m.direction);
            lastInboundText = lastInbound?.body ?? "";
          } catch (_) { /* skip */ }

          if (!lastInboundText) continue;

          const classification = classifyResponse(lastInboundText);
          triage[classification].push({
            conversationId: conv.id,
            phone: conv.phone ?? conv.customerPhone ?? "N/A",
            lastMessage: lastInboundText,
            classification,
          });

          // Auto-reply to POSITIVE if configured
          if (autoReplyToPositive && classification === "POSITIVE" && autoReplyMessage) {
            const guardianCheck = guardian(autoReplyMessage, getCustomRules());
            if (guardianCheck.safe) {
              try {
                await axios.post(
                  `${ARARA_BASE}/v1/conversations/reply`,
                  {
                    conversationId: conv.id,
                    body: autoReplyMessage,
                    receiver: conv.phone ?? conv.customerPhone,
                  },
                  { headers },
                );
                triage[classification][triage[classification].length - 1].autoReplied = true;
              } catch (_) { /* non-critical */ }
            }
          }
        }

        const totalClassified = Object.values(triage).flat().length;
        const lines = [
          `📊 CAMPAIGN RESPONSE TRIAGE`,
          `  Conversations scanned: ${conversations.length}`,
          `  Classified: ${totalClassified}`,
          ``,
        ];

        if (triage.URGENT.length > 0) {
          lines.push(`🔴 URGENT (escalate immediately — ${triage.URGENT.length}):`);
          for (const item of triage.URGENT) {
            lines.push(`  • ${item.phone}: "${item.lastMessage}"`);
          }
          lines.push(``);
        }

        if (triage.COMPLAINT.length > 0) {
          lines.push(`🟠 COMPLAINTS (human review — ${triage.COMPLAINT.length}):`);
          for (const item of triage.COMPLAINT) {
            lines.push(`  • ${item.phone}: "${item.lastMessage}"`);
          }
          lines.push(``);
        }

        if (triage.QUESTION.length > 0) {
          lines.push(`🟡 QUESTIONS (AI can handle — ${triage.QUESTION.length}):`);
          for (const item of triage.QUESTION) {
            lines.push(`  • ${item.phone} [${item.conversationId}]: "${item.lastMessage}"`);
          }
          lines.push(``);
        }

        if (triage.POSITIVE.length > 0) {
          const autoReplied = triage.POSITIVE.filter((i: any) => i.autoReplied).length;
          lines.push(`🟢 POSITIVE (${triage.POSITIVE.length}${autoReplied > 0 ? ` — ${autoReplied} auto-replied` : ""}):`);
          for (const item of triage.POSITIVE) {
            lines.push(`  • ${item.phone}: "${item.lastMessage}"${(item as any).autoReplied ? " ✅ auto-replied" : ""}`);
          }
          lines.push(``);
        }

        if (triage.ROUTINE.length > 0) {
          lines.push(`⚪ ROUTINE (${triage.ROUTINE.length} — low priority)`);
          lines.push(``);
        }

        lines.push(`Action: Use manage_conversations with action="reply" for QUESTION items.`);
        lines.push(`Escalate URGENT and COMPLAINT to a human agent.`);

        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`monitor_campaign_responses failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // ACCOUNT — get_account_overview
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "get_account_overview",
    "Full account snapshot: wallet balance, delivery metrics (sent/delivered/read/failed), total spend and delivery rate.",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
    },
    async ({ apiKey }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      try {
        const [balanceResp, metricsResp] = await Promise.all([
          axios.get(`${ARARA_BASE}/dashboard/wallet/balance`, { headers: { Authorization: `Bearer ${activeKey}` } }),
          axios.get(`${ARARA_BASE}/dashboard/metrics`, { headers: { Authorization: `Bearer ${activeKey}` } }),
        ]);
        const balance = balanceResp.data?.balance ?? balanceResp.data;
        const metrics = metricsResp.data;
        return successResponse([
          `💰 ACCOUNT OVERVIEW`,
          ``,
          `Wallet Balance: R$ ${Number(balance).toFixed(2)}`,
          ``,
          `📊 Delivery Metrics:`,
          `  Sent:        ${metrics.sent ?? 0}`,
          `  Delivered:   ${metrics.delivered ?? 0}`,
          `  Read:        ${metrics.read ?? 0}`,
          `  Failed:      ${metrics.failed ?? 0}`,
          `  Pending:     ${metrics.pending ?? 0}`,
          `  Delivery Rate: ${metrics.deliveryRate ?? metrics.delivery_rate ?? "N/A"}%`,
          `  Total Spend:   R$ ${Number(metrics.totalCost ?? metrics.total_cost ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`get_account_overview failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // TEMPLATES — manage_templates
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_templates",
    "Full template lifecycle: list, create, check approval status, view analytics, or delete.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["list", "create", "get_status", "get_analytics", "delete"]),
      templateId: z.string().optional().describe("Required for: get_status, get_analytics, delete"),
      name: z.string().optional().describe("Required for: create"),
      language: z.string().optional().default("pt_BR"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional().describe("Required for: create"),
      bodyText: z.string().optional().describe("Template body text with {{1}} {{2}} variables. Required for: create"),
      headerText: z.string().optional(),
      footerText: z.string().optional(),
      filterByName: z.string().optional(),
      limit: z.number().optional().default(20),
    },
    async ({ apiKey, action, templateId, name, language, category, bodyText, headerText, footerText, filterByName, limit }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      const headers = { Authorization: `Bearer ${activeKey}` };
      try {
        switch (action) {
          case "list": {
            const params: Record<string, unknown> = { limit };
            if (filterByName) params.name = filterByName;
            const response = await axios.get(`${ARARA_BASE}/v1/templates`, { headers, params });
            const templates: any[] = response.data?.data ?? response.data ?? [];
            if (templates.length === 0) return successResponse("No templates found.");
            const lines = templates.map((t: any) =>
              `- ${t.id} | ${t.name} | ${t.status} | ${t.category} | ${t.language}`,
            );
            return successResponse(`📋 Templates (${templates.length}):\n\n${lines.join("\n")}`);
          }
          case "create": {
            if (!name || !category || !bodyText) return errorResponse("name, category and bodyText required for create.");
            const components: any[] = [{ type: "BODY", text: bodyText }];
            if (headerText) components.unshift({ type: "HEADER", format: "TEXT", text: headerText });
            if (footerText) components.push({ type: "FOOTER", text: footerText });
            const response = await axios.post(
              `${ARARA_BASE}/v1/templates`,
              { name, language: language ?? "pt_BR", category, components },
              { headers },
            );
            return successResponse(
              `✅ Template created. ID: ${response.data.id} | Status: ${response.data.status ?? "PENDING"}`,
            );
          }
          case "get_status": {
            if (!templateId) return errorResponse("templateId required.");
            const response = await axios.get(`${ARARA_BASE}/v1/templates/${templateId}/status`, { headers });
            const status = response.data?.status ?? response.data;
            const icons: Record<string, string> = { APPROVED: "✅", REJECTED: "❌", PENDING: "⏳" };
            return successResponse(`${icons[status] ?? "❓"} Template ${templateId}: ${status}`);
          }
          case "get_analytics": {
            if (!templateId) return errorResponse("templateId required.");
            const response = await axios.get(`${ARARA_BASE}/v1/templates/${templateId}/analytics`, { headers });
            const a = response.data;
            return successResponse([
              `📊 Template Analytics — ${templateId}`,
              `  Sent: ${a.sent ?? 0} | Delivered: ${a.delivered ?? 0} | Read: ${a.read ?? 0} | Failed: ${a.failed ?? 0}`,
              `  Delivery Rate: ${a.deliveryRate ?? a.delivery_rate ?? "N/A"}% | Read Rate: ${a.readRate ?? a.read_rate ?? "N/A"}%`,
            ].join("\n"));
          }
          case "delete": {
            if (!templateId) return errorResponse("templateId required.");
            await axios.delete(`${ARARA_BASE}/v1/templates/${templateId}`, { headers });
            return successResponse(`🗑️ Template ${templateId} deleted.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_templates[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // MESSAGES — manage_messages
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_messages",
    "List messages from the dashboard or get the status of a specific message by ID.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["list", "get_status"]),
      messageId: z.string().optional().describe("Required for: get_status"),
      limit: z.number().optional().default(20),
      page: z.number().optional().default(0),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE"),
    },
    async ({ apiKey, action, messageId, limit, page, mode }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      const headers = { Authorization: `Bearer ${activeKey}` };
      try {
        if (action === "list") {
          const response = await axios.get(`${ARARA_BASE}/dashboard/messages`, {
            headers,
            params: { limit, page, mode },
          });
          const messages: any[] = response.data?.data ?? response.data ?? [];
          if (messages.length === 0) return successResponse("No messages found.");
          const lines = messages.map((m: any) =>
            `- ${m.id} | To: ${m.receiver ?? m.to} | ${m.status} | ${m.createdAt ?? ""}`,
          );
          return successResponse(`📨 Messages (${messages.length}):\n\n${lines.join("\n")}`);
        }
        if (!messageId) return errorResponse("messageId required for get_status.");
        const response = await axios.get(`${ARARA_BASE}/v1/messages/${messageId}`, { headers });
        const message = response.data;
        const icons: Record<string, string> = { DELIVERED: "✅", READ: "👁️", SENT: "📤", FAILED: "❌", PENDING: "⏳" };
        return successResponse([
          `${icons[message.status] ?? "❓"} Message ${messageId}`,
          `  Status: ${message.status} | To: ${message.receiver ?? message.to}`,
          `  Body: ${message.body ?? "N/A"}`,
          `  Created: ${message.createdAt ?? "N/A"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`manage_messages[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // CONVERSATIONS — manage_conversations
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_conversations",
    "List active conversations, get full message history, or reply in an open session window. Guardian mode active on replies.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["list", "get_history", "reply"]),
      conversationId: z.string().optional().describe("Required for: get_history, reply"),
      replyText: z.string().optional().describe("Required for: reply"),
      replyPhone: z.string().optional().describe("Required for: reply"),
      status: z.string().optional().describe("Filter: OPEN, CLOSED (for: list)"),
      limit: z.number().optional().default(20),
      page: z.number().optional().default(0),
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
            const conversations: any[] = response.data?.data ?? response.data ?? [];
            if (conversations.length === 0) return successResponse("No conversations found.");
            const lines = conversations.map((c: any) =>
              `- ${c.id} | ${c.phone ?? c.customerPhone ?? "N/A"} | ${c.status} | ${c.lastMessageAt ?? ""}`,
            );
            return successResponse(`💬 Conversations (${conversations.length}):\n\n${lines.join("\n")}`);
          }
          case "get_history": {
            if (!conversationId) return errorResponse("conversationId required.");
            const response = await axios.get(
              `${ARARA_BASE}/v1/conversations/${conversationId}/messages`,
              { headers, params: { limit, page } },
            );
            const messages: any[] = response.data?.data ?? response.data ?? [];
            if (messages.length === 0) return successResponse("No messages in this conversation.");
            const lines = messages.map((m: any) => {
              const direction = m.direction === "INBOUND" ? "←" : "→";
              return `${direction} [${m.createdAt ?? ""}] ${m.body ?? ""}`;
            });
            return successResponse(`📜 Conversation ${conversationId}:\n\n${lines.join("\n")}`);
          }
          case "reply": {
            if (!conversationId || !replyText || !replyPhone) {
              return errorResponse("conversationId, replyText and replyPhone required for reply.");
            }
            const check = guardian(replyText, getCustomRules());
            if (!check.safe) return errorResponse(`🛡️ GUARDIAN: ${check.reason}`);
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

  // ───────────────────────────────────────────────────────
  // ORGANIZATION — manage_organization
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_organization",
    "Manage organization settings: phone numbers, webhook config, AI brain config, team members.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["get_numbers", "get_webhook", "update_webhook", "get_brain_config", "update_brain_config", "list_members"]),
      webhookUrl: z.string().optional().describe("Required for: update_webhook"),
      webhookSecret: z.string().optional(),
      brainConfig: z.record(z.unknown()).optional().describe("Required for: update_brain_config"),
    },
    async ({ apiKey, action, webhookUrl, webhookSecret, brainConfig }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      const headers = { Authorization: `Bearer ${activeKey}` };
      try {
        switch (action) {
          case "get_numbers": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/numbers`, { headers });
            const numbers: any[] = response.data?.data ?? response.data ?? [];
            if (numbers.length === 0) return successResponse("No phone numbers assigned.");
            const lines = numbers.map((n: any) =>
              `- ${n.phoneNumber ?? n.number} | Alias: ${n.alias ?? "none"} | Default: ${n.isDefault ? "yes" : "no"}`,
            );
            return successResponse(`📱 Numbers (${numbers.length}):\n\n${lines.join("\n")}`);
          }
          case "get_webhook": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/webhook`, { headers });
            const config = response.data;
            return successResponse([
              `🔗 Webhook: ${config.url ?? config.webhookUrl ?? "not configured"}`,
              `  Secret: ${config.secret ? "set (hidden)" : "not set"}`,
            ].join("\n"));
          }
          case "update_webhook": {
            if (!webhookUrl) return errorResponse("webhookUrl required.");
            const body: Record<string, string> = { url: webhookUrl };
            if (webhookSecret) body.secret = webhookSecret;
            await axios.patch(`${ARARA_BASE}/organizations/me/webhook`, body, { headers });
            return successResponse(`✅ Webhook updated: ${webhookUrl}`);
          }
          case "get_brain_config": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/brain-config`, { headers });
            return successResponse(`🧠 Brain Config:\n\n${JSON.stringify(response.data, null, 2)}`);
          }
          case "update_brain_config": {
            if (!brainConfig) return errorResponse("brainConfig required.");
            await axios.patch(`${ARARA_BASE}/organizations/me/brain-config`, brainConfig, { headers });
            return successResponse(`✅ Brain config updated.`);
          }
          case "list_members": {
            const response = await axios.get(`${ARARA_BASE}/organizations/me/members`, { headers });
            const members: any[] = response.data?.data ?? response.data ?? [];
            if (members.length === 0) return successResponse("No team members found.");
            const lines = members.map((m: any) => `- ${m.name ?? "N/A"} | ${m.email ?? "N/A"} | ${m.role ?? "N/A"}`);
            return successResponse(`👥 Members (${members.length}):\n\n${lines.join("\n")}`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_organization[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // API KEYS — manage_api_keys
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_api_keys",
    "List, create or revoke Arara API keys.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["list", "create", "revoke"]),
      keyId: z.string().optional().describe("Required for: revoke"),
      mode: z.enum(["LIVE", "TEST"]).optional().default("LIVE"),
      keyName: z.string().optional(),
    },
    async ({ apiKey, action, keyId, mode, keyName }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      const headers = { Authorization: `Bearer ${activeKey}` };
      try {
        switch (action) {
          case "list": {
            const response = await axios.get(`${ARARA_BASE}/api-keys`, { headers });
            const keys: any[] = response.data?.data ?? response.data ?? [];
            if (keys.length === 0) return successResponse("No API keys found.");
            const lines = keys.map((k: any) =>
              `- ${k.id} | ${k.name ?? "N/A"} | ${k.mode ?? "N/A"} | Created: ${k.createdAt ?? "N/A"}`,
            );
            return successResponse(`🔑 API Keys (${keys.length}):\n\n${lines.join("\n")}`);
          }
          case "create": {
            const body: Record<string, string> = { mode: mode ?? "LIVE" };
            if (keyName) body.name = keyName;
            const response = await axios.post(`${ARARA_BASE}/api-keys`, body, { headers });
            return successResponse([
              `✅ API Key created.`,
              `  ID:  ${response.data.id}`,
              `  Key: ${response.data.key ?? response.data.apiKey ?? "See dashboard"}`,
              `  Mode: ${response.data.mode ?? mode}`,
              `⚠️  Save this key — it will not be shown again.`,
            ].join("\n"));
          }
          case "revoke": {
            if (!keyId) return errorResponse("keyId required.");
            await axios.delete(`${ARARA_BASE}/api-keys/${keyId}`, { headers });
            return successResponse(`🗑️ Key ${keyId} revoked.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_api_keys[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // KNOWLEDGE BASE — manage_knowledge_base
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "manage_knowledge_base",
    "Read and write the AI brain knowledge base. Used by build_business_memory to persist customer profiles for long-term recall.",
    {
      apiKey: z.string().optional(),
      action: z.enum(["list", "save", "update", "delete"]),
      knowledgeId: z.string().optional().describe("Required for: update, delete"),
      content: z.string().optional().describe("Required for: save, update"),
      title: z.string().optional(),
    },
    async ({ apiKey, action, knowledgeId, content, title }) => {
      const activeKey = getAraraKey(apiKey);
      if (!activeKey) return errorResponse("Missing Arara API Key.");
      const headers = { Authorization: `Bearer ${activeKey}` };
      try {
        switch (action) {
          case "list": {
            const response = await axios.get(`${ARARA_BASE}/v1/brain/knowledge`, { headers });
            const entries: any[] = response.data?.data ?? response.data ?? [];
            if (entries.length === 0) return successResponse("Knowledge base is empty.");
            const lines = entries.map((entry: any) =>
              `- ${entry.id} | ${entry.title ?? "N/A"}\n  ${(entry.content ?? "").substring(0, 80)}...`,
            );
            return successResponse(`📚 Knowledge Base (${entries.length}):\n\n${lines.join("\n\n")}`);
          }
          case "save": {
            if (!content) return errorResponse("content required.");
            const body: Record<string, string> = { content };
            if (title) body.title = title;
            const response = await axios.post(`${ARARA_BASE}/v1/brain/knowledge`, body, { headers });
            return successResponse(`✅ Knowledge saved. ID: ${response.data.id}`);
          }
          case "update": {
            if (!knowledgeId || !content) return errorResponse("knowledgeId and content required.");
            const body: Record<string, string> = { content };
            if (title) body.title = title;
            await axios.put(`${ARARA_BASE}/v1/brain/knowledge/${knowledgeId}`, body, { headers });
            return successResponse(`✅ Knowledge ${knowledgeId} updated.`);
          }
          case "delete": {
            if (!knowledgeId) return errorResponse("knowledgeId required.");
            await axios.delete(`${ARARA_BASE}/v1/brain/knowledge/${knowledgeId}`, { headers });
            return successResponse(`🗑️ Knowledge ${knowledgeId} deleted.`);
          }
        }
      } catch (error) {
        return errorResponse(`manage_knowledge_base[${action}] failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // MEDIA — upload_media
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "upload_media",
    "Upload a media file to Arara R2 storage from a public URL. Returns the short URL to use in messages.",
    {
      apiKey: z.string().optional(),
      fileUrl: z.string().url().describe("Public URL of the file to upload"),
      filename: z.string().optional(),
      mimeType: z.string().optional(),
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

  // ───────────────────────────────────────────────────────
  // ABACATEPAY — check_revenue_leaks (simple scan, use autonomous_recovery for full context)
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "check_revenue_leaks",
    "Quick scan for AbacatePay revenue leaks (pending/expired/cancelled). For a full briefing with customer context, use autonomous_recovery instead.",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      limit: z.number().optional().default(20),
    },
    async ({ apiKey, limit }) => {
      const activeKey = getAbacateKey(apiKey);
      if (!activeKey) return errorResponse("Missing AbacatePay API Key.");
      try {
        const response = await axios.get(`${ABACATE_BASE}/checkouts/list`, {
          headers: { Authorization: `Bearer ${activeKey}` },
          params: { limit },
        });
        const leaks = (response.data?.data ?? []).filter((checkout: any) =>
          ["PENDING", "EXPIRED", "CANCELLED"].includes(checkout.status),
        );
        if (leaks.length === 0) return successResponse("✅ No revenue leaks found.");
        const total = leaks.reduce((sum: number, l: any) => sum + ((l.amount ?? 0) / 100), 0);
        const lines = leaks.map((l: any) =>
          `- ${l.id} | ${l.customer?.name ?? "N/A"} | ${l.status} | R$ ${((l.amount ?? 0) / 100).toFixed(2)}`,
        );
        return successResponse(
          `🚨 Revenue Leaks (${leaks.length}) — R$ ${total.toFixed(2)} at risk:\n\n${lines.join("\n")}\n\nFor full customer context: use autonomous_recovery.`,
        );
      } catch (error) {
        return errorResponse(`check_revenue_leaks failed: ${extractError(error)}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────
  // ABACATEPAY — negotiate_payment (simple flow, use atomic_negotiation_cycle for full cycle)
  // ───────────────────────────────────────────────────────
  serverInstance.tool(
    "negotiate_payment",
    "Create a product and checkout link on AbacatePay. For a full atomic cycle that also sends the link via WhatsApp, use atomic_negotiation_cycle instead.",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      customerEmail: z.string().email(),
      customerPhone: z.string(),
      amount: z.number().int().positive().describe("Amount in centavos"),
      description: z.string(),
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
          ``,
          `Next: use send_smart_message to deliver the link, or use atomic_negotiation_cycle for a single-call flow.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`negotiate_payment failed: ${extractError(error)}`);
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDING PAGE
// ─────────────────────────────────────────────────────────────────────────────
const getLandingPage = (activeSessions: number) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arara Revenue OS | MCP v${SERVER_VERSION}</title>
  <style>
    :root { --primary: #FF6B00; --bg: #050505; --text: #FFFFFF; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 2rem 0; }
    .container { text-align: center; padding: 2.5rem; border-radius: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); max-width: 480px; width: 90%; }
    .logo { font-size: 2.5rem; font-weight: 900; letter-spacing: -2px; margin-bottom: 0.5rem; background: linear-gradient(135deg, #fff 0%, var(--primary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,255,128,0.1); color: #00FF80; padding: 8px 18px; border-radius: 99px; font-size: 0.85rem; font-weight: 700; margin-bottom: 1.5rem; border: 1px solid rgba(0,255,128,0.2); }
    .dot { width: 8px; height: 8px; background: #00FF80; border-radius: 50%; animation: pulse 1.5s infinite; }
    .pillars { text-align: left; margin-bottom: 1.5rem; }
    .pillar { padding: 0.75rem; border-radius: 10px; background: rgba(255,255,255,0.04); margin-bottom: 0.5rem; font-size: 0.8rem; }
    .pillar-title { font-weight: 700; color: var(--primary); margin-bottom: 0.25rem; }
    .pillar-tools { opacity: 0.6; font-size: 0.75rem; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Arara OS</div>
    <div class="status"><span class="dot"></span> v${SERVER_VERSION} — Online</div>
    <div class="pillars">
      <div class="pillar"><div class="pillar-title">🔴 P1 — Autonomous Revenue Recovery</div><div class="pillar-tools">autonomous_recovery · atomic_negotiation_cycle · confirm_payment_handshake</div></div>
      <div class="pillar"><div class="pillar-title">🟠 P2 — Atomic Negotiation</div><div class="pillar-tools">atomic_negotiation_cycle · negotiate_payment · confirm_payment_handshake</div></div>
      <div class="pillar"><div class="pillar-title">🛡️ P3 — Guardian Mode</div><div class="pillar-tools">configure_guardian_policy · active on all outbound tools</div></div>
      <div class="pillar"><div class="pillar-title">🧠 P4 — Business Memory Layer</div><div class="pillar-tools">build_business_memory · manage_knowledge_base</div></div>
      <div class="pillar"><div class="pillar-title">🚀 P5 — Mass Orchestration</div><div class="pillar-tools">create_campaign · monitor_campaign_responses · send_batch_messages</div></div>
    </div>
    <p style="font-size:0.75rem; opacity:0.4;">Active sessions: ${activeSessions} · © 2026 AraraHQ</p>
  </div>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// SERVER BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
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
      return "v-" + crypto
        .createHash("md5")
        .update(token.toString().replace(/^Bearer\s+/i, "").trim())
        .digest("hex")
        .substring(0, 12);
    };

    app.get("/", (_req, res) => res.send(getLandingPage(transports.size)));
    app.get("/debug", (req, res) => res.json({
      headers: req.headers,
      query: req.query,
      ip: req.ip,
      deterministicId: getDeterministicSessionId(req),
      activeSessions: Array.from(transports.keys()),
    }));

    app.get("/.well-known/mcp/server-card.json", (req, res) => {
      const host = req.get("host") ?? "mcp.ararahq.com";
      const protocol = (req.headers["x-forwarded-proto"] as string) ?? (req.secure ? "https" : "http");
      res.json({
        mcpServers: {
          ararahq: { name: "Arara Revenue OS", version: SERVER_VERSION, url: `${protocol}://${host}/sse`, transport: "sse" },
        },
      });
    });

    const handleConnect = async (req: express.Request, res: express.Response) => {
      try {
        if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
          return res.send(getLandingPage(transports.size));
        }
        console.error(`[SSE] New connection from ${req.ip}`);
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
          console.error(`[SSE] Closed: ${sessionId}`);
          clearInterval(heartbeat);
          transports.delete(sessionId);
          sessionKeysArara.delete(sessionId);
          sessionKeysAbacate.delete(sessionId);
          sessionGuardianRules.delete(sessionId);
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
      console.error(`Arara Revenue OS v${SERVER_VERSION} on port ${port} (SSE)`);
    });
  } else {
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Arara Revenue OS v${SERVER_VERSION} (stdio)`);
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
