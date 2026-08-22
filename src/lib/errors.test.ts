import axios from "axios";
import { describe, expect, it } from "vitest";
import { toAraraError } from "./errors.js";

describe("error normalization", () => {
  it("preserves the backend error contract and Retry-After", () => {
    const response = {
      status: 429,
      data: { error: { code: "RATE_LIMITED", message: "Wait." } },
      headers: { "retry-after": "7" },
      statusText: "Too Many Requests",
      config: {},
    };
    const normalized = toAraraError(
      new axios.AxiosError("limited", "ERR_BAD_RESPONSE", undefined, undefined, response as never),
    );
    expect(normalized).toMatchObject({
      code: "RATE_LIMITED",
      message: "Wait.",
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it("does not leak arbitrary internal errors", () => {
    const normalized = toAraraError(new Error("secret details"));
    expect(normalized.message).not.toContain("secret details");
  });
});
