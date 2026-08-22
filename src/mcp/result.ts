import { z } from "zod";
import { toAraraError } from "../lib/errors.js";

export const toolOutputSchema = {
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      retryAfterSeconds: z.number().optional(),
    })
    .optional(),
};

export const success = (data: unknown, message: string) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: { ok: true, data },
});

export const failure = (error: unknown) => {
  const normalized = toAraraError(error);
  const details = {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
    ...(normalized.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: normalized.retryAfterSeconds }),
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${details.code}: ${details.message}` }],
    structuredContent: { ok: false, error: details },
  };
};

export const execute = async (task: () => Promise<{ data: unknown; message: string }>) => {
  try {
    const result = await task();
    return success(result.data, result.message);
  } catch (error) {
    return failure(error);
  }
};
