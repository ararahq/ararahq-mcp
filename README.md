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

## 🐳 Docker & Hosting (SSE Mode)

The repository is ready to run as a cloud server (e.g., `mcp.ararahq.com`).

```bash
# 1. Build the image
docker build -t ararahq-mcp .

# 2. Run as Server (SSE)
# The container automatically detects the PORT variable
docker run -p 3333:3333 -e PORT=3333 ararahq-mcp
```

### Local Development
If you are developing or want to test the server mode without Docker:
```bash
npm run build
node build/index.js --transport sse
```

(The server will run on `http://localhost:3333` by default)

---

## Usage Examples

- *"AI, check who didn't pay their Pix yesterday on AbacatePay and send a reminder via Arara."*
- *"Generate a payment link for R$ 50 for customer X with a 10% discount."*
- *"What is the mood history of customer Y before I respond?"*

---
*Built with ❤️ by Arara Architecture Team.*
