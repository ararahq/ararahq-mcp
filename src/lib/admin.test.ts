import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import axios from "axios";
import { z } from "zod";
import { adminRequest } from "./admin.js";
import * as tokens from "../auth/tokens.js";
import { AraraError } from "./errors.js";

describe("adminRequest", () => {
  let requestSpy: MockInstance<typeof axios.request>;

  beforeEach(() => {
    requestSpy = vi.spyOn(axios, "request");
    vi.spyOn(tokens, "getAccessToken").mockResolvedValue("session-jwt");
  });

  afterEach(() => {
    delete process.env.ARARA_ADMIN_SECRET;
  });

  it("fails with ADMIN_NOT_CONFIGURED when the secret env is missing", async () => {
    delete process.env.ARARA_ADMIN_SECRET;
    await expect(
      adminRequest("/v1/admin/wallet/x/balance", { schema: z.unknown() }),
    ).rejects.toMatchObject({ code: "ADMIN_NOT_CONFIGURED" });
  });

  it("sends the secret only as a header and never in the result", async () => {
    process.env.ARARA_ADMIN_SECRET = "super-secret";
    requestSpy.mockResolvedValue({ data: { ok: true } });

    const result = await adminRequest("/v1/admin/diagnostics/failures", {
      schema: z.object({ ok: z.boolean() }),
    });

    expect(result).toEqual({ ok: true });
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer session-jwt", "X-Admin-Secret": "super-secret" },
      }),
    );
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("maps an unexpected response shape to INVALID_API_RESPONSE", async () => {
    process.env.ARARA_ADMIN_SECRET = "super-secret";
    requestSpy.mockResolvedValue({ data: { unexpected: 1 } });

    await expect(
      adminRequest("/v1/admin/diagnostics/failures", {
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toBeInstanceOf(AraraError);
  });
});
