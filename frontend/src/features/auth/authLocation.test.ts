import { describe, expect, it } from "vitest";
import { adminReturnHref, safeAuthReturnHref } from "./authLocation";

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
  expect(safeAuthReturnHref(href)).toBe("/");
});
it.each(["//evil.test/account", "/account/unknown", "/account/../admin", "/account\\addresses", "https://evil.test/account", "/sign-in"])("rejects unsafe or unsupported destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe("/");
});
it.each(["/orders/700/invoice", "/orders/700"])("returns the invoice email's reader to the order's document %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe(href);
});
it.each(["/orders/0/invoice", "/orders/700/invoice/extra", "/orders/invoice", "/biblioteca/123/invoice", "/orders/700/invoice/../../admin"])("rejects malformed invoice destination %s", (href) => {
  expect(safeAuthReturnHref(href)).toBe("/");
});

describe("admin sign-in return (ADR 0047)", () => {
  it.each([
    ["/admin", "/admin"], ["/admin/retiros", "/admin/retiros"], ["/admin/correcciones", "/admin/correcciones"],
    ["/admin/../account", "/admin"], ["/admin/retiros?x=1", "/admin"], ["//evil.example/admin", "/admin"], ["/orders", "/admin"], [null, "/admin"],
  ])("returns %s to %s", (candidate, expected) => {
    expect(adminReturnHref(candidate)).toBe(expected);
  });
});
