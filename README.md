# Arara MCP

[![npm](https://img.shields.io/npm/v/ararahq-mcp)](https://www.npmjs.com/package/ararahq-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-ararahq.com-orange)](https://docs.ararahq.com/mcp-server)

Turn Claude Code, Claude Desktop, Cursor, Windsurf or ChatGPT into a WhatsApp operator that knows your customers, your templates, your wallet, and your funnel. Built by [AraraHQ](https://ararahq.com) — Brazilian CPaaS for WhatsApp, homologated by Meta.

**Burro-first: say who and what, send_whatsapp does the rest · OAuth login · stdio + SSE**

---

## Install in 30 seconds

### Claude Code

```sh
claude mcp add arara --scope user -- npx -y ararahq-mcp
```

Restart Claude Code. In any conversation:

```
log into arara
```

Browser opens, you approve, the token lands in your OS keychain. Done.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "arara": {
      "command": "npx",
      "args": ["-y", "ararahq-mcp"]
    }
  }
}
```

Restart Claude Desktop. Type **"log into arara"** in any chat — browser opens, you approve, you're in.

### Cursor

Settings → MCP → Add server:

```json
{
  "arara": {
    "command": "npx",
    "args": ["-y", "ararahq-mcp"]
  }
}
```

### Windsurf

`.windsurf/mcp.json` at project root:

```json
{
  "servers": {
    "arara": {
      "command": "npx",
      "args": ["-y", "ararahq-mcp"]
    }
  }
}
```

### Hosted SSE — no local install

For ChatGPT (Custom GPT), n8n, or any client that speaks SSE:

```
URL:    https://mcp.ararahq.com/sse
Header: X-Arara-Key: ara_live_xxx
```

Generate the key at [Dashboard → API Keys](https://ararahq.com/dashboard/apikeys).

### Headless (CI / n8n self-hosted / server)

Skip OAuth — set the env var and run:

```sh
ARARA_API_KEY=ara_live_xxx npx ararahq-mcp --stdio
```

---

## 4 things you can do right now

**1. Ask the LLM:** *"Manda 'oi, tudo bem?' pro +5511999998888."*
→ Calls `send_whatsapp`. It fixes the number format, sends free text if the 24h window is open, and if it's closed it offers your approved templates instead of failing.

**2. Ask:** *"Dispara o template black_friday pros meus 200 leads."*
→ Calls `broadcast` with the approved template. Resolves names/numbers and batches the send.

**3. Ask:** *"O João já pode receber mensagem agora?"*
→ Calls `check_status`. Tells you if the 24h window is open and how long is left.

**4. Ask:** *"O +5511999998888 pediu pra sair da lista."*
→ Calls `opt_out`. LGPD-safe, idempotent.

---

## Why an MCP, not a raw API client?

A raw API client makes you remember endpoints, payload shapes, the E.164 format, the 24h window, template approval state. The MCP collapses that into a burro-first surface: you say **who** and **what**, and `send_whatsapp` figures out the rest. You speak Portuguese. The LLM does the rest.

---

## Tool index

Burro-first: a small set of intent tools do the work, and read-only data lives in resources (your client loads them automatically, no tool call needed). You say **who** and **what** — the tools handle number format, the 24h window, and template state.

<details>
<summary><b>Send</b> — 3 tools <i>(the spine)</i></summary>

`send_whatsapp` · `broadcast` · `check_status`

`send_whatsapp(to, message)` — `to` is a number in any format OR a saved contact name. Fixes E.164 + the Brazilian 9th digit, sends free text when the 24h window is open, and when it's closed it lists your approved templates or helps you approve a new one — it never invents a template. `broadcast(templateName, to[])` sends an approved template to many. `check_status` answers "delivered? replied? can I message now?".

</details>

<details>
<summary><b>Contacts</b> — 1 tool</summary>

`save_contacts`

Create/update up to 1000 contacts so you can message by name. Listing/reading contacts is the `arara://contacts/recent` resource.

</details>

<details>
<summary><b>Templates</b> — 2 tools</summary>

`create_template` · `get_template_status`

Submit a real, fixed-copy template for Meta approval (used when the 24h window is closed) and poll its approval. Your approved templates are the `arara://templates/approved` resource.

</details>

<details>
<summary><b>Compliance</b> — 1 tool</summary>

`opt_out`

Record that a contact unsubscribed (LGPD-safe, idempotent). The current opt-out list is the `arara://opt-outs` resource.

</details>

<details>
<summary><b>Auth</b> — 3 tools</summary>

`login` · `logout` · `whoami`

OAuth device flow: opens browser, polls until approved, stores token in OS keychain. Never on disk.

</details>

<details>
<summary><b>Resources</b> — read-only context</summary>

`arara://organization/me` · `arara://wallet/balance` · `arara://templates/approved` · `arara://numbers` · `arara://numbers/health` · `arara://campaigns/recent` · `arara://recovery/funnel` · `arara://contacts/recent` · `arara://conversations/recent` · `arara://opt-outs`

Numbers, wallet, templates, contacts, conversations, opt-outs and health snapshots. The LLM reads these passively to back decisions — they don't clutter tool choice.

</details>

> Account config that isn't day-to-day operator work — API keys, business profile, number provisioning, A/B tests, Brain knowledge base, recovery setup, Guardian policy — lives in the [dashboard](https://new.ararahq.com/dashboard), not the agent surface.

---

## Authentication

Two modes, picked automatically in this order:

| Mode | When | How |
|---|---|---|
| **OAuth (device flow)** | Default for Claude Code, Desktop, Cursor, Windsurf | Run `login`, approve in browser. Token saved to OS keychain. Auto-refresh. |
| **API key via env** | CI, server, n8n, ChatGPT (SSE), headless | `ARARA_API_KEY=ara_live_xxx` (stdio) or `X-Arara-Key` header (SSE) |

Internal precedence: explicit `apiKey` arg → SSE session key → OAuth keychain → `ARARA_API_KEY` env. If none exist, tools fail with `MissingAuth` and tell you to run `login`.

---

## Configuration

```sh
# OAuth is the default. These are all optional overrides.
ARARA_API_KEY=ara_live_xxx          # Fallback / headless mode
ARARA_BASE_URL=https://...          # Override endpoint (default: https://api.ararahq.com/api)
ARARA_MCP_TELEMETRY=off             # Disable usage telemetry
PORT=3333                           # SSE mode port (default 3333)
MCP_TRANSPORT=sse                   # Force SSE instead of stdio
```

Tokens stored via [keytar](https://github.com/atom/node-keytar) — macOS Keychain, Linux Secret Service, Windows Credential Manager. Never on disk in plaintext.

---

## Local dev

```sh
git clone https://github.com/ararahq/ararahq-mcp.git
cd ararahq-mcp
npm install
npm run build
node build/index.js --stdio          # for Claude Desktop / Code testing
PORT=3333 node build/index.js        # for SSE testing on localhost
```

To wire your local build into Claude Code:

```sh
claude mcp add arara --scope user -- node /absolute/path/to/build/index.js --stdio
```

---

## Get help

- Docs: [docs.ararahq.com/mcp-server](https://docs.ararahq.com/mcp-server)
- Issues: [github.com/ararahq/ararahq-mcp/issues](https://github.com/ararahq/ararahq-mcp/issues)
- WhatsApp: message any Arara number — yes, we use our own product

---

Built in São Paulo · MIT license · © AraraHQ
