import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, extractError } from "../lib/api.js";
import { isRemoteTransport } from "../lib/constants.js";
import { dropToken, getAraraToken } from "../lib/auth.js";
import { requestDeviceCode, pollForToken, openBrowser } from "../lib/deviceFlow.js";
import { errorResponse, successResponse } from "../lib/types.js";

export const registerAuthTools = (server: McpServer) => {
  server.tool(
    "login",
    "Authenticate the MCP with your Arara account via OAuth device flow. Opens the user's browser on a one-time approval page and waits for them to approve. Stores the token securely in the system keychain. Call this first when no token is configured. After success, every other tool works without needing an API key.",
    {},
    async () => {
      try {
        const code = await requestDeviceCode();
        const openedBrowser = !isRemoteTransport() && openBrowser(code.verifyUrl);
        const result = await pollForToken(code);
        if (!result.ok) {
          return errorResponse(
            `${result.message}\nApproval URL (code ${code.userCode}): ${code.verifyUrl}`,
          );
        }
        return successResponse([
          openedBrowser
            ? `Approved in the browser (${code.verifyUrl}).`
            : `Approved at ${code.verifyUrl} (code ${code.userCode}).`,
          `Login complete. Token saved to system keychain.`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`Login failed: ${extractError(error)}`);
      }
    },
  );

  server.tool(
    "logout",
    "Clear the OAuth token from the system keychain. After logout, tools fall back to ARARA_API_KEY env var or fail with MissingAuth.",
    {},
    async () => {
      await dropToken();
      return successResponse("Logged out. OAuth token cleared from keychain.");
    },
  );

  server.tool(
    "whoami",
    "Show the currently authenticated user, their role, and the active organization.",
    {},
    async () => {
      try {
        const token = await getAraraToken();
        if (!token) return errorResponse("Not authenticated. Call `login` or set ARARA_API_KEY.");
        const response = await apiGet("/auth/me", { toolName: "whoami" });
        const me = response.data ?? {};
        return successResponse([
          `${me.name ?? me.email ?? "Unknown"}`,
          `  Email:        ${me.email ?? "N/A"}`,
          `  Role:         ${me.role ?? "N/A"}`,
          `  Organization: ${me.organization?.name ?? me.organizationName ?? "N/A"}`,
          `  Plan:         ${me.plan ?? me.organization?.plan ?? "N/A"}`,
        ].join("\n"));
      } catch (error) {
        return errorResponse(`whoami failed: ${extractError(error)}`);
      }
    },
  );
};
