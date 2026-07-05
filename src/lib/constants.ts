export const ARARA_BASE = process.env.ARARA_BASE_URL || "https://api.ararahq.com/api";
export const SERVER_VERSION = "4.2.0";
export const OAUTH_CLIENT_ID = "arara-mcp";
export const OAUTH_SCOPE = "messages templates campaigns contacts conversations recovery numbers organization wallet";

export const isRemoteTransport = (): boolean =>
  process.env.MCP_TRANSPORT === "sse" ||
  (process.env.PORT !== undefined && !process.argv.includes("--stdio"));
