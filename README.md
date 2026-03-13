# Arara Revenue OS MCP Server

This MCP server transforms any AI (Claude, Cursor, etc.) into a **Revenue Operating System** powered by Arara and AbacatePay. It is designed for scale, enabling autonomous revenue recovery and atomic negotiations.

## The 5 Pillars of Arara Revenue OS

1.  **Autonomous Revenue Recovery**: Monitor and recover failed payments automatically.
2.  **Atomic Negotiation**: Dynamic payment link generation with built-in discount logic.
3.  **Guardian Mode**: Brand safety firewall for all outgoing communications.
4.  **Business Memory Layer (BML)**: Persistent customer context and sentiment analysis.
5.  **Mass Orchestration**: Intelligent, large-scale communication management.

## Features & Tools

- **`send_smart_message`**: Send WhatsApp messages via Arara API (integrated with Guardian Mode).
- **`check_revenue_leaks`**: **(V2)** Proactively scan AbacatePay checkouts for failed/pending payments.
- **`negotiate_payment`**: **(V2)** Atomic negotiation: Creates dynamic products and checkouts in one go.
- **`confirm_payment_handshake`**: **(V2)** Real-time verification of checkout status (Trusted Handshake).
- **`get_customer_insights`**: **(BML)** Access unified customer context from Arara & AbacatePay.
- **`mass_orchestration`**: Trigger intelligent, large-scale campaigns with safety checks.

## Authentication & Security

This server supports two hosting models:

1.  **Dedicated / Private Hosting**: Best for personal use or internal teams. Set `ARARA_API_KEY` and `ABACATE_API_KEY` in your environment. The server will use these keys for all requests by default.
2.  **Shared / Public Hosting (mcp.ararahq.com)**: Best for public distribution. Do **not** set global environment variables. Users must provide their own `apiKey` to each tool call.

All tools accept an optional `apiKey` parameter which overrides environment variables.

## Installation & Connection

### 1. Mode: Hosted (Recommended)
The fastest way to use the Arara MCP is via our official hosted instance. You don't need to install anything locally.

#### Claude Desktop
Add this to your `claude_desktop_config.json`:

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

---

### 2. Mode: Local (Private)
If you prefer to run the server locally using `npx`:

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
