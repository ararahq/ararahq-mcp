import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAbacateKey } from "../lib/auth.js";
import { abacateGet, abacatePost, apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";
import { guardian, getCustomRules } from "../lib/guardian.js";

export const registerAbacateTools = (server: McpServer) => {
  server.tool(
    "find_revenue_leaks",
    "Scan AbacatePay for pending / expired / cancelled checkouts (revenue leaks). Optionally enrich each with the customer's WhatsApp history to give a complete recovery briefing. Returns total R$ at risk + per-leak action context.",
    {
      abacateKey: z.string().optional().describe("AbacatePay API key"),
      araraKey: z.string().optional().describe("Arara token for enrichment (optional)"),
      limit: z.number().int().min(1).max(100).optional().default(20),
      minAmountBrl: z.number().min(0).optional().default(0).describe("Skip leaks below this R$ threshold"),
      enrichWithHistory: z.boolean().optional().default(true).describe("Fetch WhatsApp history per customer for the briefing"),
    },
    async ({ abacateKey, araraKey, limit, minAmountBrl, enrichWithHistory }) => {
      const activeAbacate = getAbacateKey(abacateKey);
      if (!activeAbacate) return errorResponse("Missing AbacatePay API key.");
      try {
        const checkoutsResp = await abacateGet("/checkouts/list", activeAbacate, { limit });
        const all: any[] = checkoutsResp.data?.data ?? [];
        const leaks = all.filter((c: any) =>
          ["PENDING", "EXPIRED", "CANCELLED"].includes(c.status) &&
          (c.amount ?? 0) / 100 >= minAmountBrl,
        );

        if (leaks.length === 0) {
          return successResponse("No revenue leaks detected. Funnels are healthy.");
        }

        const totalAtRisk = leaks.reduce((sum: number, l: any) => sum + ((l.amount ?? 0) / 100), 0);

        const enriched = enrichWithHistory
          ? await Promise.all(leaks.map(async (leak: any) => {
              const phone = leak.customer?.cellphone ?? leak.customer?.phone;
              let lastMessage = "no history";
              let messageCount = 0;
              if (phone && araraKey) {
                try {
                  const msgResp = await apiGet("/dashboard/messages", {
                    tokenOverride: araraKey,
                    params: { receiver: phone, limit: 5 },
                    toolName: "find_revenue_leaks",
                  });
                  const msgs: any[] = msgResp.data?.data ?? msgResp.data ?? [];
                  messageCount = msgs.length;
                  lastMessage = msgs[0]?.body ?? "no history";
                } catch (_) { /* skip */ }
              }
              return { leak, phone, messageCount, lastMessage };
            }))
          : leaks.map((leak: any) => ({ leak, phone: leak.customer?.cellphone ?? leak.customer?.phone, messageCount: 0, lastMessage: "—" }));

        const lines = [
          `REVENUE RECOVERY BRIEFING`,
          ``,
          `Total at risk: R$ ${totalAtRisk.toFixed(2)} across ${leaks.length} open checkout(s)`,
          ``,
        ];
        for (const { leak, phone, messageCount, lastMessage } of enriched) {
          const amount = ((leak.amount ?? 0) / 100).toFixed(2);
          lines.push(`━━ Checkout ${leak.id}`);
          lines.push(`   Customer: ${leak.customer?.name ?? "N/A"} | Phone: ${phone ?? "N/A"}`);
          lines.push(`   Amount:   R$ ${amount} | Status: ${leak.status}`);
          if (enrichWithHistory) {
            lines.push(`   History:  ${messageCount} prior message(s)`);
            lines.push(`   Last msg: "${lastMessage}"`);
          }
          lines.push(`   Action:   negotiate_payment to close this`);
          lines.push(``);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Recovery scan failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "negotiate_payment",
    "Full negotiation cycle in one atomic call: creates the product on AbacatePay → generates checkout → sends the payment link to the customer via WhatsApp. Returns checkoutId + messageId. The conversation becomes the contract.",
    {
      abacateKey: z.string().optional().describe("AbacatePay API key"),
      araraKey: z.string().optional().describe("Arara token"),
      customerPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
      customerEmail: z.string().email().optional(),
      amountCentavos: z.number().int().positive().describe("Negotiated amount in centavos (e.g. 9990 = R$ 99,90)"),
      offerDescription: z.string().describe("Shown to the customer on checkout"),
      whatsappMessage: z.string().describe("The WhatsApp message sent with the payment link. Guardian-checked."),
    },
    async ({ abacateKey, araraKey, customerPhone, customerEmail, amountCentavos, offerDescription, whatsappMessage }) => {
      const activeAbacate = getAbacateKey(abacateKey);
      if (!activeAbacate) return errorResponse("Missing AbacatePay API key.");
      const guardianCheck = guardian(whatsappMessage, getCustomRules());
      if (!guardianCheck.safe) return errorResponse(`GUARDIAN: ${guardianCheck.reason}`);

      let checkoutUrl: string;
      let checkoutId: string;
      try {
        const productResp = await abacatePost("/products/create", {
          externalId: `neg-${Date.now()}`,
          name: offerDescription,
          price: amountCentavos,
          currency: "BRL",
        }, activeAbacate);
        const productId = productResp.data?.data?.id;

        const checkoutPayload: Record<string, unknown> = {
          items: [{ id: productId, quantity: 1 }],
          methods: ["PIX", "CARD"],
          returnUrl: "https://ararahq.com/",
          completionUrl: "https://ararahq.com/paid",
        };
        if (customerEmail) checkoutPayload.customer = { email: customerEmail, cellphone: customerPhone };
        const checkoutResp = await abacatePost("/checkouts/create", checkoutPayload, activeAbacate);
        checkoutUrl = checkoutResp.data?.data?.url;
        checkoutId = checkoutResp.data?.data?.id;
      } catch (error) {
        return errorResponse(`Checkout creation failed: ${extractError(error)}`);
      }

      let messageId = "N/A";
      try {
        const msgResp = await apiPost("/v1/messages", {
          receiver: customerPhone,
          body: `${whatsappMessage}\n\n${checkoutUrl}`,
          type: "text",
        }, {
          tokenOverride: araraKey,
          toolName: "negotiate_payment",
        });
        messageId = msgResp.data?.id ?? "N/A";
      } catch (error) {
        return errorResponse(
          `Checkout ready (${checkoutId}) but WhatsApp delivery failed: ${extractError(error)}. Send manually: ${checkoutUrl}`,
        );
      }

      return successResponse([
        `NEGOTIATION COMPLETE`,
        ``,
        `Customer:    ${customerPhone}`,
        `Amount:      R$ ${(amountCentavos / 100).toFixed(2)}`,
        `Checkout:    ${checkoutId} → ${checkoutUrl}`,
        `Message ID:  ${messageId}`,
        ``,
        `Verify payment with check_payment_status using checkoutId "${checkoutId}".`,
      ].join("\n"));
    },
  );

  server.tool(
    "check_payment_status",
    "Verify the live payment status of one AbacatePay checkout. Use after negotiate_payment to confirm the deal closed.",
    {
      apiKey: z.string().optional().describe("AbacatePay API key"),
      checkoutId: z.string(),
    },
    async ({ apiKey, checkoutId }) => {
      const activeAbacate = getAbacateKey(apiKey);
      if (!activeAbacate) return errorResponse("Missing AbacatePay API key.");
      try {
        const response = await abacateGet("/checkouts/get", activeAbacate, { id: checkoutId });
        const checkout = response.data?.data;
        const status = checkout?.status ?? "UNKNOWN";
        const icons: Record<string, string> = { PAID: "", PENDING: "⏳", EXPIRED: "", CANCELLED: "" };
        const amount = checkout?.amount ? `R$ ${(checkout.amount / 100).toFixed(2)}` : "N/A";
        return successResponse(`${icons[status] ?? ""} Checkout ${checkoutId}: ${status} | ${amount}`);
      } catch (error) {
        return errorResponse(`Status check failed: ${extractError(error)}`);
      }
    },
  );
};
