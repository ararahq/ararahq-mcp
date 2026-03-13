#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";
import * as url from "node:url";
import crypto from "node:crypto";

// --- CONTEXT ---
const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();
const sessionKeysArara = new Map<string, string>();
const sessionKeysAbacate = new Map<string, string>();

dotenv.config();

/**
 * Arara Universal MCP Server
 * Transforming WhatsApp into a Revenue Operating System.
 */

const server = new McpServer({
  name: "arara-revenue-os",
  version: "1.1.1",
});

// --- CONSTANTS & STATE ---
const IS_SHARED_MODE = !(process.env.ARARA_API_KEY || process.env.ABACATE_API_KEY);

// --- HELPERS ---
const getSessionKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context ? sessionKeysArara.get(context.sessionId) : undefined;
  return apiKey || sessionKey || process.env.ARARA_API_KEY;
};

const getAbacateSessionKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const abacateKey = context ? (sessionKeysAbacate.get(context.sessionId) || sessionKeysArara.get(context.sessionId)) : undefined;
  return apiKey || abacateKey || process.env.ABACATE_API_KEY;
};

// --- GUARDIAN MODE ---
const guardianFilter = (text: string): { safe: boolean; reason?: string } => {
  const sensitivePatterns = [
    /password/i, /senha/i, /credit card/i, /cartão de crédito/i,
    /cpf/i, /cnpj/i, /cvv/i
  ];
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Sensitive data detected (Guardian Intercept: ${pattern})` };
    }
  }
  return { safe: true };
};

// --- TOOL REGISTRY ---
function registerTools(serverInstance: McpServer) {
  serverInstance.tool(
    "send_smart_message",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      to: z.string().describe("Recipient phone number"),
      text: z.string().describe("Message content"),
      skipGuardian: z.boolean().optional().default(false)
    },
    async ({ apiKey, to, text, skipGuardian }) => {
      const activeKey = getSessionKey(apiKey);
      if (!activeKey) return { content: [{ type: "text", text: "❌ Missing Arara API Key." }], isError: true };
      if (!skipGuardian) {
        const check = guardianFilter(text);
        if (!check.safe) return { content: [{ type: "text", text: `🚨 GUARDIAN: ${check.reason}` }], isError: true };
      }
      try {
        const response = await axios.post("https://api.ararahq.com/api/v1/messages", { receiver: to, body: text }, { headers: { Authorization: `Bearer ${activeKey}` } });
        return { content: [{ type: "text", text: `✅ Sent. ID: ${response.data.id}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ Error: ${error.response?.data?.message || error.message}` }], isError: true };
      }
    }
  );
}

// --- START SERVER ---
async function run() {
  const isSSE = process.env.MCP_TRANSPORT === "sse" || (process.env.PORT !== undefined && !process.argv.includes("--stdio"));

  if (isSSE) {
    const app = express();

    // RAW DEBUGGING - BEFORE EVERYTHING
    app.use((req, res, next) => {
      console.error(`[RAW] ${req.method} ${req.url} | Accept: ${req.headers.accept}`);
      next();
    });

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const transports = new Map<string, SSEServerTransport>();

    const getDeterministicSessionId = (req: express.Request): string | null => {
      const araraToken = (req.headers['x-arara-key'] as string) || req.headers.authorization || (req.query.Authorization as string);
      const abacateToken = (req.headers['x-abacate-key'] as string);
      let token = araraToken || abacateToken;
      if (!token) return null;
      token = token.toString().replace(/^Bearer\s+/i, '').trim();
      return "v-" + crypto.createHash('md5').update(token).digest('hex').substring(0, 12);
    };

    app.get("/", (req, res) => {
      res.json({ status: "alive", version: "1.1.1", active: transports.size });
    });

    app.get("/debug", (req, res) => {
      res.json({
        headers: req.headers,
        query: req.query,
        ip: req.ip,
        deterministicId: getDeterministicSessionId(req),
        activeSessions: Array.from(transports.keys())
      });
    });

    app.get("/.well-known/mcp/server-card.json", (req, res) => {
      console.error(`[CARD] Fetching server card from ${req.ip}`);
      const host = req.get('host') || "mcp.ararahq.com";
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      res.json({
        mcpServers: {
          ararahq: {
            name: "Arara Revenue OS",
            version: "1.1.1",
            url: `${protocol}://${host}/connect`,
            transport: "sse"
          }
        }
      });
    });

    const handleConnect = async (req: express.Request, res: express.Response) => {
      try {
        console.error(`[SSE DEBUG] Initializing session via ${req.method} from ${req.ip}`);

        // PROXY PREP: Disable buffering for Nginx/Cloudflare
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Cache-Control', 'no-cache, no-transform');

        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;

        transports.set(sessionId, transport);
        console.error(`[SSE Session] Established: ${sessionId}`);

        // Capture Tokens using this sessionId
        const araraToken = (req.headers['x-arara-key'] as string) || req.headers.authorization || (req.query.Authorization as string);
        const abacateToken = (req.headers['x-abacate-key'] as string);
        if (araraToken) sessionKeysArara.set(sessionId, araraToken.toString().replace(/^Bearer\s+/i, '').trim());
        if (abacateToken) sessionKeysAbacate.set(sessionId, abacateToken.toString().replace(/^Bearer\s+/i, '').trim());

        // Dedicated server for each session to allow concurrency in SDK v1.x
        const sessionServer = new McpServer({
          name: "arara-revenue-os",
          version: "1.1.1",
        });
        registerTools(sessionServer);

        console.error(`[SSE DEBUG] Connecting dedicated server to transport for ${sessionId}`);
        await sessionServer.connect(transport);
        
        // Final flush trigger / preamble
        res.write(":" + " ".repeat(1024) + "\n\n");
        console.error(`[SSE DEBUG] Session ready: ${sessionId}`);

        // Heartbeat every 10s
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keep-alive\n\n");
          }
        }, 10000);
        
        res.on("close", () => {
          console.error(`[SSE CLOSE] Session ${sessionId}`);
          clearInterval(heartbeat);
          transports.delete(sessionId);
          sessionKeysArara.delete(sessionId);
          sessionKeysAbacate.delete(sessionId);
          sessionServer.close().catch(() => {});
        });
      } catch (error: any) {
        console.error(`[SSE FATAL ERROR] in handleConnect: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).send(`Server Error: ${error.message}`);
        }
      }
    };

    const handleMessage = async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = (req.query.sessionId as string) || getDeterministicSessionId(req);
        console.error(`[SSE POST] Recv for ${sessionId}`);

        const transport = transports.get(sessionId || "");
        if (transport) {
          await sessionContext.run({ sessionId: sessionId! }, async () => {
            await transport.handlePostMessage(req, res, req.body);
          });
        } else {
          console.error(`[SSE POST ERROR] Session ${sessionId} not active. Active: [${Array.from(transports.keys()).join(",")}]`);
          // FALLBACK: If sessionId is a deterministic ID but map is keyed by SDK ID, this might fail.
          // But since the client gets the SD ID in the /messages?sessionId= URL, it should work.
          res.status(400).send("Session Missing. Open GET /connect first.");
        }
      } catch (error: any) {
        console.error(`[SSE FATAL ERROR] in handleMessage: ${error.message}`, error.stack);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
      }
    };

    // NEW PATH: /connect (Avoids WAF filters for /sse)
    app.all("/connect", (req, res) => { handleConnect(req, res); });

    // Redir legacy or handle POST init
    app.all("/sse", (req, res) => {
      const isSSEInit = req.headers.accept?.includes("text/event-stream");

      if (req.method === "GET") {
        return res.redirect(307, "/connect");
      }

      if (req.method === "POST" && isSSEInit) {
        console.error("[SSE REDIR] POST /sse with event-stream -> handleConnect");
        return handleConnect(req, res);
      }

      // Default: POST messages
      console.error("[SSE REDIR] POST /sse -> handleMessage");
      return handleMessage(req, res);
    });

    app.post("/messages", (req, res) => { handleMessage(req, res); });

    const port = process.env.PORT || 3333;
    app.listen(port, () => {
      console.error(`Arara v1.1.1 listening on port ${port} (SSE MODE)`);
    });
  } else {
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Arara v1.1.1 listening on stdio");
  }
}

export function createSandboxServer() { return server; }
const isScan = process.argv.includes("--scan") || process.argv.some(arg => arg.includes("smithery")) || process.env.SMITHERY === "true";
if (process.env.NODE_ENV !== "test" && !isScan) {
  run().catch(e => { console.error("Fatal:", e); process.exit(1); });
}
