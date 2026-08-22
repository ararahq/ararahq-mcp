# AraraHQ MCP

Official Model Context Protocol server for operating AraraHQ Atendimento across support, billing and scheduling.

Version 5 is a clean break from the legacy CPaaS-oriented server. Node.js is the only canonical implementation, OAuth is the authentication boundary, and both the npm scope and public repository are owned by AraraHQ: [`@ararahq/mcp`](https://www.npmjs.com/package/@ararahq/mcp) and [`ararahq/mcp`](https://github.com/ararahq/mcp).

## What it exposes

- Atendimento: today queue, paginated conversation discovery and timeline, claim, reply and close.
- Automations: list and inspect configured automations.
- Campaigns: preflight and idempotent publication tied to a published Atendimento routine.
- WhatsApp operations: single-message send, delivery lookup, templates, contacts and opt-outs.
- Context: organization, operational health, approved templates, channels and coverage.

Every tool returns both human-readable content and stable structured content. Write tools carry MCP safety annotations. Credentials never appear in tool inputs or output.

## Local installation

Requires Node.js 20 or newer.

```bash
npx -y @ararahq/mcp login
npx -y @ararahq/mcp status
```

The device authorization flow opens AraraHQ in the browser. Access and refresh tokens are stored in the operating-system keychain, never in a project file or client configuration.

Configure an MCP client with stdio:

```json
{
  "mcpServers": {
    "ararahq": {
      "command": "npx",
      "args": ["-y", "@ararahq/mcp", "--stdio"]
    }
  }
}
```

Useful diagnostics:

```bash
npx -y @ararahq/mcp doctor
npx -y @ararahq/mcp tools
npx -y @ararahq/mcp logout
```

## Hosted transport

The hosted server uses stateless MCP Streamable HTTP at `POST /mcp`. It accepts OAuth bearer tokens only in the `Authorization` header. Query-string credentials, API-key tool arguments, legacy SSE endpoints, permissive CORS and debug endpoints do not exist.

```bash
MCP_TRANSPORT=http \
PORT=3333 \
MCP_PUBLIC_URL=https://mcp.ararahq.com/mcp \
MCP_ALLOWED_HOSTS=mcp.ararahq.com \
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai \
ARARA_OAUTH_ISSUER=https://api.ararahq.com/api \
npm start
```

Protected Resource Metadata is served at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

AraraHQ currently issues installed-client OAuth tokens through its device authorization flow. Hosted clients must supply a valid AraraHQ OAuth bearer token; the MCP does not proxy credentials or mint tokens.

## Tool catalog

`whoami`, `get_today`, `find_conversations`, `get_conversation`, `reply_to_conversation`, `claim_conversation`, `close_conversation`, `list_automations`, `get_automation`, `prepare_campaign`, `publish_campaign`, `send_whatsapp`, `check_message`, `save_contacts`, `create_template`, `get_template_status`, `opt_out`.

Campaign publication validates that the Meta template is approved and available, and that its destination routine (`support`, `billing` or `scheduling`) is published. Message acceptance is reported as queued—not delivered—and delivery is checked separately.

## Development

```bash
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

The server defaults to stdio. Use `MCP_TRANSPORT=http npm start` for Streamable HTTP. Override the API only for controlled environments with `ARARA_API_URL`.

The former unscoped package `ararahq-mcp` is the frozen v4 distribution. New installations and every v5 release use `@ararahq/mcp`.

## Security

- OAuth tokens remain server-side and are redacted by design.
- External HTTP requests have explicit timeouts.
- Retries are limited to safe methods or requests carrying an idempotency key and honor `Retry-After`.
- All consumed API payloads are validated before fields are used.
- Hosted requests are rate-limited and checked against explicit host and origin allowlists.
- No telemetry is collected by this package.

Report vulnerabilities privately to `security@ararahq.com`.

## License

MIT © AraraHQ
