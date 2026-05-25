import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionContext, sessionGuardianRules } from "../lib/auth.js";
import { successResponse } from "../lib/types.js";

export const registerGuardianTools = (server: McpServer) => {
  server.tool(
    "configure_guardian_policy",
    "Set custom brand-safety regex rules for THIS session. Every outbound text is checked against built-in patterns (CPF, CNPJ, CVV, passwords, API keys, tokens) plus your custom rules. Matches block the send. Rules live in memory and reset when the session ends.",
    {
      rules: z.array(z.string()).describe("Regex patterns to block (case-insensitive). Example: [\"concorrente\", \"preço errado\"]"),
      replace: z.boolean().optional().default(false).describe("If true, replaces existing rules. If false, appends."),
    },
    async ({ rules, replace }) => {
      const context = sessionContext.getStore();
      const sessionId = context?.sessionId ?? "default";
      const current = replace ? [] : (sessionGuardianRules.get(sessionId) ?? []);
      const next = [...current, ...rules];
      sessionGuardianRules.set(sessionId, next);
      return successResponse([
        `Guardian policy updated.`,
        `  Custom rules active: ${next.length}`,
        next.length > 0 ? `  Rules: ${next.map((r) => `"${r}"`).join(", ")}` : "",
        ``,
        `Built-in protections (always on): CPF, CNPJ, CVV, passwords, API keys, tokens.`,
      ].filter(Boolean).join("\n"));
    },
  );
};
