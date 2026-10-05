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
it.each(["/biblioteca", "/biblioteca?productType=EBOOK&page=1", "/biblioteca/123"])("preserves owned-library sign-in destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe(href);
});
it.each(["/biblioteca/invalid", "/biblioteca/0", "/biblioteca/../admin", "//evil.test/biblioteca"])("rejects invalid library destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe("/catalog");
});
it.each(["//evil.test/account", "/account/unknown", "/account/../admin", "/account\\addresses", "https://evil.test/account", "/sign-in"])("rejects unsafe or unsupported destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe("/catalog");
});
