import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

const PHONE = /^\+[1-9]\d{6,14}$/;

export const registerLgpdTools = (server: McpServer) => {
  server.tool(
    "lgpd_export_contact",
    "LGPD/GDPR data portability: return everything the organization holds about one contact (profile, conversations, messages). Use to fulfill a 'I want a copy of my data' request. Output is JSON suitable for sending to the customer.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE, "Phone must be E.164"),
    },
    async ({ apiKey, phone }) => {
      try {
        const response = await apiGet(`/v1/contacts/${encodeURIComponent(phone)}/lgpd/export`, {
          tokenOverride: apiKey,
          toolName: "lgpd_export_contact",
        });
        const d = response.data ?? {};
        const lines = [
          `LGPD export ready for ${phone}.`,
          `  Phone hash:     ${d.phoneHash ?? "?"}`,
          `  Exported at:    ${d.exportedAt ?? ""}`,
          `  Contact:        ${d.contact ? "yes" : "no"}`,
          `  Conversations:  ${(d.conversations ?? []).length}`,
          `  Messages:       ${(d.messages ?? []).length}`,
          ``,
          `Full payload (JSON below — deliver to the data subject):`,
          ``,
          JSON.stringify(d, null, 2),
        ];
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Export failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "lgpd_delete_contact",
    "LGPD/GDPR right to erasure: redact all stored content tied to this phone and remove the contact. Messages get their body replaced with a REDACTED stamp (FK integrity preserved). The phone is also registered as opt-out so future sends are blocked. NOT REVERSIBLE — confirm with the data subject before calling.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(PHONE, "Phone must be E.164"),
      reason: z.string().max(80).optional().describe("e.g. 'user request via support', 'GDPR delete'"),
    },
    async ({ apiKey, phone, reason }) => {
      try {
        const url = `/v1/contacts/${encodeURIComponent(phone)}/lgpd${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`;
        const response = await apiDelete(url, {
          tokenOverride: apiKey,
          toolName: "lgpd_delete_contact",
        });
        const r = response.data ?? {};
        return successResponse([
          `LGPD deletion complete for ${phone}.`,
          `  Phone hash:               ${r.phoneHash ?? "?"}`,
          `  Contact deleted:          ${r.contactDeleted ?? false}`,
          `  Conversations redacted:   ${r.conversationsRedacted ?? 0}`,
          `  Messages redacted:        ${r.messagesRedacted ?? 0}`,
          `  Opt-out registered:       ${r.optOutRegistered ?? false}`,
          `  Completed at:             ${r.deletedAt ?? ""}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Deletion failed: ${extractError(error)}`);
      }
    },
  );
};
