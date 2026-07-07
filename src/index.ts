#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import {
  sessionContext,
  sessionKeysArara,
  sessionGuardianRules,
  getAraraToken,
  dropToken,
} from "./lib/auth.js";
import { requestDeviceCode, pollForToken, openBrowser } from "./lib/deviceFlow.js";
import { SERVER_VERSION } from "./lib/constants.js";

const registerAll = (s: McpServer) => {
  registerAllTools(s);
  registerAllResources(s);
  registerAllPrompts(s);
};

const originalLog = console.log;
console.log = () => {};
dotenv.config();
console.log = originalLog;

const SERVER_NAME = "arara-revenue-os";

const getLandingPage = (activeSessions: number) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arara MCP v${SERVER_VERSION}</title>
  <style>
    :root { --primary: #FF6B00; --bg: #050505; --text: #FFFFFF; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 2rem 0; }
    .container { text-align: center; padding: 2.5rem; border-radius: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); max-width: 520px; width: 90%; }
    .logo { font-size: 2.5rem; font-weight: 900; letter-spacing: -2px; margin-bottom: 0.5rem; background: linear-gradient(135deg, #fff 0%, var(--primary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,255,128,0.1); color: #00FF80; padding: 8px 18px; border-radius: 99px; font-size: 0.85rem; font-weight: 700; margin-bottom: 1.5rem; border: 1px solid rgba(0,255,128,0.2); }
    .dot { width: 8px; height: 8px; background: #00FF80; border-radius: 50%; animation: pulse 1.5s infinite; }
    .groups { text-align: left; margin-bottom: 1.5rem; }
    .group { padding: 0.75rem; border-radius: 10px; background: rgba(255,255,255,0.04); margin-bottom: 0.5rem; font-size: 0.8rem; }
    .group-title { font-weight: 700; color: var(--primary); margin-bottom: 0.25rem; }
    .group-tools { opacity: 0.6; font-size: 0.75rem; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Arara MCP</div>
    <div class="status"><span class="dot"></span> v${SERVER_VERSION} — Online</div>
    <div class="groups">
      <div class="group"><div class="group-title">Send</div><div class="group-tools">send_whatsapp · send_template · broadcast · broadcast_ab · check_status</div></div>
      <div class="group"><div class="group-title">Inbox</div><div class="group-tools">read_conversation</div></div>
      <div class="group"><div class="group-title">Templates</div><div class="group-tools">create_template · get_template_status</div></div>
      <div class="group"><div class="group-title">Contacts</div><div class="group-tools">save_contacts · opt_out</div></div>
      <div class="group"><div class="group-title">Auth</div><div class="group-tools">login · logout · whoami</div></div>
      <div class="group"><div class="group-title">Resources</div><div class="group-tools">organization · wallet · templates · numbers · campaigns · recovery · contacts · conversations · opt-outs</div></div>
    </div>
    <p style="font-size:0.75rem; opacity:0.4;">Active sessions: ${activeSessions} · © 2026 AraraHQ</p>
  </div>
</body>
</html>`;

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

async function run() {
  const isSSE =
    process.env.MCP_TRANSPORT === "sse" ||
    (process.env.PORT !== undefined && !process.argv.includes("--stdio"));

  if (isSSE) {
    const app = express();

    app.use((req, _res, next) => {
      console.error(`[${req.method}] ${req.url}`);
      next();
    });
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const transports = new Map<string, SSEServerTransport>();

    const getDeterministicSessionId = (req: express.Request): string | null => {
      const token =
        (req.headers["x-arara-key"] as string) ||
        req.headers.authorization ||
        (req.query.Authorization as string);
      if (!token) return null;
      return "v-" + crypto
        .createHash("md5")
        .update(token.toString().replace(/^Bearer\s+/i, "").trim())
        .digest("hex")
        .substring(0, 12);
    };

    app.get("/", (_req, res) => res.send(getLandingPage(transports.size)));
    app.get("/debug", (req, res) => res.json({
      headers: req.headers,
      query: req.query,
      ip: req.ip,
      deterministicId: getDeterministicSessionId(req),
      activeSessions: Array.from(transports.keys()),
    }));

    app.get("/.well-known/mcp/server-card.json", (req, res) => {
      const host = req.get("host") ?? "mcp.ararahq.com";
      const protocol = (req.headers["x-forwarded-proto"] as string) ?? (req.secure ? "https" : "http");
      res.json({
        mcpServers: {
          ararahq: { name: "Arara MCP", version: SERVER_VERSION, url: `${protocol}://${host}/sse`, transport: "sse" },
        },
      });
    });

    const handleConnect = async (req: express.Request, res: express.Response) => {
      try {
        if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
          return res.send(getLandingPage(transports.size));
        }
        console.error(`[SSE] New connection from ${req.ip}`);
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Cache-Control", "no-cache, no-transform");

        const transport = new SSEServerTransport("/sse", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        const araraToken = (req.headers["x-arara-key"] as string) || req.headers.authorization || (req.query.Authorization as string);
        if (araraToken) sessionKeysArara.set(sessionId, araraToken.toString().replace(/^Bearer\s+/i, "").trim());

        const sessionServer = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
        registerAll(sessionServer);
        await sessionServer.connect(transport);

        res.write(":" + " ".repeat(128) + "\n\n");
        console.error(`[SSE] Session ready: ${sessionId}`);

        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(": keep-alive\n\n");
        }, 20000);

        res.on("close", () => {
          console.error(`[SSE] Closed: ${sessionId}`);
          clearInterval(heartbeat);
          transports.delete(sessionId);
          sessionKeysArara.delete(sessionId);
          sessionGuardianRules.delete(sessionId);
          sessionServer.close().catch(() => {});
        });
      } catch (error: any) {
        console.error(`[SSE FATAL] ${error.message}`);
        if (!res.headersSent) res.status(500).send(`Server Error: ${error.message}`);
      }
    };

    const handleMessage = async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = (req.query.sessionId as string) || getDeterministicSessionId(req);
        const transport = transports.get(sessionId ?? "");
        if (transport) {
          await sessionContext.run({ sessionId: sessionId! }, async () => {
            await transport.handlePostMessage(req, res, req.body);
          });
        } else {
          console.error(`[SSE] Session ${sessionId} not found. Active: [${Array.from(transports.keys()).join(",")}]`);
          res.status(400).send("Session not found. Connect via GET /sse first.");
        }
      } catch (error: any) {
        console.error(`[SSE FATAL] handleMessage: ${error.message}`);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
      }
    };

    app.all("/sse", (req, res) => {
      const isSSEInit = req.headers.accept?.includes("text/event-stream") || req.method === "GET";
      return isSSEInit ? handleConnect(req, res) : handleMessage(req, res);
    });
    app.all("/connect", (req, res) => handleConnect(req, res));
    app.all("/messages", (req, res) => handleMessage(req, res));

    const port = process.env.PORT ?? 3333;
    app.listen(port, () => {
      console.error(`Arara MCP v${SERVER_VERSION} on port ${port} (SSE)`);
    });
  } else {
    registerAll(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Arara MCP v${SERVER_VERSION} (stdio)`);
    const token = await getAraraToken();
    if (!token) {
      console.error(
        "No Arara auth configured. Run `npx -y ararahq-mcp login` in a terminal, " +
        "or ask your agent to call the `login` tool.",
      );
    }
  }
}

async function runLoginCli() {
  const code = await requestDeviceCode();
  console.log(`\nApprove the login in your browser:\n\n   ${code.verifyUrl}\n\nCode: ${code.userCode}`);
  if (openBrowser(code.verifyUrl)) console.log("Opening your browser...");
  console.log("Waiting for approval...");
  const result = await pollForToken(code);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log("Login complete. Token saved to the system keychain.");
  process.exit(0);
}

async function runLogoutCli() {
  await dropToken();
  console.log("Logged out. OAuth token cleared from the keychain.");
  process.exit(0);
}

export function createSandboxServer() { return server; }

const isScan =
  process.argv.includes("--scan") ||
  process.argv.some((arg) => arg.includes("smithery")) ||
  process.env.SMITHERY === "true";

const cliCommand = process.argv[2];

if (process.env.NODE_ENV !== "test" && !isScan) {
  const entry =
    cliCommand === "login" ? runLoginCli()
      : cliCommand === "logout" ? runLogoutCli()
        : run();
  entry.catch((error) => { console.error("Fatal:", error); process.exit(1); });
}
