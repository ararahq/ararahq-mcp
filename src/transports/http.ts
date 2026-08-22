import axios from "axios";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { runWithAccessToken } from "../auth/context.js";
import {
  API_TIMEOUT_MS,
  getApiBaseUrl,
  getHttpPort,
  SERVER_NAME,
  SERVER_VERSION,
} from "../config.js";
import { identitySchema } from "../lib/schemas.js";
import { createServer } from "../server/create.js";

const splitEnv = (name: string, fallback: string[]): string[] =>
  (process.env[name]?.split(",") ?? fallback)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const extractBearer = (request: Request): string | null => {
  const header = request.header("authorization");
  if (typeof header !== "string") return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
};

const validateRequestOrigin = (request: Request, response: Response): boolean => {
  const allowedHosts = splitEnv("MCP_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "mcp.ararahq.com"]);
  const hostname = request.hostname.toLowerCase();
  if (!allowedHosts.includes(hostname)) {
    response
      .status(403)
      .json({ error: { code: "HOST_NOT_ALLOWED", message: "Host is not allowed." } });
    return false;
  }
  const origin = request.header("origin");
  if (!origin) return true;
  const allowedOrigins = splitEnv("MCP_ALLOWED_ORIGINS", [
    "https://chatgpt.com",
    "https://claude.ai",
  ]);
  let normalized: string;
  try {
    normalized = new URL(origin).origin.toLowerCase();
  } catch {
    response
      .status(403)
      .json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
    return false;
  }
  if (!allowedOrigins.includes(normalized)) {
    response
      .status(403)
      .json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
    return false;
  }
  return true;
};

const validateToken = async (token: string): Promise<boolean> => {
  try {
    const response = await axios.get<unknown>(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: API_TIMEOUT_MS,
    });
    return identitySchema.safeParse(response.data).success;
  } catch {
    return false;
  }
};

export const runHttp = async (): Promise<void> => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use(
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }),
  );
  app.use((request, response, next) => {
    if (!validateRequestOrigin(request, response)) return;
    const origin = request.header("origin");
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, MCP-Protocol-Version",
      );
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_request, response) =>
    response.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION }),
  );
  const protectedResource = (request: Request, response: Response) => {
    const protocol = request.header("x-forwarded-proto") ?? request.protocol;
    const resource = process.env.MCP_PUBLIC_URL ?? `${protocol}://${request.get("host")}/mcp`;
    response.json({
      resource,
      authorization_servers: [process.env.ARARA_OAUTH_ISSUER ?? getApiBaseUrl()],
      bearer_methods_supported: ["header"],
      scopes_supported: process.env.ARARA_OAUTH_SCOPES?.split(" ") ?? [],
    });
  };
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  const handleMcp = async (request: Request, response: Response): Promise<void> => {
    const token = extractBearer(request);
    if (!token || !(await validateToken(token))) {
      const metadataUrl =
        process.env.MCP_RESOURCE_METADATA_URL ??
        "https://mcp.ararahq.com/.well-known/oauth-protected-resource/mcp";
      response.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`);
      response.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "A valid OAuth bearer token is required." },
      });
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport();
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as unknown as Transport);
    await runWithAccessToken(token, () => transport.handleRequest(request, response, request.body));
  };
  app.post("/mcp", (request, response) => {
    void handleMcp(request, response).catch(() => {
      if (!response.headersSent) {
        response
          .status(500)
          .json({ error: { code: "INTERNAL_ERROR", message: "Request failed." } });
      }
    });
  });
  app.get("/mcp", (_request, response) => response.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (_request, response) => response.status(405).set("Allow", "POST").end());

  app.use((_request, response) =>
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } }),
  );
  const port = getHttpPort();
  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(port, () => {
      process.stderr.write(`AraraHQ MCP ${SERVER_VERSION} listening on ${port}.\n`);
      resolve();
    });
    listener.on("error", reject);
  });
};
