import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerContactTools = (server: McpServer) => {
  server.tool(
    "list_contacts",
    "List contacts in the organization with pagination. Supports substring search across name/phone/email via q.",
    {
      apiKey: z.string().optional(),
      q: z.string().optional().describe("Substring match on name/phone/email"),
      page: z.number().int().min(0).optional().default(0),
      size: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ apiKey, q, page, size }) => {
      try {
        const response = await apiGet("/v1/contacts", {
          tokenOverride: apiKey,
          params: q ? { q, page, size } : { page, size },
          toolName: "list_contacts",
        });
        const data = response.data ?? {};
        const contacts: any[] = data.contacts ?? [];
        if (contacts.length === 0) return successResponse("No contacts found.");
        const lines = contacts.map((c: any) =>
          `- ${c.id} | ${c.name} | ${c.phone} | ${c.email ?? ""}`,
        );
        return successResponse([
          `Contacts (page ${data.page ?? 0}/${(data.totalPages ?? 1) - 1}, total ${data.total ?? contacts.length}):`,
          ``,
          lines.join("\n"),
        ].join("\n"));
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "upsert_contacts",
    "Create or update up to 1000 contacts in a single batch. Returns counts of created/updated/skipped and detailed errors per row. Phone must be E.164.",
    {
      apiKey: z.string().optional(),
      contacts: z.array(z.object({
        name: z.string().max(255),
        phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164, e.g. +5511999998888"),
        email: z.string().max(255).optional(),
        attributes: z.record(z.unknown()).optional().describe("Free-form custom attributes (any JSON)"),
      })).min(1).max(1000),
    },
    async ({ apiKey, contacts }) => {
      try {
        const response = await apiPost("/v1/contacts/batch", contacts, {
          tokenOverride: apiKey,
          toolName: "upsert_contacts",
        });
        const r = response.data ?? {};
        const lines = [
          `Batch imported.`,
          `  Import ID: ${r.importId ?? "N/A"}`,
          `  Created:   ${r.created ?? 0}`,
          `  Updated:   ${r.updated ?? 0}`,
          `  Skipped:   ${r.skipped ?? 0}`,
        ];
        if (Array.isArray(r.errors) && r.errors.length > 0) {
          lines.push(``, `Errors (${r.errors.length}):`);
          for (const e of r.errors.slice(0, 10)) {
            lines.push(`  [${e.index}] ${e.phone ?? "?"} — ${e.reason}`);
          }
          if (r.errors.length > 10) lines.push(`  ... +${r.errors.length - 10} more`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Import failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_contact",
    "Fetch a single contact by E.164 phone. Returns name, email, custom attributes, createdAt.",
    {
      apiKey: z.string().optional(),
      phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
    },
    async ({ apiKey, phone }) => {
      try {
        const response = await apiGet(`/v1/contacts/${encodeURIComponent(phone)}`, {
          tokenOverride: apiKey,
          toolName: "get_contact",
        });
        const c = response.data ?? {};
        const attrs = c.attributes ? JSON.stringify(c.attributes, null, 2) : "none";
        return successResponse([
          `${c.name ?? "Contact"} (${phone})`,
          `  ID:         ${c.id ?? "N/A"}`,
          `  Email:      ${c.email ?? "—"}`,
          `  Created:    ${c.createdAt ?? "N/A"}`,
          `  Attributes: ${attrs}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Lookup failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_contact_stats",
    "Aggregate stats over the organization's contacts (total, with email, with attributes, etc).",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/contacts/stats", {
          tokenOverride: apiKey,
          toolName: "get_contact_stats",
        });
        const s = response.data ?? {};
        const lines = Object.entries(s).map(([k, v]) => `  ${k.padEnd(20)} ${v}`);
        return successResponse(`Contact stats:\n\n${lines.join("\n")}`);
      } catch (error) {
        return errorResponse(`Stats failed: ${extractError(error)}`);
      }
    },
  );
};
