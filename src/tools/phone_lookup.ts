import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerPhoneLookupTools = (server: McpServer) => {
  server.tool(
    "lookup_phone",
    "Validate one phone number and confirm whether it has WhatsApp installed. Returns line type (mobile/landline), carrier, hasWhatsapp. Charges R$ 0,05 per lookup from your wallet. Use before sending to avoid wasting messages on invalid numbers.",
    {
      apiKey: z.string().optional(),
      phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
    },
    async ({ apiKey, phoneNumber }) => {
      try {
        const response = await apiPost("/v1/phone-lookup", { phoneNumber }, {
          tokenOverride: apiKey,
          toolName: "lookup_phone",
        });
        const r = response.data ?? {};
        return successResponse([
          `Phone lookup — ${phoneNumber}`,
          `  Mobile:        ${r.isMobile ?? "?"}`,
          `  Line type:     ${r.lineType ?? "?"}`,
          `  Carrier:       ${r.carrier ?? "?"}`,
          `  Has WhatsApp:  ${r.hasWhatsapp ?? "?"}`,
          `  Charged:       R$ ${Number(r.costCharged ?? 0).toFixed(2)}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Lookup failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "lookup_phones_batch",
    "Validate up to N phone numbers in one call. Stops at the first INSUFFICIENT_FUNDS — you see how many were processed and can recharge before continuing. Each successful lookup costs R$ 0,05.",
    {
      apiKey: z.string().optional(),
      phoneNumbers: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/, "Each phone must be E.164")).min(1).max(500),
    },
    async ({ apiKey, phoneNumbers }) => {
      try {
        const response = await apiPost("/v1/phone-lookup/batch", { phoneNumbers }, {
          tokenOverride: apiKey,
          toolName: "lookup_phones_batch",
          timeoutMs: 60_000,
        });
        const r = response.data ?? {};
        const results: any[] = r.results ?? [];
        const ok = results.filter((x) => !x.error).length;
        const failed = results.filter((x) => x.error).length;
        return successResponse([
          `Batch lookup`,
          `  Total submitted: ${phoneNumbers.length}`,
          `  Succeeded:       ${ok}`,
          `  Failed:          ${failed}`,
          `  Total charged:   R$ ${Number(r.totalCharged ?? 0).toFixed(2)}`,
          `  Insufficient funds: ${r.insufficientFunds ?? false}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Batch lookup failed: ${extractError(error)}`);
      }
    },
  );
};
