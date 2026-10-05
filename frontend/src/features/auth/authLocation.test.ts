import { describe, expect, it } from "vitest";
import { safeAuthReturnHref } from "./authLocation";

describe("safeAuthReturnHref", () => {
  it("preserves the customer order history intent after sign-in", () => {
    expect(safeAuthReturnHref("/orders")).toBe("/orders");
    expect(safeAuthReturnHref("/account")).toBe("/account");
  });
});

it.each(["/account/addresses", "/account/addresses?view=all#primary", "/orders?page=2", "/favorites?page=1"])("retains valid customer destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe(href);
});
it.each(["//evil.test/account", "/account/unknown", "/account/../admin", "/account\\addresses", "https://evil.test/account", "/sign-in"])("rejects unsafe or unsupported destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe("/catalog");
});
