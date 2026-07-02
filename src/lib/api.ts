import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { sendTelemetry } from "./telemetry.js";
import { getAraraToken, forceRefreshToken } from "./auth.js";
import { ARARA_BASE, SERVER_VERSION } from "./constants.js";

export { ARARA_BASE, SERVER_VERSION };

const DEFAULT_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

export type RequestOpts = {
  tokenOverride?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  timeoutMs?: number;
  toolName?: string;
};

export class MissingAuthError extends Error {
  constructor() {
    super(
      "Not authenticated. Run the `login` tool to authenticate via browser " +
      "(opens an Arara approval page, no key to copy). Alternative: set " +
      "ARARA_API_KEY env var with a key from https://new.ararahq.com/dashboard/apikeys " +
      "(use for CI/headless only — OAuth is recommended for interactive use).",
    );
    this.name = "MissingAuthError";
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error: AxiosError): boolean => {
  if (!error.response) return true;
  const status = error.response.status;
  return status === 429 || status >= 500;
};

const retryDelayMs = (attempt: number, error: AxiosError): number => {
  const retryAfter = error.response?.headers?.["retry-after"];
  if (retryAfter) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed)) return parsed * 1_000;
  }
  return BASE_BACKOFF_MS * 2 ** attempt;
};

const buildHeaders = (
  token: string,
  opts: RequestOpts,
): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(opts.headers ?? {}),
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  return headers;
};

const execute = async <T>(
  method: "get" | "post" | "put" | "patch" | "delete",
  url: string,
  opts: RequestOpts,
  data?: unknown,
): Promise<AxiosResponse<T>> => {
  const startTime = Date.now();

  const initialToken = await getAraraToken(opts.tokenOverride);
  if (!initialToken) throw new MissingAuthError();

  let currentToken = initialToken;
  let lastError: AxiosError | undefined;
  let didRefresh = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const config: AxiosRequestConfig = {
      method,
      url,
      headers: buildHeaders(currentToken, opts),
      params: opts.params,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      data,
    };

    try {
      const response = await axios.request<T>(config);
      void sendTelemetry(ARARA_BASE, SERVER_VERSION, {
        tool: opts.toolName ?? "unknown",
        success: true,
        durationMs: Date.now() - startTime,
      });
      return response;
    } catch (error) {
      const axiosErr = error as AxiosError;
      lastError = axiosErr;
      const status = axiosErr.response?.status;

      if (status === 401 && !didRefresh && !opts.tokenOverride) {
        const refreshed = await forceRefreshToken();
        didRefresh = true;
        if (refreshed) {
          currentToken = refreshed;
          continue;
        }
      }

      if (attempt < MAX_RETRIES && isTransient(axiosErr)) {
        await wait(retryDelayMs(attempt, axiosErr));
        continue;
      }
      void sendTelemetry(ARARA_BASE, SERVER_VERSION, {
        tool: opts.toolName ?? "unknown",
        success: false,
        durationMs: Date.now() - startTime,
        errorCode: status?.toString() ?? axiosErr.code,
      });
      throw error;
    }
  }
  throw lastError;
};

export const apiGet = <T = any>(path: string, opts: RequestOpts = {}) =>
  execute<T>("get", `${ARARA_BASE}${path}`, opts);

export const apiPost = <T = any>(path: string, body: unknown, opts: RequestOpts = {}) =>
  execute<T>("post", `${ARARA_BASE}${path}`, opts, body);

export const apiPut = <T = any>(path: string, body: unknown, opts: RequestOpts = {}) =>
  execute<T>("put", `${ARARA_BASE}${path}`, opts, body);

export const apiPatch = <T = any>(path: string, body: unknown, opts: RequestOpts = {}) =>
  execute<T>("patch", `${ARARA_BASE}${path}`, opts, body);

export const apiDelete = <T = any>(path: string, opts: RequestOpts = {}) =>
  execute<T>("delete", `${ARARA_BASE}${path}`, opts);

export const apiPostMultipart = async <T = any>(
  path: string,
  formData: FormData,
  opts: RequestOpts = {},
): Promise<AxiosResponse<T>> => {
  const startTime = Date.now();
  const token = await getAraraToken(opts.tokenOverride);
  if (!token) throw new MissingAuthError();
  try {
    const response = await axios.post<T>(`${ARARA_BASE}${path}`, formData, {
      headers: buildHeaders(token, opts),
      timeout: opts.timeoutMs ?? UPLOAD_TIMEOUT_MS,
    });
    void sendTelemetry(ARARA_BASE, SERVER_VERSION, {
      tool: opts.toolName ?? "unknown",
      success: true,
      durationMs: Date.now() - startTime,
    });
    return response;
  } catch (error) {
    const axiosErr = error as AxiosError;
    void sendTelemetry(ARARA_BASE, SERVER_VERSION, {
      tool: opts.toolName ?? "unknown",
      success: false,
      durationMs: Date.now() - startTime,
      errorCode: axiosErr.response?.status?.toString() ?? axiosErr.code,
    });
    throw error;
  }
};

export const extractError = (error: unknown): string => {
  if (error instanceof MissingAuthError) return error.message;
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;
    return data?.error?.message || data?.error || data?.message || error.message;
  }
  return String(error);
};
