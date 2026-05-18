import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPut, apiDelete, extractError } from "../lib/api.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerBrainTools = (server: McpServer) => {
  server.tool(
    "brain_interact",
    "Send a prompt to the Arara Brain (your AI agent trained on your org's templates, knowledge base, and conversation history). Returns the response text plus metadata about which sources were used. Use this when you want the Brain's answer about your business, not Claude's generic answer.",
    {
      apiKey: z.string().optional(),
      prompt: z.string().describe("The question or instruction for the Brain"),
      customerPhone: z.string().optional().describe("Customer phone to scope context to their conversation history"),
      contextType: z.enum(["HYBRID", "SUMMARY_ONLY", "RECENT_ONLY"]).optional().default("HYBRID"),
    },
    async ({ apiKey, prompt, customerPhone, contextType }) => {
      try {
        const response = await apiPost("/v1/brain/interact", {
          prompt, customerPhone, contextType,
        }, {
          tokenOverride: apiKey,
          toolName: "brain_interact",
          timeoutMs: 60_000,
        });
        const r = response.data ?? {};
        const lines = [
          `Brain response:`,
          ``,
          r.reply ?? r.message ?? r.text ?? JSON.stringify(r),
        ];
        if (r.sourcesUsed || r.tokensUsed) {
          lines.push(``, `(sources: ${r.sourcesUsed ?? "n/a"}, tokens: ${r.tokensUsed ?? "n/a"})`);
        }
        return successResponse(lines.join("\n"));
      } catch (error) {
        return errorResponse(`Brain failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "brain_suggest_reply",
    "Given a customer's most recent message, ask the Brain to draft a reply consistent with your tone and knowledge base. Returns the suggestion — you decide whether to send.",
    {
      apiKey: z.string().optional(),
      conversationId: z.string().optional().describe("Conversation UUID for context (optional)"),
      customerMessage: z.string().describe("The customer message you want to respond to"),
    },
    async ({ apiKey, conversationId, customerMessage }) => {
      try {
        const response = await apiPost("/v1/brain/suggest-reply", {
          conversationId, customerMessage,
        }, {
          tokenOverride: apiKey,
          toolName: "brain_suggest_reply",
          timeoutMs: 60_000,
        });
        const r = response.data ?? {};
        return successResponse([
          `Suggested reply:`,
          ``,
          r.reply ?? r.suggestion ?? JSON.stringify(r),
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Suggest failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "list_brain_knowledge",
    "List all knowledge entries the Brain has learned about your business (FAQs, policies, customer profiles, etc).",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/brain/knowledge", {
          tokenOverride: apiKey,
          toolName: "list_brain_knowledge",
        });
        const items: any[] = response.data ?? [];
        if (items.length === 0) return successResponse("Knowledge base is empty.");
        const lines = items.map((k: any) =>
          `- ${k.id} | type=${k.type ?? "?"} | updated ${k.updatedAt ?? "?"}\n  ${String(k.content ?? "").slice(0, 100)}${(k.content ?? "").length > 100 ? "..." : ""}`,
        );
        return successResponse(`Knowledge (${items.length}):\n\n${lines.join("\n\n")}`);
      } catch (error) {
        return errorResponse(`List failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "add_brain_knowledge",
    "Add a new knowledge entry to the Brain. Use for FAQs, business policies, product info, customer-specific notes. The Brain will recall these in future interactions.",
    {
      apiKey: z.string().optional(),
      type: z.string().optional().default("GENERAL").describe("Category: GENERAL, FAQ, POLICY, CUSTOMER_PROFILE, etc"),
      content: z.string().describe("The knowledge text"),
    },
    async ({ apiKey, type, content }) => {
      try {
        const response = await apiPost("/v1/brain/knowledge", { type, content }, {
          tokenOverride: apiKey,
          toolName: "add_brain_knowledge",
        });
        return successResponse(`Knowledge saved. ID: ${response.data?.id ?? "N/A"}`);
      } catch (error) {
        return errorResponse(`Save failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "update_brain_knowledge",
    "Update the content of an existing knowledge entry.",
    {
      apiKey: z.string().optional(),
      knowledgeId: z.string(),
      content: z.string(),
      type: z.string().optional().default("GENERAL"),
    },
    async ({ apiKey, knowledgeId, content, type }) => {
      try {
        await apiPut(`/v1/brain/knowledge/${knowledgeId}`, { type, content }, {
          tokenOverride: apiKey,
          toolName: "update_brain_knowledge",
        });
        return successResponse(`Knowledge ${knowledgeId} updated.`);
      } catch (error) {
        return errorResponse(`Update failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "delete_brain_knowledge",
    "Permanently remove a knowledge entry.",
    {
      apiKey: z.string().optional(),
      knowledgeId: z.string(),
    },
    async ({ apiKey, knowledgeId }) => {
      try {
        await apiDelete(`/v1/brain/knowledge/${knowledgeId}`, {
          tokenOverride: apiKey,
          toolName: "delete_brain_knowledge",
        });
        return successResponse(`Knowledge ${knowledgeId} deleted.`);
      } catch (error) {
        return errorResponse(`Delete failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "ingest_url_to_brain",
    "Crawl a public URL and ingest the content into the Brain's knowledge base. Use to onboard a help center, product page, terms-of-service, or any source the Brain should know.",
    {
      apiKey: z.string().optional(),
      url: z.string().url(),
    },
    async ({ apiKey, url }) => {
      try {
        const response = await apiPost("/v1/brain/ingest-url", { url }, {
          tokenOverride: apiKey,
          toolName: "ingest_url_to_brain",
          timeoutMs: 60_000,
        });
        const r = response.data ?? {};
        return successResponse([
          `Ingested ${url}`,
          `  OK:       ${r.ok ?? false}`,
          `  Title:    ${r.title ?? "—"}`,
          `  Chunks:   ${r.chunks ?? r.chunkCount ?? "?"}`,
          `  Reason:   ${r.reason ?? "—"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Ingest failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "get_brain_config",
    "Show the Brain's current configuration: persona, tone, autonomy level, escalation rules.",
    { apiKey: z.string().optional() },
    async ({ apiKey }) => {
      try {
        const response = await apiGet("/v1/brain/config", {
          tokenOverride: apiKey,
          toolName: "get_brain_config",
        });
        return successResponse(`Brain config:\n\n${JSON.stringify(response.data, null, 2)}`);
      } catch (error) {
        return errorResponse(`Fetch failed: ${extractError(error)}`);
      }
    },
  );
};
