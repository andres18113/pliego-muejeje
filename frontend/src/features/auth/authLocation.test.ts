import { describe, expect, it } from "vitest";
import { safeAuthReturnHref } from "./authLocation";

describe("safeAuthReturnHref", () => {
  it("preserves the customer order history intent after sign-in", () => {
    expect(safeAuthReturnHref("/orders")).toBe("/orders");
    expect(safeAuthReturnHref("/account")).toBe("/account");
  });
});
