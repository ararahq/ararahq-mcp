# Arara MCP Server

[![npm](https://img.shields.io/npm/v/ararahq-mcp)](https://www.npmjs.com/package/ararahq-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Docs](https://img.shields.io/badge/Docs-docs.ararahq.com-orange)](https://docs.ararahq.com)

This MCP server transforms any AI (Claude, Cursor, etc.) into a **Revenue Operating System** powered by [AraraHQ](https://ararahq.com) and AbacatePay. Send WhatsApp messages, recover failed payments, run campaigns, and manage your entire communication stack — all through natural language.

## The 5 Pillars

1. **Autonomous Revenue Recovery** — Scan for failed payments and recover revenue automatically
2. **Atomic Negotiation** — Create payment links and send them via WhatsApp in a single call
3. **Guardian Mode** — Brand safety firewall that blocks sensitive content in all outbound messages
4. **Business Memory Layer** — Customer intelligence with sentiment analysis and LTV estimation
5. **Mass Orchestration** — Campaign dispatch with response triage and auto-handling

## Tools (19 total)

### Guardian Mode (Pillar 3)

| Tool | Description |
|------|-------------|
| `configure_guardian_policy` | Set custom brand safety rules for the session. Built-in rules (CPF, CVV, passwords, API keys) are always active |

### Messaging

| Tool | Description |
|------|-------------|
| `send_smart_message` | Send a WhatsApp message to a single recipient. Guardian mode screens content before dispatch |
| `send_batch_messages` | Send up to 1,000 WhatsApp messages in a single call with Guardian mode screening |
| `upload_media` | Upload media (image, PDF, video) to Arara storage from a public URL. Returns short URL for use in messages |

### Revenue Recovery (Pillar 1)

| Tool | Description |
|------|-------------|
| `autonomous_recovery` | Scan AbacatePay for revenue leaks (pending/expired/cancelled checkouts), enrich with WhatsApp history, and return action briefing with total R$ at risk |
| `check_revenue_leaks` | Quick scan for AbacatePay revenue leaks. For full briefing with customer context, use `autonomous_recovery` instead |

### Negotiation & Payments (Pillar 2)

| Tool | Description |
|------|-------------|
| `atomic_negotiation_cycle` | Full negotiation in one call: creates product on AbacatePay, generates checkout, sends payment link via WhatsApp, returns all tracking IDs |
| `negotiate_payment` | Create a product and checkout link on AbacatePay. For full atomic cycle that also sends via WhatsApp, use `atomic_negotiation_cycle` |
| `confirm_payment_handshake` | Verify real-time payment status of an AbacatePay checkout |

### Business Memory (Pillar 4)

| Tool | Description |
|------|-------------|
| `build_business_memory` | Deep customer intelligence: analyzes conversation history for sentiment, estimates LTV from payment history, builds structured profile, and optionally persists to knowledge base |
| `manage_knowledge_base` | Read and write the AI brain knowledge base. Used by `build_business_memory` to persist customer profiles |

### Campaigns (Pillar 5)

| Tool | Description |
|------|-------------|
| `create_campaign` | Dispatch a template campaign to a segmented list with individual variables per recipient |
| `monitor_campaign_responses` | Fetch and triage inbound responses. Classifies as URGENT / COMPLAINT / QUESTION / POSITIVE / ROUTINE. Auto-handles routine, escalates critical |

### Platform Management

| Tool | Description |
|------|-------------|
| `get_account_overview` | Full account snapshot: wallet balance, delivery metrics, total spend, delivery rate |
| `manage_templates` | Full template lifecycle: list, create, check approval status, view analytics, delete |
| `manage_messages` | List messages from the dashboard or get status of a specific message by ID |
| `manage_conversations` | List active conversations, get full message history, or reply in an open session window |
| `manage_organization` | Manage organization settings: phone numbers, webhook config, AI brain, team members |
| `manage_api_keys` | List, create, or revoke Arara API keys |

## Authentication & Security

Two hosting models:

1. **Private Hosting** — Set `ARARA_API_KEY` and `ABACATE_API_KEY` in your environment. The server uses these for all requests.
2. **Public Hosting (mcp.ararahq.com)** — Users provide their own `apiKey` to each tool call.

All tools accept an optional `apiKey` parameter which overrides environment variables.

## Installation

### Hosted (Recommended)

No local install needed. Connect directly to our hosted instance.

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ararahq": {
      "url": "https://mcp.ararahq.com/sse",
      "headers": {
        "X-Arara-Key": "YOUR_ARARA_API_KEY"
      }
    }
  }
}
```

#### Cursor

Go to **Settings > Models > MCP Servers** and add a new `SSE` server:
- **Name**: AraraHQ
- **URL**: `https://mcp.ararahq.com/sse`

### Local (Private)

Run locally using `npx`:

```json
{
  "mcpServers": {
    "ararahq": {
      "command": "npx",
      "args": ["-y", "ararahq-mcp"],
      "env": {
        "ARARA_API_KEY": "YOUR_KEY_HERE",
        "ABACATE_API_KEY": "YOUR_KEY_HERE"
      }
    }
  }
}
```

### Docker

```bash
docker build -t ararahq-mcp .
docker run -p 3333:3333 -e PORT=3333 ararahq-mcp
```

### Local Development

```bash
npm run build
node build/index.js --transport sse
```

Server runs on `http://localhost:3333` by default.

## Usage Examples

- *"Check who didn't pay their Pix yesterday on AbacatePay and send a reminder via WhatsApp."*
- *"Generate a payment link for R$50 for customer X with a 10% discount and send it."*
- *"Run a campaign with the welcome template to all contacts imported today."*
- *"Show me my account overview — wallet balance and delivery rate."*
- *"What is the sentiment history of customer Y before I respond?"*

## Contributing

See [CONTRIBUTING.md](https://github.com/ararahq/.github/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT - [AraraHQ](https://ararahq.com)
