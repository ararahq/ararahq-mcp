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
  version: "1.0.7",
});

// --- CONSTANTS & STATE ---
const IS_SHARED_MODE = !(process.env.ARARA_API_KEY || process.env.ABACATE_API_KEY);

// --- HELPERS ---
const getSessionKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context ? sessionKeysArara.get(context.sessionId) : undefined;
  
  // Priority: 1. Tool Param, 2. Session Header, 3. Env Var
  return apiKey || sessionKey || process.env.ARARA_API_KEY;
};

const getAbacateSessionKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  // Checks X-Abacate-Key first, then X-Arara-Key as fallback for Revenue OS keys
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

// --- TOOL: Smart Message Sending ---
server.tool(
  "send_smart_message",
  {
    apiKey: z.string().optional().describe("Arara API Key (optional if ARARA_API_KEY env is set)"),
    to: z.string().describe("Recipient phone number (E.164 format)"),
    text: z.string().describe("Message content"),
    skipGuardian: z.boolean().optional().default(false).describe("Explicitly skip safety filter (not recommended)")
  },
  async ({ apiKey, to, text, skipGuardian }) => {
    const activeKey = getSessionKey(apiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing Arara API Key. Provide it via tools or Header (Authorization: Bearer <TOKEN>)." }], 
        isError: true 
      };
    }

    if (!skipGuardian) {
      const check = guardianFilter(text);
      if (!check.safe) {
        return {
          content: [{ type: "text", text: `🚨 GUARDIAN MODE INTERCEPTED: ${check.reason}` }],
          isError: true
        };
      }
    }

    try {
      const response = await axios.post(
        "https://api.ararahq.com/api/v1/messages",
        { receiver: to, body: text },
        { headers: { Authorization: `Bearer ${activeKey}` } }
      );

      return {
        content: [{ type: "text", text: `✅ Message sent successfully. ID: ${response.data.id}` }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        content: [{ type: "text", text: `❌ Failure sending message: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// --- TOOL: Atomic Negotiation (Link Generation) ---
server.tool(
  "generate_negotiation_link",
  {
    abacateApiKey: z.string().optional().describe("AbacatePay API Key (optional if ABACATE_API_KEY env is set)"),
    amount: z.number().describe("Total amount in cents (R$ 10,00 = 1000)"),
    customerId: z.string().describe("Customer ID or Email"),
    reason: z.string().describe("Reason for this specific payment link")
  },
  async ({ abacateApiKey, amount, customerId, reason }) => {
    const activeKey = getAbacateSessionKey(abacateApiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing AbacatePay API Key. Provide it via tools or environment." }], 
        isError: true 
      };
    }
    try {
      const response = await axios.post(
        "https://api.abacatepay.com/v1/checkout",
        { amount, customerId, metadata: { reason } },
        { headers: { Authorization: `Bearer ${activeKey}` } }
      );

      return {
        content: [{ type: "text", text: `🔗 Negotiation link generated: ${response.data.url}\nContext: ${reason}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to generate link: ${error.message}` }],
        isError: true
      };
    }
  }
);

// --- TOOL: Business Memory Retrieval ---
server.tool(
  "get_customer_memory",
  {
    apiKey: z.string().optional().describe("Arara/Business Memory API Key (optional if ARARA_API_KEY env is set)"),
    customerId: z.string().describe("Phone or Internal ID")
  },
  async ({ apiKey, customerId }) => {
    const activeKey = getSessionKey(apiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing Arara API Key. Provide it via tools or Header." }], 
        isError: true 
      };
    }
    return {
      content: [{ 
        type: "text", 
        text: `🧠 MEMORY LAYER (MOCK): Customer ${customerId} has a VIP status. Last mood: HAPPY. History shows preference for morning contact.` 
      }]
    };
  }
);

// --- TOOL: List Arara Templates ---
server.tool(
  "list_templates",
  {
    apiKey: z.string().optional().describe("Arara API Key (optional if ARARA_API_KEY env is set)")
  },
  async ({ apiKey }) => {
    const activeKey = getSessionKey(apiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing Arara API Key." }], 
        isError: true 
      };
    }
    try {
      const response = await axios.get(
        "https://api.ararahq.com/api/v1/templates",
        { headers: { Authorization: `Bearer ${activeKey}` } }
      );

      const templates = response.data.map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        category: t.category,
        content: t.content
      }));

      return {
        content: [{ type: "text", text: `📋 Available Templates:\n${JSON.stringify(templates, null, 2)}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to list templates: ${error.message}` }],
        isError: true
      };
    }
  }
);

// --- TOOL: Send Template Message (Mass Orchestration Ready) ---
server.tool(
  "send_template_message",
  {
    apiKey: z.string().optional().describe("Arara API Key (optional if ARARA_API_KEY env is set)"),
    to: z.string().describe("Recipient phone number"),
    templateName: z.string().describe("Name of the Arara template"),
    variables: z.array(z.string()).optional().describe("Variables for the template")
  },
  async ({ apiKey, to, templateName, variables }) => {
    const activeKey = getSessionKey(apiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing Arara API Key. Provide it via tools or Header." }], 
        isError: true 
      };
    }
    try {
      const response = await axios.post(
        "https://api.ararahq.com/api/v1/messages",
        { 
          receiver: to, 
          templateName, 
          variables: variables || [] 
        },
        { headers: { Authorization: `Bearer ${activeKey}` } }
      );

      return {
        content: [{ type: "text", text: `🚀 Template message sent! ID: ${response.data.id}` }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        content: [{ type: "text", text: `❌ Template error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// --- TOOL: Create Arara Campaign (Mass Orchestration) ---
server.tool(
  "create_campaign",
  {
    apiKey: z.string().optional().describe("Arara API Key (optional if ARARA_API_KEY env is set)"),
    name: z.string().describe("Campaign name"),
    templateName: z.string().describe("Arara template to use"),
    idempotencyKey: z.string().describe("Unique key to prevent duplicate campaigns"),
    csvUrl: z.string().optional().describe("URL of the CSV with recipients and variables")
  },
  async ({ apiKey, name, templateName, idempotencyKey, csvUrl }) => {
    const activeKey = getSessionKey(apiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing Arara API Key. Provide it via tools or Header." }], 
        isError: true 
      };
    }
    try {
      const response = await axios.post(
        "https://api.ararahq.com/api/v1/campaigns",
        { name, templateName, csvUrl },
        { 
          headers: { 
            Authorization: `Bearer ${activeKey}`,
            "Idempotency-Key": idempotencyKey
          } 
        }
      );

      return {
        content: [{ type: "text", text: `📢 Campaign '${name}' created! ID: ${response.data.id}` }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        content: [{ type: "text", text: `❌ Campaign error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// --- TOOL: Monitor Revenue Leaks (Autonomous OS) ---
server.tool(
  "monitor_revenue_leaks",
  {
    abacateApiKey: z.string().optional().describe("AbacatePay API Key (optional if ABACATE_API_KEY env is set)"),
    thresholdDays: z.number().optional().default(1).describe("Days since payment expiration")
  },
  async ({ abacateApiKey, thresholdDays }) => {
    const activeKey = getAbacateSessionKey(abacateApiKey);

    if (!activeKey) {
      return { 
        content: [{ type: "text", text: "❌ Missing AbacatePay API Key. Provide it via tools or environment." }], 
        isError: true 
      };
    }
    return {
      content: [{ 
        type: "text", 
        text: `💸 LEAK DETECTION (MOCK): Found 3 expired Pix payments from the last ${thresholdDays} day(s). Total: R$ 450,00. Ready for recovery.` 
      }]
    };
  }
);

// --- TOOL: Configure Credentials (Auto-Setup) ---
server.tool(
  "configure_credentials",
  {
    araraApiKey: z.string().optional().describe("Arara API Key"),
    abacateApiKey: z.string().optional().describe("AbacatePay API Key")
  },
  async ({ araraApiKey, abacateApiKey }) => {
    if (IS_SHARED_MODE) {
      return {
        content: [{ type: "text", text: "🚨 SECURITY: 'configure_credentials' is disabled in Shared Mode. Please use Environment Variables or Header Parameters." }],
        isError: true
      };
    }

    try {
      const envPath = path.join(process.cwd(), ".env");
      let envContent = "";

      if (await fs.pathExists(envPath)) {
        envContent = await fs.readFile(envPath, "utf-8");
      }

      const updates: Record<string, string | undefined> = {
        ARARA_API_KEY: araraApiKey,
        ABACATE_API_KEY: abacateApiKey
      };

      let lines = envContent.split("\n");
      for (const [key, value] of Object.entries(updates)) {
        if (!value) continue;
        const lineIndex = lines.findIndex(line => line.startsWith(`${key}=`));
        if (lineIndex !== -1) {
          lines[lineIndex] = `${key}=${value}`;
        } else {
          lines.push(`${key}=${value}`);
        }
      }

      await fs.writeFile(envPath, lines.join("\n").trim() + "\n");
      
      if (araraApiKey) process.env.ARARA_API_KEY = araraApiKey;
      if (abacateApiKey) process.env.ABACATE_API_KEY = abacateApiKey;

      return {
        content: [{ type: "text", text: "✅ Credentials configured successfully and saved to .env file." }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to save credentials: ${error.message}` }],
        isError: true
      };
    }
  }
);

// --- START SERVER ---
async function run() {
  const transportFlag = process.argv.includes("--transport") ? process.argv[process.argv.indexOf("--transport") + 1] : null;
  const transportEnv = process.env.MCP_TRANSPORT;
  const isSSE = transportFlag === "sse" || transportEnv === "sse" || (process.env.PORT !== undefined && transportFlag !== "stdio");

  if (isSSE) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use((req, res, next) => {
      console.error(`[HTTP] ${req.method} ${req.url} (IP: ${req.ip})`);
      next();
    });

    const transports = new Map<string, SSEServerTransport>();

    const getDeterministicSessionId = (req: express.Request): string | null => {
      const araraToken = (req.headers['x-arara-key'] as string) || req.headers.authorization || (req.query.Authorization as string);
      const abacateToken = (req.headers['x-abacate-key'] as string);
      const token = araraToken || abacateToken;
      if (!token) return null;
      const seed = token.startsWith("Bearer ") ? token.split(" ")[1] : token;
      return "v-" + crypto.createHash('md5').update(seed).digest('hex').substring(0, 12);
    };

    app.get("/", (req, res) => {
      res.json({ status: "alive", mode: "SHARED", version: "1.0.7", active: transports.size });
    });

    app.get("/.well-known/mcp/server-card.json", (req, res) => {
      res.json({
        mcpServers: {
          ararahq: {
            name: "Arara Revenue OS",
            version: "1.0.7",
            url: "https://mcp.ararahq.com/sse",
            transport: "sse"
          }
        }
      });
    });

    app.get("/sse", async (req, res) => {
      console.error(`[SSE GET] Handshake: ${req.url}`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      const transport = new SSEServerTransport("/sse", res);
      const sessionId = getDeterministicSessionId(req) || transport.sessionId;
      
      if (!sessionId) {
        console.error("[SSE ERROR] No token for session");
        return res.status(401).send("Authentication required");
      }

      transports.set(sessionId, transport);
      console.error(`[SSE Session] Established: ${sessionId}`);

      const araraToken = (req.headers['x-arara-key'] as string) || req.headers.authorization || (req.query.Authorization as string);
      const abacateToken = (req.headers['x-abacate-key'] as string);
      
      if (araraToken) {
        const token = araraToken.startsWith("Bearer ") ? araraToken.split(" ")[1] : araraToken;
        sessionKeysArara.set(sessionId, token);
      }
      if (abacateToken) {
        const token = abacateToken.startsWith("Bearer ") ? abacateToken.split(" ")[1] : abacateToken;
        sessionKeysAbacate.set(sessionId, token);
      }

      await server.connect(transport);
      
      res.on("close", () => {
        console.error(`[SSE CLOSE] Cleanup: ${sessionId}`);
        transports.delete(sessionId);
        sessionKeysArara.delete(sessionId);
        sessionKeysAbacate.delete(sessionId);
      });
    });

    app.post("/sse", async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const sessionId = (req.query.sessionId as string) || (parsedUrl.query.sessionId as string) || getDeterministicSessionId(req);
      
      if (!sessionId) {
        console.error(`[SSE POST ERROR] No sessionId found.`);
        return res.status(400).send("Session ID required");
      }

      const transport = transports.get(sessionId);
      if (transport) {
        await sessionContext.run({ sessionId }, async () => {
          await transport.handlePostMessage(req, res, req.body);
        });
      } else {
        console.error(`[SSE POST ERROR] Session ${sessionId} not active. Active: [${Array.from(transports.keys()).join(",")}]`);
        res.status(400).send("Session not established. Ensure GET /sse is open.");
      }
    });

    // Compatibility path
    app.post("/messages", (req, res) => {
      req.url = "/sse";
      (app as any).handle(req, res);
    });

    const port = process.env.PORT || 3333;
    app.listen(port, () => {
      const mode = !IS_SHARED_MODE ? "DEDICATED" : "SHARED/MULTI-TENANT";
      console.error(`Arara Revenue OS MCP Server running on SSE at http://localhost:${port} [Mode: ${mode}]`);
    });
  } else {
    const transport = new StdioServerTransport();
    try {
      await server.connect(transport);
      console.error("Arara Revenue OS MCP Server running on stdio");
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("Already connected"))) {
        throw error;
      }
    }
  }
}

export function createSandboxServer() {
  return server;
}

const isScan = 
  process.argv.includes("--scan") || 
  process.argv.some(arg => arg.includes("smithery")) ||
  process.env.SMITHERY === "true";

if (process.env.NODE_ENV !== "test" && !isScan) {
  run().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
  });
}
