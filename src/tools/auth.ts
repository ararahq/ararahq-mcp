import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import { z } from "zod";
import { apiGet, extractError } from "../lib/api.js";
import { ARARA_BASE, OAUTH_CLIENT_ID, OAUTH_SCOPE } from "../lib/constants.js";
import { persistToken, dropToken, getAraraToken } from "../lib/auth.js";
import { errorResponse, successResponse } from "../lib/types.js";

const MIN_POLL_INTERVAL_MS = 2_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
};

type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
};

export const registerAuthTools = (server: McpServer) => {
  server.tool(
    "login",
    "Authenticate the MCP with your Arara account via OAuth device flow. Opens a one-time URL the user clicks to approve. Stores the token securely in the system keychain. Call this first when no token is configured. After success, every other tool works without needing an API key.",
    {},
    async () => {
      try {
        const codeRequest = await axios.post<DeviceCodeResponse>(
          `${ARARA_BASE}/oauth/device/code`,
          { clientId: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE },
        );
        const { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval } =
          codeRequest.data;

        const verifyUrl = verificationUriComplete || `${verificationUri}?code=${userCode}`;
        const deadline = Date.now() + expiresIn * 1_000;
        let currentInterval = Math.max(interval * 1_000, MIN_POLL_INTERVAL_MS);

        while (true) {
          if (Date.now() > deadline) {
            return errorResponse("Login timed out before approval. Run login again.");
          }
          await wait(currentInterval);
          try {
            const tokenResponse = await axios.post<TokenResponse>(
              `${ARARA_BASE}/oauth/device/token`,
              { clientId: OAUTH_CLIENT_ID, deviceCode },
            );
            await persistToken({
              accessToken: tokenResponse.data.accessToken,
              refreshToken: tokenResponse.data.refreshToken,
              expiresAt: tokenResponse.data.expiresIn
                ? Date.now() + tokenResponse.data.expiresIn * 1_000
                : undefined,
            });
            break;
          } catch (pollError) {
            const code = (pollError as any)?.response?.data?.error?.code
              ?? (pollError as any)?.response?.data?.code
              ?? "";
            if (code === "authorization_pending") continue;
            if (code === "slow_down") {
              currentInterval += MIN_POLL_INTERVAL_MS;
              continue;
            }
            if (code === "access_denied") {
              return errorResponse("User denied the login request.");
            }
            if (code === "expired_token") {
              return errorResponse("Login link expired before approval. Run login again.");
            }
            return errorResponse(`Login polling failed: ${extractError(pollError)}`);
          }
        }

        return successResponse([
          `Open this URL to approve the login:`,
          ``,
          `   ${verifyUrl}`,
          ``,
          `Code: ${userCode}`,
          `Waiting for approval in your browser...`,
          ``,
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
