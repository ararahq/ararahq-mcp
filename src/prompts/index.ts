import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const prompt = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export const registerAllPrompts = (server: McpServer): void => {
  server.registerPrompt(
    "triage_today",
    { description: "Prioritize today's Atendimento queue without taking write actions." },
    () =>
      prompt(
        "Read arara://operation/health, call get_today, and propose a prioritized queue. Show overdue items, unowned conversations, stage, owner, next step and SLA. Do not claim, reply or close anything without explicit confirmation.",
      ),
  );
  server.registerPrompt(
    "draft_reply",
    { description: "Draft a grounded reply for one conversation." },
    () =>
      prompt(
        "Use find_conversations and get_conversation to understand the selected case. Draft a concise reply consistent with the current stage and next step. Do not call reply_to_conversation until the user explicitly approves the exact text.",
      ),
  );
  server.registerPrompt(
    "campaign_preflight",
    { description: "Review a campaign before publication." },
    () =>
      prompt(
        "Call prepare_campaign. Verify the approved template, published Atendimento routine, coverage, audience, variables and schedule. Present the final payload and risks. Do not call publish_campaign without explicit confirmation.",
      ),
  );
  server.registerPrompt(
    "close_case_review",
    { description: "Check whether a conversation is ready to close." },
    () =>
      prompt(
        "Load the conversation timeline and its metadata. Confirm owner, outcome, next step and any promised follow-up. Recommend closure only when no unresolved obligation remains. Do not call close_conversation without explicit confirmation.",
      ),
  );
};
