import { apiRequest } from "./api.js";
import { AraraError } from "./errors.js";
import { identitySchema } from "./schemas.js";

/**
 * Operator tools are gated by an e-mail allowlist held only in the server process
 * environment (ARARA_OPERATOR_EMAILS, comma-separated). Fail closed: with the
 * variable unset or empty, every operator tool is refused.
 *
 * The identity is fetched per call, never cached at module level: the HTTP
 * transport serves concurrent requests from different accounts in one process,
 * so a process-wide cache would let one caller ride another caller's identity.
 */
export const getAllowedOperatorEmails = (raw = process.env.ARARA_OPERATOR_EMAILS): string[] =>
  (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

export const assertOperatorAllowed = async (): Promise<void> => {
  const allowed = getAllowedOperatorEmails();
  if (allowed.length === 0) {
    throw new AraraError(
      "OPERATOR_NOT_CONFIGURED",
      "Operator tools require ARARA_OPERATOR_EMAILS in the MCP server environment.",
      403,
      false,
    );
  }
  const identity = await apiRequest("/auth/me", { schema: identitySchema });
  if (!allowed.includes(identity.email.toLowerCase())) {
    throw new AraraError(
      "OPERATOR_NOT_ALLOWED",
      "The authenticated account is not allowed to use operator tools.",
      403,
      false,
    );
  }
};
