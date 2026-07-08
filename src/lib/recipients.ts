import axios from "axios";
import { apiGet } from "./api.js";

export type BackendError = { status?: number; message: string };

export const readBackendError = (error: unknown): BackendError => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined;
    const nested = (data?.error as Record<string, unknown> | undefined)?.message;
    const candidate = nested ?? data?.message ?? data?.error ?? error.message;
    // Corpo de erro nem sempre traz strings (ex: 500 do Spring) —
    // sem a coerção, o caller imprime "[object Object]".
    const message =
      typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? error.message);
    return { status: error.response?.status, message };
  }
  return { message: String(error) };
};

export const looksLikePhone = (value: string): boolean => /^[+\d][\d\s().-]{7,}$/.test(value.trim());

export const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length >= 12 && digits.startsWith("55")) {
    const withoutCountry = digits.slice(2);
    if (withoutCountry.length === 10) {
      const ddd = withoutCountry.slice(0, 2);
      const rest = withoutCountry.slice(2);
      return `+55${ddd}9${rest}`;
    }
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
};

export type Recipient = { phone: string; name?: string };

export const recipientLabel = (recipient: Recipient): string =>
  recipient.name ? `${recipient.phone} (${recipient.name})` : recipient.phone;

export const resolveRecipient = async (
  to: string,
  apiKey?: string,
): Promise<Recipient | { error: string }> => {
  if (looksLikePhone(to)) return { phone: normalizePhone(to) };
  const response = await apiGet("/v1/contacts", {
    tokenOverride: apiKey,
    params: { q: to, page: 0, size: 5 },
    toolName: "resolve_recipient",
  });
  const contacts: Array<{ name?: string; phone?: string }> = response.data?.contacts ?? [];
  const named = contacts.filter((c) => c.phone);
  if (named.length === 0) {
    return { error: `Não achei nenhum contato chamado "${to}". Passe o número direto ou salve o contato com save_contacts.` };
  }
  if (named.length > 1) {
    const options = named.map((c) => `${c.name} (${c.phone})`).join(", ");
    return { error: `"${to}" casa com mais de um contato: ${options}. Use o número específico.` };
  }
  return { phone: normalizePhone(named[0].phone!), name: named[0].name };
};
