# Arara MCP v5 — Atendimento

## Objective

Replace the legacy WhatsApp/CPaaS-oriented MCP surface with one small operational
surface for Atendimento. The Node repository is the only canonical MCP
implementation. The canonical npm package is `@ararahq/mcp`; the canonical source
repository is `ararahq/mcp`. The former `ararahq-mcp` name remains frozen on v4.

## Product contract

The MCP represents one operation spanning Support, Billing, and Scheduling. Its
primary concepts are Today, Conversations, Automations, and Campaigns. Every
conversation result must expose owner, stage, next step, deadline, handoff, and
measurable outcome when those fields exist in the API.

The v4 "burro first" interaction rule remains: tools ask for information a human
operator knows and leave protocol, formatting, window, template, and idempotency
details to Arara. The v5 surface and count explicitly supersede the v4 ten-tool
catalog. There is no wildcard template fallback.

## Architecture

- `server/` owns server construction and the canonical registry.
- `transports/` owns stdio and Streamable HTTP lifecycle.
- `auth/` owns OAuth, secure token storage, and request authentication.
- `lib/` owns HTTP execution, retry, error normalization, and Zod response schemas.
- `tools/`, `resources/`, and `prompts/` own the public Atendimento contract.
- `mcp/` owns stable structured tool results.

No transport owns business tools. No tool accepts an API key argument. Remote auth
is resolved on every HTTP request; local stdio uses OAuth device flow. Atendimento
requires OAuth; there is no API-key fallback in v5.

## Canonical surface

Primary tools:

- `whoami`
- `get_today`
- `find_conversations`
- `get_conversation`
- `reply_to_conversation`
- `claim_conversation`
- `close_conversation`
- `list_automations`
- `get_automation`
- `prepare_campaign`
- `publish_campaign`
- `send_whatsapp`
- `check_message`

Supporting tools:

- `save_contacts`
- `create_template`
- `get_template_status`
- `opt_out`

Resources:

- `arara://organization`
- `arara://operation/health`
- `arara://templates/approved`
- `arara://channels`
- `arara://coverage`

Prompts:

- `triage_today`
- `draft_reply`
- `campaign_preflight`
- `close_case_review`

Filtered and paginated collections are tools, not static resources.

## Security and transport

- Remote transport is Streamable HTTP at `/mcp`.
- Legacy HTTP+SSE, `/debug`, query-string credentials, and wildcard CORS are removed.
- Validate `Origin` and `Host`; apply explicit body and request rate limits.
- Local OAuth uses the existing `arara-mcp` device flow. Remote requests accept
  OAuth Bearer JWTs and validate them against the authenticated `/auth/me` API
  endpoint before dispatch. Protected Resource Metadata advertises the configured
  Arara authorization issuer. Until the backend exposes standard OAuth discovery,
  remote clients obtain the token through the existing device flow rather than an
  invented authorization-code proxy.
- Tokens never appear in tool arguments, URLs, responses, or logs.
- HTTP runs statelessly: every POST receives a fresh server and transport with no
  `Mcp-Session-Id`. GET and DELETE return 405. This follows the SDK's stateless
  Streamable HTTP pattern and prevents cross-client transport reuse.
- Mutating calls carry one idempotency key across retries.
- Unsafe operations whose backend endpoint does not honor idempotency are never
  automatically retried. Closing a conversation is naturally idempotent; replying
  is single-attempt until the backend accepts `Idempotency-Key` there.

## Endpoint mapping and campaign invariants

- Today and inbox: `/v1/operation/today` and `/v1/operation/inbox`.
- Conversation detail: `/v1/conversations/{id}/messages`; metadata is selected
  first with `find_conversations`, because the backend has no direct conversation
  metadata endpoint.
- Claim: `/v1/operation/inbox/{id}/claim`.
- Reply: `/v1/conversations/reply`.
- Close: `PATCH /v1/conversations/{id}/status` with `CLOSED`.
- Automations: `/v1/automations` and `/v1/automations/{id}`.
- Campaign preparation: `/v1/operation/copilot/campaign` plus approved templates,
  published routines, and service coverage.
- Campaign publication: `POST /v1/campaigns`. The MCP makes `routineKey` mandatory,
  validates at least one recipient and an approved template, and returns the
  campaign ID and accepted state. It does not claim conversation IDs before the
  backend creates them from sends/replies.
- Supporting tools map directly to messages, contacts, templates, and opt-outs.

Every tool has an explicit Zod input schema, output schema, and annotations.

## Contracts and errors

- All API responses used by tools/resources are validated with Zod.
- Invalid upstream data returns `INVALID_API_RESPONSE`, not a runtime crash.
- Tool results contain human-readable text plus `structuredContent` governed by an
  output schema.
- Errors preserve stable codes, HTTP status, retryability, and `Retry-After`.
- Accepted/enqueued messages are never described as delivered.
- Pagination metadata is preserved.

## Developer experience

CLI commands: `login`, `logout`, `status`, `doctor`, `tools`, and `--version`.
README, Smithery metadata, package metadata, container names, and workflows point
to `ararahq/mcp`. Version and server identity are checked against package metadata
in tests.

## Verification

- Unit tests cover public identity, critical response validation, legacy-tool
  removal, and stable error mapping.
- Protocol smoke tests cover tool/resource/prompt listing and stdio lifecycle.
- HTTP smoke tests cover health and unauthenticated OAuth rejection.
- CI runs format/lint, typecheck, tests, package smoke, audit, and Docker build.
- No deployment, npm publish, commit, or push occurs without explicit approval.

## Migration and rollback

This is a clean major version with no v4 tool aliases. The organization-scoped npm
package starts at v5 while the former unscoped package remains available as the v4
rollback path. The legacy `/sse` endpoint is intentionally removed rather than
silently sharing state with `/mcp`.
