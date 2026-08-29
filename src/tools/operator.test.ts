import { describe, expect, it } from "vitest";
import { filterTemplates, safeApiKeySchema } from "./operator.js";

const template = (name: string, providerStatus: string, category: string) => ({
  id: "id",
  name,
  category,
  language: "pt_BR",
  providerStatus,
  availableForSending: providerStatus === "APPROVED",
});

describe("filterTemplates", () => {
  const templates = [
    template("clt_fgts_ronaldo", "PAUSED", "UTILITY"),
    template("boas_vindas", "APPROVED", "UTILITY"),
    template("promo_julho", "REJECTED", "MARKETING"),
  ];

  it("returns everything without a filter", () => {
    expect(filterTemplates(templates, undefined)).toHaveLength(3);
  });

  it("matches by name, status and category, case-insensitively", () => {
    expect(filterTemplates(templates, "fgts")).toHaveLength(1);
    expect(filterTemplates(templates, "paused")).toHaveLength(1);
    expect(filterTemplates(templates, "marketing")).toHaveLength(1);
    expect(filterTemplates(templates, "UTILITY")).toHaveLength(2);
  });
});

describe("safeApiKeySchema", () => {
  it("strips any field that could carry key material", () => {
    const parsed = safeApiKeySchema.parse({
      id: "k1",
      name: "site",
      prefix: "ara_live_",
      last4: "9x2f",
      key: "ara_live_FULL_SECRET_VALUE",
      hashedKey: "deadbeef",
    });
    expect(parsed).toEqual({ id: "k1", name: "site", prefix: "ara_live_", last4: "9x2f" });
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
  });
});
