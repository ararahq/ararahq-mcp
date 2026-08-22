import axios from "axios";
import { spawn } from "node:child_process";
import { z } from "zod";
import { API_TIMEOUT_MS, getApiBaseUrl, OAUTH_CLIENT_ID, OAUTH_SCOPE } from "../config.js";
import { saveToken } from "./token-store.js";

const deviceCodeSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url().optional(),
  expiresIn: z.number().positive(),
  interval: z.number().positive(),
});
const tokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().positive().optional(),
});
export type DeviceCode = z.infer<typeof deviceCodeSchema>;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const requestDeviceCode = async (): Promise<DeviceCode> => {
  const response = await axios.post<unknown>(
    `${getApiBaseUrl()}/oauth/device/code`,
    { clientId: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE },
    { timeout: API_TIMEOUT_MS },
  );
  return deviceCodeSchema.parse(response.data);
};

export const pollForToken = async (code: DeviceCode): Promise<void> => {
  const deadline = Date.now() + code.expiresIn * 1_000;
  let interval = Math.max(2_000, code.interval * 1_000);
  while (Date.now() < deadline) {
    await wait(interval);
    try {
      const response = await axios.post<unknown>(
        `${getApiBaseUrl()}/oauth/device/token`,
        { clientId: OAUTH_CLIENT_ID, deviceCode: code.deviceCode },
        { timeout: API_TIMEOUT_MS },
      );
      const token = tokenSchema.parse(response.data);
      await saveToken({
        accessToken: token.accessToken,
        ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
        ...(token.expiresIn === undefined
          ? {}
          : { expiresAt: Date.now() + token.expiresIn * 1_000 }),
      });
      return;
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;
      const payload: unknown = error.response?.data;
      const record =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const nested =
        typeof record.error === "object" && record.error !== null
          ? (record.error as Record<string, unknown>)
          : record;
      const codeValue =
        typeof nested.code === "string"
          ? nested.code
          : typeof record.error === "string"
            ? record.error
            : "";
      if (codeValue === "authorization_pending") continue;
      if (codeValue === "slow_down") {
        interval += 2_000;
        continue;
      }
      if (codeValue === "access_denied") throw new Error("OAuth login was denied.");
      if (codeValue === "expired_token") throw new Error("OAuth login expired. Run login again.");
      throw new Error("OAuth token polling failed.");
    }
  }
  throw new Error("OAuth login timed out. Run login again.");
};

export const openBrowser = (url: string): void => {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};
