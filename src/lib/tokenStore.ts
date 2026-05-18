import keytar from "keytar";

const SERVICE = "ararahq-mcp";
const KEY_ACCESS = "oauth-access-token";
const KEY_REFRESH = "oauth-refresh-token";
const KEY_EXPIRES = "oauth-expires-at";

export type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export const saveToken = async (token: StoredToken): Promise<void> => {
  await keytar.setPassword(SERVICE, KEY_ACCESS, token.accessToken);
  if (token.refreshToken) {
    await keytar.setPassword(SERVICE, KEY_REFRESH, token.refreshToken);
  }
  if (token.expiresAt) {
    await keytar.setPassword(SERVICE, KEY_EXPIRES, String(token.expiresAt));
  }
};

export const loadToken = async (): Promise<StoredToken | null> => {
  const accessToken = await keytar.getPassword(SERVICE, KEY_ACCESS);
  if (!accessToken) return null;
  const refreshToken = (await keytar.getPassword(SERVICE, KEY_REFRESH)) ?? undefined;
  const expiresAtRaw = await keytar.getPassword(SERVICE, KEY_EXPIRES);
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : undefined;
  return { accessToken, refreshToken, expiresAt };
};

export const clearToken = async (): Promise<void> => {
  await Promise.all([
    keytar.deletePassword(SERVICE, KEY_ACCESS).catch(() => false),
    keytar.deletePassword(SERVICE, KEY_REFRESH).catch(() => false),
    keytar.deletePassword(SERVICE, KEY_EXPIRES).catch(() => false),
  ]);
};
