import { sessionContext, sessionGuardianRules } from "./auth.js";

const BUILT_IN_SENSITIVE_PATTERNS = [
  /\bpassword\b/i, /\bsenha\b/i, /credit.?card/i, /cartão.?de.?crédito/i,
  /\bcpf\b/i, /\bcnpj\b/i, /\bcvv\b/i, /api[_-]?key/i, /\bsecret\b/i,
  /\btoken\b/i,
];

export const guardian = (
  text: string,
  customRules: string[] = [],
): { safe: boolean; reason?: string } => {
  for (const pattern of BUILT_IN_SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Built-in policy violation: sensitive pattern "${pattern.source}"` };
    }
  }
  for (const rule of customRules) {
    const regex = new RegExp(rule, "i");
    if (regex.test(text)) {
      return { safe: false, reason: `Brand policy violation: custom rule "${rule}"` };
    }
  }
  return { safe: true };
};

export const getCustomRules = (): string[] => {
  const context = sessionContext.getStore();
  return context ? (sessionGuardianRules.get(context.sessionId) ?? []) : [];
};
