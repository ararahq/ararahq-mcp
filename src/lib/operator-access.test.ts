import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOperatorAllowed, getAllowedOperatorEmails } from "./operator-access.js";
import * as api from "./api.js";

describe("getAllowedOperatorEmails", () => {
  it("parses, trims and lowercases the list", () => {
    expect(getAllowedOperatorEmails(" Micael@ararahq.com , ops@ararahq.com ,, ")).toEqual([
      "micael@ararahq.com",
      "ops@ararahq.com",
    ]);
  });

  it("returns empty for unset or blank", () => {
    expect(getAllowedOperatorEmails(undefined)).toEqual([]);
    expect(getAllowedOperatorEmails("  ")).toEqual([]);
  });
});

describe("assertOperatorAllowed", () => {
  afterEach(() => {
    delete process.env.ARARA_OPERATOR_EMAILS;
  });

  it("fails closed when the allowlist env is missing", async () => {
    delete process.env.ARARA_OPERATOR_EMAILS;
    await expect(assertOperatorAllowed()).rejects.toMatchObject({
      code: "OPERATOR_NOT_CONFIGURED",
    });
  });

  it("allows an e-mail on the list, case-insensitively", async () => {
    process.env.ARARA_OPERATOR_EMAILS = "micael@ararahq.com";
    vi.spyOn(api, "apiRequest").mockResolvedValue({
      name: "Micael",
      email: "Micael@AraraHQ.com",
    });

    await expect(assertOperatorAllowed()).resolves.toBeUndefined();
  });

  it("refuses an e-mail off the list", async () => {
    process.env.ARARA_OPERATOR_EMAILS = "micael@ararahq.com";
    vi.spyOn(api, "apiRequest").mockResolvedValue({
      name: "Intruso",
      email: "intruso@example.com",
    });

    await expect(assertOperatorAllowed()).rejects.toMatchObject({
      code: "OPERATOR_NOT_ALLOWED",
    });
  });

  it("checks the identity on every call so concurrent accounts never share a verdict", async () => {
    process.env.ARARA_OPERATOR_EMAILS = "micael@ararahq.com";
    const spy = vi
      .spyOn(api, "apiRequest")
      .mockResolvedValueOnce({ name: "Micael", email: "micael@ararahq.com" })
      .mockResolvedValueOnce({ name: "Intruso", email: "intruso@example.com" });

    await expect(assertOperatorAllowed()).resolves.toBeUndefined();
    await expect(assertOperatorAllowed()).rejects.toMatchObject({
      code: "OPERATOR_NOT_ALLOWED",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
