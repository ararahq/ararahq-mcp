# Arara Revenue OS MCP Server

This MCP server transforms any AI (Claude, Cursor, etc.) into a **Revenue Operating System** powered by Arara and AbacatePay.

## Features

- **Guardian Mode**: Automatic safety filter for brand-safe communication.
- **Smart Messaging**: Send WhatsApp messages via Arara API.
- **Atomic Negotiation**: Generate payment links via AbacatePay dynamically.
- **Business Memory**: Access customer context and "mood" history.

## Authentication & Security

The server supports two ways of providing API Keys:
1.  **Environment Variables (Recommended)**: Set `ARARA_API_KEY` and `ABACATE_API_KEY` in your environment or a `.env` file inside the `ararahq-mcp` folder.
2.  **Tool Parameters**: You can pass the `apiKey` directly to any tool call if needed (useful for multi-tenant scenarios).

## Installation

### 1. Claude Desktop (World-wide)
Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ararahq": {
      "command": "npx",
      "args": ["-y", "ararahq-mcp"]
    }
  }
}
```

### 2. Cursor
Go to **Settings > Models > MCP Servers** and add a new `command` server:
- **Name**: AraraHQ
- **Command**: `npx -y ararahq-mcp`

---

### Local Development (Experimental)
If you are developing this server locally, use the direct path to your build:
`node /absolute/path/to/ararahq-mcp/build/index.js`

## Usage Examples

- *"IA, verifique quem não pagou o Pix ontem na AbacatePay e mande um lembrete via Arara."*
- *"Gere um link de pagamento de R$ 50 para o cliente X com 10% de desconto."*
- *"Qual o histórico de humor do cliente Y antes de eu responder?"*

---
*Built with ❤️ by Arara Architecture Team.*
