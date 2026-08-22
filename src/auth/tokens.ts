import axios from "axios";
import { getApiBaseUrl, API_TIMEOUT_MS, OAUTH_CLIENT_ID } from "../config.js";
import { getRequestAccessToken } from "./context.js";
import { loadToken, saveToken } from "./token-store.js";

type RefreshResponse = { accessToken: string; refreshToken?: string; expiresIn?: number };

const isRefreshResponse = (value: unknown): value is RefreshResponse => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === "string" &&
    (record.refreshToken === undefined || typeof record.refreshToken === "string") &&
    (record.expiresIn === undefined || typeof record.expiresIn === "number")
  );
};

export const getAccessToken = async (): Promise<string> => {
  const contextual = getRequestAccessToken();
  if (contextual) return contextual;

  const stored = await loadToken();
  if (!stored) throw new Error("OAuth login required. Run `ararahq-mcp login`.");
  if (stored.expiresAt === undefined || stored.expiresAt > Date.now() + 30_000)
    return stored.accessToken;
  if (!stored.refreshToken)
    throw new Error("OAuth session expired. Run `ararahq-mcp login` again.");

  const response = await axios.post<unknown>(
    `${getApiBaseUrl()}/oauth/token/refresh`,
    {
      clientId: OAUTH_CLIENT_ID,
      refreshToken: stored.refreshToken,
    },
    { timeout: API_TIMEOUT_MS },
  );
  if (!isRefreshResponse(response.data))
    throw new Error("OAuth server returned an invalid refresh response.");
  const refreshed = response.data;
  await saveToken({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? stored.refreshToken,
    ...(refreshed.expiresIn === undefined
      ? {}
      : { expiresAt: Date.now() + refreshed.expiresIn * 1_000 }),
  });
  return refreshed.accessToken;
};
