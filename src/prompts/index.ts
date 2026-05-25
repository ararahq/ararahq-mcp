import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const registerAllPrompts = (server: McpServer): void => {
  server.registerPrompt(
    "plan_campaign",
    {
      title: "Plan a new WhatsApp campaign",
      description: "Step-by-step planning of a campaign: define audience, pick an approved template, estimate cost, and confirm dispatch.",
      argsSchema: {
        audience: z.string().describe("Who you want to reach (e.g. 'leads from last 7 days', 'paid customers in São Paulo')"),
        goal: z.string().describe("What outcome you want (e.g. 'recover abandoned carts', 'announce new feature')"),
      },
    },
    async ({ audience, goal }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Plan a WhatsApp campaign in 4 steps. Use Arara tools and resources to back every decision with real data.`,
            ``,
            `**Audience:** ${audience}`,
            `**Goal:** ${goal}`,
            ``,
            `Steps:`,
            `1. Read \`arara://templates/approved\` and pick the template that best matches the goal. If nothing fits, suggest creating a new one via \`create_template\`.`,
            `2. Call \`list_contacts\` with a query that matches the audience description, or ask the user for a specific filter.`,
            `3. Call \`estimate_campaign_cost\` with the chosen template + audience size. Read \`arara://wallet/balance\` to confirm the org can afford it.`,
            `4. If the user confirms, call \`create_campaign\` with an Idempotency-Key. After dispatch, suggest checking \`get_campaign\` in 5 minutes and triaging replies with \`list_conversations status=OPEN\`.`,
            ``,
            `Stop at any step and ask the user to confirm before moving on. Never dispatch without explicit approval.`,
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "respond_to_complaint",
    {
      title: "Respond to a customer complaint",
      description: "Handle a COMPLAINT conversation safely: read history, draft a reply via Brain, get approval, send.",
      argsSchema: {
        conversationId: z.string().describe("The conversation UUID that contains the complaint"),
      },
    },
    async ({ conversationId }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Handle a complaint on conversation **${conversationId}**.`,
            ``,
            `1. Call \`get_conversation_messages\` with conversationId=${conversationId} to read the full history.`,
            `2. Identify the customer's specific pain. Summarize back to the operator: "the customer is complaining about X because Y".`,
            `3. Call \`brain_suggest_reply\` with the customer's last message — this returns a reply consistent with the org's tone and knowledge base.`,
            `4. Show the suggestion to the operator. Ask: "Send as-is, edit, or escalate to human?".`,
            `5. On approval, call \`reply_in_conversation\` (Guardian will block sensitive content automatically). On "escalate", suggest manual takeover via dashboard.`,
            ``,
            `Tone: empathetic, accountable, never defensive. Never promise refunds or compensation without explicit operator approval.`,
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "recover_revenue",
    {
      title: "Run a revenue recovery cycle",
      description: "Scan AbacatePay for revenue leaks, enrich with WhatsApp history, propose offers, and dispatch payment links with operator approval.",
      argsSchema: {
        minAmountBrl: z.string().optional().describe("Skip leaks below this R$ threshold (e.g. '100')"),
      },
    },
    async ({ minAmountBrl }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Run a revenue recovery cycle:`,
            ``,
            `1. Call \`find_revenue_leaks\` with limit=20 ${minAmountBrl ? `and minAmountBrl=${minAmountBrl}` : ""} and enrichWithHistory=true. This returns each leak + customer phone + prior WhatsApp interactions.`,
            `2. For each leak, propose ONE concrete recovery action to the operator: tier the offer (e.g. 5% off for fresh leaks, 10% for older, "last chance" for >7 days). Show your reasoning per leak.`,
            `3. Wait for the operator to approve which ones to recover. Skip the rest.`,
            `4. For each approved leak, call \`negotiate_payment\` with the agreed amountCentavos and a short whatsappMessage that mentions the offer and the link. Guardian will block sensitive patterns.`,
            `5. After dispatch, suggest scheduling a follow-up with \`schedule\` if you have access, or remind the operator to check \`check_payment_status\` in 24h.`,
            ``,
            `Never auto-negotiate without per-leak approval. The conversation is the contract — the operator stays in the loop.`,
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "onboard_customer",
    {
      title: "Onboard a new customer to WhatsApp",
      description: "Validate the number, fetch contact info if known, and send a templated welcome message.",
      argsSchema: {
        phone: z.string().describe("Customer phone in E.164 (e.g. +5511999998888)"),
        name: z.string().describe("Customer name (used in template variables)"),
      },
    },
    async ({ phone, name }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Onboard customer **${name}** (${phone}) to WhatsApp:`,
            ``,
            `1. Call \`lookup_phone\` with ${phone}. Confirm hasWhatsapp=true. If false, stop and report — no point sending.`,
            `2. Call \`get_contact\` with phone=${phone}. If exists, summarize what we know. If not, call \`upsert_contacts\` to register {name: "${name}", phone: "${phone}"}.`,
            `3. Read \`arara://templates/approved\` and pick a welcome template (category UTILITY or MARKETING). If none exists, stop and suggest creating one.`,
            `4. Call \`send_message\` with templateName + templateVariables=[${JSON.stringify(name)}] to deliver the welcome.`,
            `5. Confirm: report messageId + status, and recommend opening \`list_conversations status=OPEN\` to watch for the reply.`,
            ``,
            `Cost note: phone lookup charges R$ 0,05 — confirm budget if running this at scale.`,
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly Arara review",
      description: "Pull this week's wallet balance, delivery metrics, top templates, recovery funnel, and active campaigns into a single executive summary.",
      argsSchema: {},
    },
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Compile a weekly Arara review using Resources + Tools. Output a short executive summary the operator can paste into a Slack/email update.`,
            ``,
            `Gather:`,
            `1. \`arara://wallet/balance\` — current balance and whether a recharge is needed`,
            `2. \`get_delivery_metrics\` — sent/delivered/read/failed and delivery rate`,
            `3. \`arara://campaigns/recent\` — last 10 campaigns with sent counts and spend`,
            `4. \`arara://recovery/funnel\` — recovery endpoint health and recent ingest mix`,
            `5. \`arara://templates/approved\` — pick the top 3 templates by recent usage (if metrics allow) and call \`get_template_analytics\` on each`,
            ``,
            `Output format:`,
            `- Wallet: R$ X · status (healthy / low / critical)`,
            `- Delivery: X sent, Y% delivered, Z% read`,
            `- Campaigns: N this week, R$ X spent, top campaign by reach`,
            `- Recovery: N events ingested, X% processed`,
            `- Templates: top 3 with key rate`,
            `- Recommended action (one concrete next step)`,
            ``,
            `Keep it under 150 words. Concrete numbers, no fluff.`,
          ].join("\n"),
        },
      }],
    }),
  );
};
