import { describe, expect, it } from "vitest";
import { numbersSchema, pagedInboxSchema, templatesSchema } from "./schemas.js";

describe("API contracts", () => {
  it("accepts the real numbers envelope", () => {
    expect(numbersSchema.safeParse({ numbers: [{ id: "n1" }], slot: null }).success).toBe(true);
  });

  it("filters against provider template fields", () => {
    const parsed = templatesSchema.parse([
      {
        id: "t1",
        name: "hello",
        category: "UTILITY",
        language: "pt_BR",
        providerStatus: "APPROVED",
        availableForSending: true,
      },
    ]);
    expect(parsed[0]?.availableForSending).toBe(true);
  });

  it("rejects inbox responses without stable pagination", () => {
    expect(pagedInboxSchema.safeParse({ data: [] }).success).toBe(false);
  });

  it("normalizes the backend inbox page into the MCP pagination contract", () => {
    const parsed = pagedInboxSchema.parse({
      content: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      waiting: 0,
      attention: 0,
      unassigned: 0,
    });
    expect(parsed).toMatchObject({
      data: [],
      pagination: { page: 0, size: 50 },
      summary: { waiting: 0 },
    });
  });
});
