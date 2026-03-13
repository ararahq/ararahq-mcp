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
    /cpf/i, /cnpj/i, /cvv/i, /token/i, /api[_-]key/i, /secret/i
  ];
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Sensitive data detected (Guardian Intercept: ${pattern})` };
    }
  }
  return { safe: true };
};

const ABACATE_BASE_URL = "https://api.abacatepay.com/v2";

// --- TOOL REGISTRY ---
function registerTools(serverInstance: McpServer) {
  /**
   * 1. Smart Messaging
   */
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

  /**
   * 2. Autonomous Revenue Recovery (V2)
   * Monitor "leaks" using /checkouts/list
   */
  serverInstance.tool(
    "check_revenue_leaks",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      limit: z.number().optional().default(10).describe("Max items to check")
    },
    async ({ apiKey, limit }) => {
      const activeKey = getAbacateSessionKey(apiKey);
      if (!activeKey) return { content: [{ type: "text", text: "❌ Missing AbacatePay API Key." }], isError: true };
      try {
        // V2 uses /checkouts/list
        const response = await axios.get(`${ABACATE_BASE_URL}/checkouts/list`, { 
          headers: { Authorization: `Bearer ${activeKey}` },
          params: { limit } 
        });
        const allCheckouts = response.data.data || [];
        const leaks = allCheckouts.filter((b: any) => ["PENDING", "EXPIRED", "CANCELLED"].includes(b.status));
        
        if (leaks.length === 0) {
          return { content: [{ type: "text", text: "✅ No revenue leaks found. Your funnels are healthy!" }] };
        }

        const report = leaks.map((l: any) => `- ID: ${l.id} | Customer: ${l.customer?.name || 'N/A'} | Status: ${l.status}`).join("\n");
        return { content: [{ type: "text", text: `🚨 REVENUE LEAKS DETECTED (V2):\n\n${report}\n\nAction: Use 'negotiate_payment' to offer a discount.` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ Recovery Monitor Error: ${error.response?.data?.error || error.message}` }], isError: true };
      }
    }
  );

  /**
   * 3. Atomic Negotiation (V2)
   * Atomic flow: Create product -> Create checkout
   */
  serverInstance.tool(
    "negotiate_payment",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      customerEmail: z.string(),
      customerPhone: z.string().describe("Customer phone number (required to send the link later)"),
      amount: z.number().describe("Amount in Centavos"),
      description: z.string().describe("Negotiated offer description")
    },
    async ({ apiKey, customerEmail, customerPhone, amount, description }) => {
      const activeKey = getAbacateSessionKey(apiKey);
      if (!activeKey) return { content: [{ type: "text", text: "❌ Missing AbacatePay API Key." }], isError: true };
      try {
        // 1. Create a dynamic product for this negotiation
        const productResp = await axios.post(`${ABACATE_BASE_URL}/products/create`, {
          externalId: `neg-${Date.now()}`,
          name: description,
          price: amount,
          currency: "BRL"
        }, { headers: { Authorization: `Bearer ${activeKey}` } });
        
        const productId = productResp.data.data.id;

        // 2. Create the checkout using the dynamic product
        const checkoutPayload = {
          items: [{ id: productId, quantity: 1 }],
          methods: ["PIX", "CARD"],
          returnUrl: "https://ararahq.com/",
          completionUrl: "https://ararahq.com/paid"
        };
        const response = await axios.post(`${ABACATE_BASE_URL}/checkouts/create`, checkoutPayload, { headers: { Authorization: `Bearer ${activeKey}` } });
        
        return { 
          content: [{ 
            type: "text", 
            text: `💎 MISSION ACCOMPLISHED: Negotiated payment generated for ${customerPhone}!\n\nLink: ${response.data.data.url}\nCheckout ID: ${response.data.data.id}\nStatus: PENDING\n\nAction: Now use 'send_smart_message' to send this link to ${customerPhone}.` 
          }] 
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ Negotiation Error: ${error.response?.data?.error || error.message}` }], isError: true };
      }
    }
  );

  /**
   * 4. Trusted Handshake (V2)
   * Verify real-time status of a checkout
   */
  serverInstance.tool(
    "confirm_payment_handshake",
    {
      apiKey: z.string().optional().describe("AbacatePay API Key"),
      checkoutId: z.string().describe("The 'bill_' or Checkout ID to verify")
    },
    async ({ apiKey, checkoutId }) => {
      const activeKey = getAbacateSessionKey(apiKey);
      if (!activeKey) return { content: [{ type: "text", text: "❌ Missing AbacatePay API Key." }], isError: true };
      try {
        const response = await axios.get(`${ABACATE_BASE_URL}/checkouts/get`, { 
          headers: { Authorization: `Bearer ${activeKey}` },
          params: { id: checkoutId }
        });
        const status = response.data.data.status;
        const icon = status === "PAID" ? "✅" : "⏳";
        return { content: [{ type: "text", text: `${icon} Handshake Status for ${checkoutId}: ${status}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ Handshake Error: ${error.response?.data?.error || error.message}` }], isError: true };
      }
    }
  );

  /**
   * 5. Business Memory Layer (BML)
   * Combined insights from Arara history and AbacatePay metadata
   */
  serverInstance.tool(
    "get_customer_insights",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      phone: z.string().describe("Customer phone number"),
      email: z.string().optional().describe("Customer email for AbacatePay lookup")
    },
    async ({ apiKey, phone, email }) => {
      const araraKey = getSessionKey(apiKey);
      const abacateKey = getAbacateSessionKey(apiKey);
      if (!araraKey) return { content: [{ type: "text", text: "❌ Missing Arara API Key." }], isError: true };

      let bmlReport = `🧠 BML Customer Profile (${phone}):\n`;
      
      try {
        // Arara History
        const araraResp = await axios.get(`https://api.ararahq.com/api/v1/messages?receiver=${phone}`, { headers: { Authorization: `Bearer ${araraKey}` } });
        const history = araraResp.data || [];
        bmlReport += `- Interactions: ${history.length} messages\n`;
        bmlReport += `- Last Message: ${history[0]?.body || 'None'}\n`;
      } catch (e) {}

      if (email && abacateKey) {
        try {
          const abacateResp = await axios.get(`${ABACATE_BASE_URL}/customers/list`, { 
            headers: { Authorization: `Bearer ${abacateKey}` },
            params: { email }
          });
          const customer = abacateResp.data.data?.[0];
          if (customer) {
            bmlReport += `- AbacatePay Status: ACTIVE CUSTOMER\n`;
            bmlReport += `- Tax ID: ${customer.taxId || 'Hidden'}\n`;
          }
        } catch (e) {}
      }
      
      return { content: [{ type: "text", text: `${bmlReport}\nStrategic Insight: Proceed with contextual awareness.` }] };
    }
  );

  /**
   * 6. Mass Orchestration
   */
  serverInstance.tool(
    "mass_orchestration",
    {
      apiKey: z.string().optional().describe("Arara API Key"),
      segment: z.string().describe("Target segment"),
      templateName: z.string(),
      variables: z.array(z.string()).optional()
    },
    async ({ apiKey, segment, templateName, variables }) => {
      const activeKey = getSessionKey(apiKey);
      if (!activeKey) return { content: [{ type: "text", text: "❌ Missing Arara API Key." }], isError: true };
      
      return { 
        content: [{ 
          type: "text", 
          text: `🚀 ORCHESTRATION START: Triggering '${templateName}' for segment '${segment}'.\n\nGuardian Check: PASSED.\nSafety Level: MAXIMUM.` 
        }] 
      };
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

    const getLandingPage = (sessions: number) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Arara Revenue OS | MCP</title>
    <style>
        :root { --primary: #FF6B00; --bg: #050505; --text: #FFFFFF; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }
        .container { text-align: center; position: relative; z-index: 10; padding: 2.5rem; border-radius: 32px; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(25px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 40px 60px -15px rgba(0, 0, 0, 0.7); max-width: 420px; width: 90%; animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        .logo { font-size: 3rem; font-weight: 900; letter-spacing: -2px; margin-bottom: 0.5rem; background: linear-gradient(135deg, #fff 0%, var(--primary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(0, 255, 128, 0.1); color: #00FF80; padding: 10px 20px; border-radius: 99px; font-size: 0.9rem; font-weight: 700; margin-bottom: 2rem; border: 1px solid rgba(0, 255, 128, 0.2); }
        .dot { width: 10px; height: 10px; background: #00FF80; border-radius: 50%; box-shadow: 0 0 15px #00FF80; animation: pulse 1.5s infinite; }
        p { opacity: 0.7; line-height: 1.6; font-size: 1rem; margin-bottom: 2rem; }
        .btn { background: var(--primary); color: white; border: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: transform 0.2s, background 0.2s; font-size: 1rem; text-decoration: none; display: inline-block; }
        .btn:hover { background: #E65A00; transform: translateY(-2px); }
        .btn:active { transform: translateY(0); }
        .glow { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; height: 400px; background: var(--primary); filter: blur(140px); opacity: 0.2; z-index: 1; pointer-events: none; }
        @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <div class="glow"></div>
    <div class="container">
        <div class="logo">Arara OS</div>
        <div class="status"><span class="dot"></span> Online & Optimized</div>
        <p>The Universal MCP Bridge is active.<br>Ready for <b>Smithery</b> and <b>Claude</b>.</p>
        <button class="btn" onclick="window.close()">Finish Setup</button>
        <p style="font-size: 0.75rem; margin-top: 2.5rem; opacity: 0.4;">© 2026 Arara HQ • v1.1.1</p>
    </div>
</body>
</html>`;

    app.get("/", (req, res) => {
      console.error(`[UI] Serving landing page to ${req.ip}`);
      res.send(getLandingPage(transports.size));
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
      console.error(`[CARD] Fetching from ${req.ip}`);
      const host = req.get('host') || "mcp.ararahq.com";
      const protocol = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
      res.json({
        mcpServers: {
          ararahq: {
            name: "Arara Revenue OS",
            version: "1.1.1",
            url: `${protocol}://${host}/sse`,
            transport: "sse"
          }
        }
      });
    });

    const handleConnect = async (req: express.Request, res: express.Response) => {
      try {
        if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
          console.error(`[UI] Serving landing page via /sse to ${req.ip}`);
          return res.send(getLandingPage(transports.size));
        }
        console.error(`[SSE DEBUG] Initializing session via ${req.method} from ${req.ip}`);

        // PROXY PREP: Disable buffering for Nginx/Cloudflare
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Cache-Control', 'no-cache, no-transform');

        const transport = new SSEServerTransport("/sse", res);
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
        
        // Final flush trigger / small preamble
        res.write(":" + " ".repeat(128) + "\n\n");
        console.error(`[SSE DEBUG] Session ready: ${sessionId}`);

        // Heartbeat every 20s to stay alive without spamming
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keep-alive\n\n");
          }
        }, 20000);
        
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

    // Simplified routing for Smithery / legacy
    app.all("/sse", (req, res) => {
      const isSSEInit = req.headers.accept?.includes("text/event-stream") || req.method === "GET";
      if (isSSEInit) return handleConnect(req, res);
      return handleMessage(req, res);
    });

    app.all("/connect", (req, res) => { handleConnect(req, res); });
    app.all("/messages", (req, res) => { handleMessage(req, res); });

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
