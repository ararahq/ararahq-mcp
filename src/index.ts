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

// --- CONTEXT ---
const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();
const sessionKeys = new Map<string, string>();
// Smithery scans are often done in environments where import.meta might not be available
// We remove the unused __filename/__dirname to prevent build errors.

dotenv.config();

/**
 * Arara Universal MCP Server
 * Transforming WhatsApp into a Revenue Operating System.
 */

const server = new McpServer({
  name: "arara-revenue-os",
  version: "1.0.0",
});

// --- CONSTANTS & STATE ---
const IS_SHARED_MODE = !(process.env.ARARA_API_KEY || process.env.ABACATE_API_KEY);

// --- HELPERS ---
const getSessionKey = (apiKey?: string): string | undefined => {
  const context = sessionContext.getStore();
  const sessionKey = context ? sessionKeys.get(context.sessionId) : undefined;
  
  // Priority: 1. Tool Param, 2. Session Header, 3. Env Var
  return apiKey || sessionKey || process.env.ARARA_API_KEY;
};

const getAbacateSessionKey = (apiKey?: string): string | undefined => {
  // Currently we use the same key for both or separate them if needed. 
  // For now, priority is Param > Env.
  return apiKey || process.env.ABACATE_API_KEY;
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
  
  // Custom tone/policy checks can be added here
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
      // PROD API URL: https://api.ararahq.com/api/v1/messages
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
      // Generic call to AbacatePay to create a checkout/payment link
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
    // This tool simulates fetching vectorized 'mood' and context history.
    // In a real implementation, this would query a Vector DB via Arara's backend.
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
    // This is a specialized tool for the 'Autonomous Revenue Recovery' vision.
    // It would normally query AbacatePay's billing history to find failed/expired payments.
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
      
      // Reload environment variables for the current session
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
  
  // Use SSE if explicitly requested OR if running in a cloud environment (PORT defined)
  const isSSE = transportFlag === "sse" || transportEnv === "sse" || (process.env.PORT !== undefined && transportFlag !== "stdio");

  if (isSSE) {
    const app = express();
    app.use(cors());

    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      // Priority: Header > Query Param
      const authHeader = req.headers.authorization || (req.query.Authorization as string);
      const transport = new SSEServerTransport("/messages", res);
      
      const sessionId = (transport as any).sessionId || Math.random().toString(36).substring(7);
      transports.set(sessionId, transport);

      if (authHeader) {
        // Handle both "Bearer <token>" and raw token from query
        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
        sessionKeys.set(sessionId, token);
        console.error(`[Session ${sessionId}] Authenticated with ${req.headers.authorization ? 'Header' : 'Query'} Token`);
      }

      await server.connect(transport);
      
      res.on("close", () => {
        transports.delete(sessionId);
        sessionKeys.delete(sessionId);
      });
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);

      if (transport) {
        // Wrap the message handling in the session context so tool handlers can access it
        await sessionContext.run({ sessionId }, async () => {
          await transport.handlePostMessage(req, res);
        });
      } else {
        res.status(400).send("No active SSE session for this ID");
      }
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

/**
 * createSandboxServer is used by Smithery to scan the server capabilities
 * without actually starting the stdio transport.
 */
export function createSandboxServer() {
  return server;
}

// Smithery specifically looks for createSandboxServer but also imports the file.
// We must avoid running connect() during a scan. 
// We check for several common scan indicators.
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
