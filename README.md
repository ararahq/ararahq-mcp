# Arara MCP

[![npm](https://img.shields.io/npm/v/ararahq-mcp)](https://www.npmjs.com/package/ararahq-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-ararahq.com-orange)](https://docs.ararahq.com/mcp-server)

Turn Claude Code, Claude Desktop, Cursor, Windsurf or ChatGPT into a WhatsApp operator that knows your customers, your templates, your wallet, and your funnel. Built by [AraraHQ](https://ararahq.com) — Brazilian CPaaS for WhatsApp, homologated by Meta.

**84 tools · OAuth login · stdio + SSE**

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

## 5 things you can do right now

**1. Ask the LLM:** *"Quantas mensagens entregamos essa semana e quanto gastei?"*
→ Calls `get_delivery_metrics` + `get_wallet_balance`. Two-line answer.

**2. Ask:** *"Manda a promoção 'black_friday_30off' pros 200 leads mais quentes do mês passado."*
→ Chains `list_contacts` → `list_templates` → `estimate_campaign_cost` → approval → `create_campaign` with idempotency key.

**3. Ask:** *"O cliente +5511999998888 reclamou. Como respondo?"*
→ Reads conversation history with `get_conversation_messages`, drafts on-brand reply via `brain_suggest_reply`, sends on approval.

**4. Ask:** *"Tem dinheiro saindo da minha conta? Recupera o que dá."*
→ Scans AbacatePay leaks via `find_revenue_leaks`, enriches with WhatsApp history, proposes per-leak offer via `negotiate_payment`.

**5. Ask:** *"Cria um Smart Link pro meu bio do Instagram que mande mensagem pro +5511999998888 com texto pré-pronto."*
→ Calls `create_smart_link`. Returns short URL with click tracking + QR code.

---

## Why an MCP, not a raw API client?

A raw API client needs you to remember endpoints, payload shapes, validation rules, idempotency keys, the 24h window, template approval state. The MCP wraps all of that into 84 self-describing tools the LLM picks from — plus an OAuth handshake so you never paste keys into your editor.

You speak Portuguese. The LLM does the rest.

---

## Tool index

84 tools across 16 domains. Full descriptions ship as MCP tool metadata (your client surfaces them automatically). High-level breakdown:

<details>
<summary><b>Auth</b> — 3 tools</summary>

`login` · `logout` · `whoami`

OAuth device flow: opens browser, polls until approved, stores token in OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Manager). Never on disk.

</details>

<details>
<summary><b>Messaging</b> — 4 tools</summary>

`send_message` · `send_template_to_many` · `get_message_status` · `list_messages`

`send_message` accepts EITHER `text` (free text, requires open 24h window) OR `templateName` + `templateVariables` (always allowed). Guardian content checks run before dispatch. `send_template_to_many` handles up to 1000 recipients with per-recipient variables.

</details>

<details>
<summary><b>Templates</b> — 6 tools</summary>

`list_templates` · `create_template` · `get_template_status` · `get_template_analytics` · `delete_template` · `list_paused_templates`

`create_template` supports body + header (text/media/document) + footer + samples. Meta approval typically takes 1–5 minutes; poll with `get_template_status`.

</details>

<details>
<summary><b>Campaigns</b> — 8 tools</summary>

`create_campaign` · `list_campaigns` · `get_campaign` · `estimate_campaign_cost` · `cancel_campaign` · `create_ab_test` · `get_ab_test` · `force_ab_test_winner`

`create_campaign` accepts optional `idempotencyKey` to safely retry on network errors. `estimate_campaign_cost` previews spend before commit.

</details>

<details>
<summary><b>Conversations</b> — 6 tools</summary>

`list_conversations` · `get_conversation_messages` · `reply_in_conversation` · `check_window_status` · `bulk_window_check` · `get_lead_stats`

`reply_in_conversation` only works within an open 24h session window. Use `send_message` with a template to reopen.

</details>

<details>
<summary><b>Contacts</b> — 4 tools</summary>

`list_contacts` · `get_contact` · `upsert_contacts` · `get_contact_stats`

`upsert_contacts` accepts up to 1000 per call and returns per-row errors so the LLM can summarize bad rows. Custom attributes as free-form JSON.

</details>

<details>
<summary><b>Numbers</b> — 7 tools</summary>

`list_numbers` · `get_number_health` · `request_new_number` · `list_number_requests` · `sync_number_with_meta` · `update_number` · `get_warming_plan`

Manage WhatsApp numbers, request new ones, force sync of profile (display name / vertical) with Meta, track warmup health.

</details>

<details>
<summary><b>Smart Links</b> — 4 tools <i>(Arara DNA)</i></summary>

`create_smart_link` · `list_smart_links` · `update_smart_link` · `get_smart_link_stats`

Trackable wa.me alternative with per-link QR code, click counting, and first-party attribution. Use in bios, ads, footers.

</details>

<details>
<summary><b>Brain (AI)</b> — 9 tools</summary>

`brain_interact` · `brain_suggest_reply` · `get_brain_config` · `get_brain_metrics` · `add_brain_knowledge` · `list_brain_knowledge` · `update_brain_knowledge` · `delete_brain_knowledge` · `ingest_url_to_brain`

`brain_interact` answers about your business using your templates + knowledge + history. `brain_suggest_reply` drafts on-brand replies. `ingest_url_to_brain` crawls a URL into the knowledge base.

</details>

<details>
<summary><b>Recovery (AbacatePay)</b> — 10 tools <i>(paid feature)</i></summary>

`find_revenue_leaks` · `negotiate_payment` · `check_payment_status` · `get_recovery_endpoint` · `list_recovery_events` · `configure_recovery_event` · `test_recovery_event` · `set_recovery_endpoint_active` · `list_recovery_ingests` · `retry_recovery_ingest`

Atomic recovery cycles: scan leaks → propose offer → dispatch payment link via WhatsApp → verify payment. Conversation as contract.

</details>

<details>
<summary><b>Wallet & account</b> — 5 tools</summary>

`get_wallet_balance` · `list_wallet_transactions` · `get_organization_info` · `get_delivery_metrics` · `get_pricing`

Quick reads of the org state. Compose into your own "weekly review" prompt.

</details>

<details>
<summary><b>Guardian (brand safety)</b> — 3 tools</summary>

`configure_guardian_policy` · `list_policy_violations` · `resolve_policy_violation`

Custom regex rules per session that block sensitive content + brand-policy violations on outbound. Built-in rules (CPF, CNPJ, CVV, passwords, tokens) are always on.

</details>

<details>
<summary><b>Opt-out & LGPD</b> — 6 tools</summary>

`list_opt_outs` · `register_opt_out` · `revoke_opt_out` · `check_opt_out` · `lgpd_export_contact` · `lgpd_delete_contact`

LGPD compliance built in: opt-out lifecycle + data export/delete on request.

</details>

<details>
<summary><b>Phone Lookup</b> — 2 tools <i>(R$ 0,05 each)</i></summary>

`lookup_phone` · `lookup_phones_batch`

Validate phones before sending. Returns mobile/landline, carrier, `hasWhatsapp`.

</details>

<details>
<summary><b>API keys</b> — 4 tools</summary>

`list_api_keys` · `create_api_key` · `rotate_api_key` · `revoke_api_key`

`rotate_api_key` revokes the old and issues new in one call — for handling compromise without downtime.

</details>

<details>
<summary><b>Business profile</b> — 3 tools</summary>

`get_business_profile` · `update_business_profile` · `sync_business_profile`

Manage your business display name, description, vertical, and sync state with Meta.

</details>

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
ABACATE_API_KEY=xxx                 # For AbacatePay tools
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
