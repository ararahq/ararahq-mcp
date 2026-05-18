# Arara MCP

[![npm](https://img.shields.io/npm/v/ararahq-mcp)](https://www.npmjs.com/package/ararahq-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-ararahq.com-orange)](https://docs.ararahq.com)

Turn Claude / Cursor / ChatGPT into a WhatsApp operator that knows your customers, your templates, your wallet, and your funnel. Built by [AraraHQ](https://ararahq.com) — Brazilian CPaaS for WhatsApp, homologated by Meta.

**64 tools · 6 resources · 5 guided workflows · OAuth login**

---

## Install in 30 seconds

### Claude Desktop / Claude Code

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

Restart Claude. Type **"log into Arara"** in any conversation — your browser opens, you approve, you're in.

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

### Hosted (SSE) — no local install

Add to your client:

```
https://mcp.ararahq.com/sse
```

Authenticate with `x-arara-key: ara_live_...` or the OAuth flow.

### Headless (CI / n8n / server)

Skip OAuth — set the env var and run:

```sh
ARARA_API_KEY=ara_live_xxx npx ararahq-mcp --stdio
```

---

## 5 things you can do right now

**1. Ask Claude:** *"Quantas mensagens entregamos essa semana e quanto gastei?"*
→ Claude reads `arara://wallet/balance` + calls `get_delivery_metrics`. Two-line answer.

**2. Ask Claude:** *"Manda uma promoção pra 200 leads do último mês com 10% off."*
→ Triggers the `plan_campaign` prompt. Estimates cost, asks for approval, dispatches with idempotency key.

**3. Ask Claude:** *"O cliente +5511999998888 reclamou. Como respondo?"*
→ Runs `respond_to_complaint`. Reads conversation history, asks Brain for a suggestion in your tone, shows it, sends on approval.

**4. Ask Claude:** *"Tem dinheiro saindo da minha conta? Recupera o que dá."*
→ Runs `recover_revenue`. Scans AbacatePay leaks, enriches with WhatsApp history, proposes offers per leak.

**5. Ask Claude:** *"Cria um Smart Link pra meu bio do Instagram que mande mensagem pra +5511999998888 com texto pré-pronto."*
→ Calls `create_smart_link`. Returns a short URL with click tracking + QR code.

---

## Why an MCP, not an API client?

A regular API client needs you to remember endpoints, payload shapes, validation rules. The MCP gives the LLM:

- **Tools** with self-describing schemas — LLM picks the right one
- **Resources** the LLM reads passively — no extra call for "what's my balance"
- **Prompts** that orchestrate multi-step flows — `plan_campaign`, `recover_revenue`, `weekly_review` work in one command
- **OAuth handshake** — no key copy-paste

You speak Portuguese. Claude does the rest.

---

## Tool index

<details>
<summary><b>Auth</b> — login, logout, whoami</summary>

| Tool | What it does |
|---|---|
| `login` | OAuth device flow. Opens browser, polls until approved, stores token in OS keychain. |
| `logout` | Wipes token from keychain. |
| `whoami` | Shows authenticated user + active organization + plan. |

</details>

<details>
<summary><b>Messaging</b> — send_message, send_template_to_many, get_message_status, list_messages</summary>

`send_message` accepts EITHER `text` (free text, requires open 24h window) OR `templateName` + `templateVariables` (always allowed). Guardian content checks run before dispatch. `send_template_to_many` handles up to 1000 recipients with per-recipient variables.

</details>

<details>
<summary><b>Templates</b> — list, create, get_status, get_analytics, delete</summary>

`create_template` supports body + header (text/media/document) + footer + samples. Meta approval typically takes 1–5 minutes; poll with `get_template_status`.

</details>

<details>
<summary><b>Campaigns</b> — create, list, get, estimate_cost, cancel</summary>

`create_campaign` accepts optional `idempotencyKey` to safely retry on network errors. `estimate_campaign_cost` previews spend before commit.

</details>

<details>
<summary><b>Contacts</b> — list, upsert (batch up to 1000), get, stats</summary>

`upsert_contacts` returns per-row errors so the LLM can summarize bad rows. Custom attributes accepted as free-form JSON.

</details>

<details>
<summary><b>Conversations</b> — list, get_messages, reply, lead_stats</summary>

`reply_in_conversation` only works within an open 24h session window. Use `send_message` with a template to reopen.

</details>

<details>
<summary><b>Brain</b> — interact, suggest_reply, knowledge CRUD, ingest_url, get_config</summary>

`brain_interact` answers about your business using your templates + knowledge + history. `brain_suggest_reply` drafts on-brand replies. `ingest_url_to_brain` crawls a URL into the knowledge base.

</details>

<details>
<summary><b>Smart Links</b> — create, list, update, stats <i>(Arara DNA)</i></summary>

Trackable wa.me alternative with per-link QR code and click counting. Use in bios, ads, footers.

</details>

<details>
<summary><b>Recovery</b> — endpoint, events, ingests, retry <i>(paid feature)</i></summary>

Manage the cart-abandonment / order-event funnel: configure events, fire test ingests with your own phone, list & retry failures.

</details>

<details>
<summary><b>Numbers</b> — list, update, request, sync, list_requests</summary>

Manage WhatsApp numbers, request new ones, force sync of profile (display name / vertical) with Meta.

</details>

<details>
<summary><b>Account</b> — wallet_balance, org_info, delivery_metrics, brain_metrics, transactions</summary>

Quick reads of the org state. Often combined into the `weekly_review` prompt.

</details>

<details>
<summary><b>API Keys</b> — list, create, rotate, revoke</summary>

`rotate_api_key` revokes the old and issues new in one call — for handling compromise without downtime.

</details>

<details>
<summary><b>Phone Lookup</b> — single, batch (R$ 0,05 each)</summary>

Validate phones before sending. Returns mobile/landline, carrier, hasWhatsapp.

</details>

<details>
<summary><b>Guardian</b> — configure_policy</summary>

Custom regex rules per session that block sensitive content + brand-policy violations on outbound. Built-in rules (CPF, CNPJ, CVV, passwords, tokens) are always on.

</details>

<details>
<summary><b>AbacatePay</b> — find_revenue_leaks, negotiate_payment, check_payment_status</summary>

Atomic recovery cycles: scan leaks → propose offer → dispatch payment link via WhatsApp → verify payment. Conversation as contract.

</details>

---

## Resources (LLM reads, no tool call)

- `arara://organization/me` — org name, plan, consumption
- `arara://wallet/balance` — live BRL balance
- `arara://templates/approved` — only APPROVED templates, ready to use
- `arara://numbers` — active WhatsApp numbers
- `arara://campaigns/recent` — last 10
- `arara://recovery/funnel` — recovery endpoint health + recent ingest mix

---

## Prompts (slash workflows)

| Prompt | When to use |
|---|---|
| `plan_campaign` | "I want to send X to Y people" — handles audience → template → estimate → confirm → dispatch |
| `respond_to_complaint` | A specific conversation in COMPLAINT state — reads history, drafts reply via Brain, sends on approval |
| `recover_revenue` | Pull AbacatePay leaks, propose per-leak offers, dispatch payment links with operator approval |
| `onboard_customer` | New customer → validate phone → register → welcome message |
| `weekly_review` | Compile balance + metrics + campaigns + recovery into a paste-ready summary |

---

## Configuration

```sh
# OAuth is the default; these are all optional overrides.
ARARA_API_KEY=ara_live_xxx          # Fallback / headless mode
ARARA_BASE_URL=https://...          # Override (default: https://api.ararahq.com/api)
ABACATE_API_KEY=xxx                 # For AbacatePay tools
ARARA_MCP_TELEMETRY=off             # Disable usage telemetry
PORT=3333                           # SSE mode port (default)
MCP_TRANSPORT=sse                   # Force SSE instead of stdio
```

Tokens are stored via [keytar](https://github.com/atom/node-keytar) — macOS Keychain, Linux Secret Service, Windows Credential Manager. Never on disk.

---

## Local dev

```sh
npm install
npm run build
node build/index.js --stdio          # for Claude Desktop testing
PORT=3333 node build/index.js        # for SSE testing on localhost
```

---

## Get help

- Docs: [docs.ararahq.com](https://docs.ararahq.com)
- Issues: [github.com/ararahq/ararahq-mcp/issues](https://github.com/ararahq/ararahq-mcp/issues)
- WhatsApp: just message any Arara number — yes, we use our own product

---

Built in São Paulo · MIT license · © AraraHQ
