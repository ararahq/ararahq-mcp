import axios from "axios";
import { spawn } from "node:child_process";
import { extractError } from "./api.js";
import { ARARA_BASE, OAUTH_CLIENT_ID, OAUTH_SCOPE } from "./constants.js";
import { persistToken } from "./auth.js";

const MIN_POLL_INTERVAL_MS = 2_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  expiresIn: number;
  interval: number;
};

export type DeviceFlowResult = { ok: true } | { ok: false; message: string };

export const requestDeviceCode = async (): Promise<DeviceCode> => {
  const { data } = await axios.post(`${ARARA_BASE}/oauth/device/code`, {
    clientId: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
  });
  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verifyUrl: data.verificationUriComplete || `${data.verificationUri}?code=${data.userCode}`,
    expiresIn: data.expiresIn,
    interval: data.interval,
  };
};

export const pollForToken = async (code: DeviceCode): Promise<DeviceFlowResult> => {
  const deadline = Date.now() + code.expiresIn * 1_000;
  let currentInterval = Math.max(code.interval * 1_000, MIN_POLL_INTERVAL_MS);

  while (true) {
    if (Date.now() > deadline) {
      return { ok: false, message: "Login timed out before approval. Run login again." };
    }
    await wait(currentInterval);
    try {
      const { data } = await axios.post(`${ARARA_BASE}/oauth/device/token`, {
        clientId: OAUTH_CLIENT_ID,
        deviceCode: code.deviceCode,
      });
      await persistToken({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresIn ? Date.now() + data.expiresIn * 1_000 : undefined,
      });
      return { ok: true };
    } catch (pollError) {
      const errorCode = (pollError as any)?.response?.data?.error?.code
        ?? (pollError as any)?.response?.data?.code
        ?? "";
      if (errorCode === "authorization_pending") continue;
      if (errorCode === "slow_down") {
        currentInterval += MIN_POLL_INTERVAL_MS;
        continue;
      }
      if (errorCode === "access_denied") {
        return { ok: false, message: "User denied the login request." };
      }
      if (errorCode === "expired_token") {
        return { ok: false, message: "Login link expired before approval. Run login again." };
      }
      return { ok: false, message: `Login polling failed: ${extractError(pollError)}` };
    }
  }
};

export const openBrowser = (url: string): boolean => {
  const [command, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [url]]
      : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
};
