import axios from "axios";
import { AsyncLocalStorage } from "async_hooks";
import { loadToken, saveToken, clearToken, StoredToken } from "./tokenStore.js";
import { ARARA_BASE, OAUTH_CLIENT_ID } from "./constants.js";

export const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();

export const sessionKeysArara = new Map<string, string>();
export const sessionKeysAbacate = new Map<string, string>();
export const sessionGuardianRules = new Map<string, string[]>();

let cachedToken: StoredToken | null | undefined = undefined;
let refreshPromise: Promise<StoredToken | null> | null = null;

const REFRESH_THRESHOLD_MS = 60_000;

const isExpired = (token: StoredToken): boolean => {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt - REFRESH_THRESHOLD_MS;
};

const refreshAccessToken = async (token: StoredToken): Promise<StoredToken | null> => {
  if (!token.refreshToken) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await axios.post(`${ARARA_BASE}/oauth/token/refresh`, {
        clientId: OAUTH_CLIENT_ID,
        refreshToken: token.refreshToken,
      });
      const next: StoredToken = {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken ?? token.refreshToken,
        expiresAt: response.data.expiresIn
          ? Date.now() + response.data.expiresIn * 1000
          : undefined,
      };
      await saveToken(next);
      cachedToken = next;
      return next;
    } catch (_) {
      cachedToken = null;
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};

export const getOAuthToken = async (): Promise<string | undefined> => {
  if (cachedToken === undefined) {
    cachedToken = await loadToken();
  }
  if (!cachedToken) return undefined;
  if (isExpired(cachedToken)) {
    const refreshed = await refreshAccessToken(cachedToken);
    if (!refreshed) return undefined;
    return refreshed.accessToken;
  }
  return cachedToken.accessToken;
};

export const forceRefreshToken = async (): Promise<string | undefined> => {
  if (cachedToken === undefined) cachedToken = await loadToken();
  if (!cachedToken) return undefined;
  const refreshed = await refreshAccessToken(cachedToken);
  return refreshed?.accessToken;
};

export const persistToken = async (token: StoredToken): Promise<void> => {
  cachedToken = token;
  await saveToken(token);
};

export const dropToken = async (): Promise<void> => {
  cachedToken = null;
  await clearToken();
};

export const getAraraToken = async (overrideToken?: string): Promise<string | undefined> => {
  if (overrideToken) return overrideToken;
  const context = sessionContext.getStore();
  const sessionToken = context ? sessionKeysArara.get(context.sessionId) : undefined;
  if (sessionToken) return sessionToken;
  const oauth = await getOAuthToken();
  if (oauth) return oauth;
  return process.env.ARARA_API_KEY;
};

export const getAbacateKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context
    ? sessionKeysAbacate.get(context.sessionId) || sessionKeysArara.get(context.sessionId)
    : undefined;
  return apiKey || sessionKey || process.env.ABACATE_API_KEY;
};
