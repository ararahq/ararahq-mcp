import axios from "axios";
import { API_TIMEOUT_MS, getApiBaseUrl, SERVER_VERSION } from "./config.js";
import { requestDeviceCode, pollForToken, openBrowser } from "./auth/device-flow.js";
import { clearToken, loadToken } from "./auth/token-store.js";
import { identitySchema } from "./lib/schemas.js";
import { TOOL_NAMES } from "./tools/index.js";

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const login = async (): Promise<void> => {
  const code = await requestDeviceCode();
  const url =
    code.verificationUriComplete ??
    `${code.verificationUri}?code=${encodeURIComponent(code.userCode)}`;
  log(`Authorize AraraHQ MCP at:\n${url}\nCode: ${code.userCode}`);
  openBrowser(url);
  await pollForToken(code);
  log("OAuth login complete. Tokens are stored in the operating-system keychain.");
};

const status = async (): Promise<void> => {
  const token = await loadToken();
  if (!token) {
    log("Not authenticated. Run `ararahq-mcp login`.");
    return;
  }
  try {
    const response = await axios.get<unknown>(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      timeout: API_TIMEOUT_MS,
    });
    const identity = identitySchema.parse(response.data);
    log(`Authenticated as ${identity.name} (${identity.email}).`);
  } catch {
    log(
      "A token exists, but the OAuth session could not be validated. Run `ararahq-mcp login` again.",
    );
    process.exitCode = 1;
  }
};

const doctor = async (): Promise<void> => {
  log(`AraraHQ MCP ${SERVER_VERSION}`);
  log(
    `Node ${process.versions.node}: ${Number(process.versions.node.split(".")[0]) >= 20 ? "ok" : "requires >=20"}`,
  );
  log(`API: ${getApiBaseUrl()}`);
  await status();
};

export const runCli = async (command: string): Promise<boolean> => {
  if (command === "login") {
    await login();
    return true;
  }
  if (command === "logout") {
    await clearToken();
    log("OAuth tokens removed from the system keychain.");
    return true;
  }
  if (command === "status") {
    await status();
    return true;
  }
  if (command === "doctor") {
    await doctor();
    return true;
  }
  if (command === "tools") {
    TOOL_NAMES.forEach(log);
    return true;
  }
  if (command === "--version" || command === "-v") {
    log(SERVER_VERSION);
    return true;
  }
  return false;
};
