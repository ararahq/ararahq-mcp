import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "./auth.js";
import { registerSendTool } from "./send.js";
import { registerTemplateTools } from "./templates.js";
import { registerContactTools } from "./contacts.js";
import { registerOptOutTools } from "./opt_outs.js";

export const registerAllTools = (server: McpServer): void => {
  registerAuthTools(server);
  registerSendTool(server);
  registerTemplateTools(server);
  registerContactTools(server);
  registerOptOutTools(server);
};
