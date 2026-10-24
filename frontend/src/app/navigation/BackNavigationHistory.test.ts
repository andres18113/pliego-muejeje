import { describe, expect, it } from "vitest";
import { BackNavigationHistory, backFallback, safeBackHref } from "./BackNavigationHistory";

const visit = (key: string, href: string, purchased = false) => ({ key, href, purchased });
it.each(["/checkout", "/checkout/", "/checkout///"])("returns to unconfirmed checkout variant %s until purchase retires it", path => {
  const h = new BackNavigationHistory();
  h.observe(visit("a", "/catalog?que=Origen&page=2#resultados"), "POP", "CUSTOMER:1");
  h.observe(visit("b", `${path}?method=TRANSFER#payment`), "PUSH", "CUSTOMER:1");
  h.observe(visit("c", "/ayuda"), "PUSH", "CUSTOMER:1");
  expect(h.isRetired("b")).toBe(false);
  expect(h.previous("CUSTOMER:1")).toEqual({ href: `${path}?method=TRANSFER#payment`, delta: -1 });
  h.observe(visit("d", "/checkout"), "PUSH", "CUSTOMER:1");
  h.observe(visit("e", "/orders/12///?view=receipt", true), "REPLACE", "CUSTOMER:1");
  expect(h.isRetired("b")).toBe(true);
  expect(h.isRetired("d")).toBe(true);
  expect(h.previous("CUSTOMER:1")).toEqual({ href: "/ayuda", delta: -1 });
  h.observe(visit("c", "/ayuda"), "POP", "CUSTOMER:1");
  expect(h.previous("CUSTOMER:1")).toEqual({ href: "/catalog?que=Origen&page=2#resultados", delta: -2 });
});
it("groups slash variants of one screen while preserving the original return query and hash", () => {
  const h = new BackNavigationHistory();
  h.observe(visit("a", "/ofertas/?page=2#resultados"), "POP", "guest");
  h.observe(visit("b", "/catalog/?que=uno"), "PUSH", "guest");
  h.observe(visit("c", "/catalog?que=dos"), "PUSH", "guest");
  expect(h.previous("guest")).toEqual({ href: "/ofertas/?page=2#resultados", delta: -2 });
});
describe("internal return history", () => {
  it("groups catalog filters and preserves the previous screen query", () => {
    const h = new BackNavigationHistory();
    h.observe(visit("a", "/ofertas?page=2"), "POP", "guest");
    h.observe(visit("b", "/catalog?que=uno"), "PUSH", "guest");
    h.observe(visit("c", "/catalog?que=dos&page=2"), "PUSH", "guest");
    expect(h.previous("guest")).toEqual({ href: "/ofertas?page=2", delta: -2 });
  });
  it("handles A-B-A by entry identity and prunes forward entries after POP", () => {
    const h = new BackNavigationHistory();
    h.observe(visit("a", "/catalog?page=2"), "POP", "guest");
    h.observe(visit("b", "/ofertas"), "PUSH", "guest");
    h.observe(visit("c", "/catalog?page=2"), "PUSH", "guest");
    expect(h.previous("guest")?.href).toBe("/ofertas");
    h.observe(visit("b", "/ofertas"), "POP", "guest");
    h.observe(visit("d", "/ayuda"), "PUSH", "guest");
    expect(h.previous("guest")).toEqual({ href: "/ofertas", delta: -1 });
  });
  it("forgets all predecessors when session authority changes", () => {
    const h = new BackNavigationHistory();
    h.observe(visit("a", "/account"), "POP", "CUSTOMER:1");
    h.observe(visit("b", "/orders"), "PUSH", "CUSTOMER:1");
    h.observe(visit("c", "/catalog"), "PUSH", "CUSTOMER:2");
    expect(h.previous("CUSTOMER:2")).toBeNull();
    expect(h.previous("CUSTOMER:1")).toBeNull();
  });
  it("retires every checkout after confirmation including older physical entries", () => {
    const h = new BackNavigationHistory();
    h.observe(visit("a", "/cart"), "POP", "CUSTOMER:1");
    h.observe(visit("b", "/checkout"), "PUSH", "CUSTOMER:1");
    h.observe(visit("c", "/cart"), "PUSH", "CUSTOMER:1");
    h.observe(visit("d", "/checkout"), "PUSH", "CUSTOMER:1");
    h.observe(visit("e", "/orders/12", true), "REPLACE", "CUSTOMER:1");
    h.observe(visit("b", "/checkout"), "POP", "CUSTOMER:1");
    expect(h.isRetired("b")).toBe(true);
    expect(h.previous("CUSTOMER:1")?.href).toBe("/cart");
  });
  it("does not save consumed auth or secret query parameters", () => {
    const h = new BackNavigationHistory();
    h.observe(visit("a", "/catalog"), "POP", "guest");
    h.observe(visit("b", "/reset-password?token=secret"), "PUSH", "guest");
    h.observe(visit("c", "/ayuda"), "PUSH", "guest");
    expect(h.previous("guest")).toEqual({ href: "/catalog", delta: -2 });
    expect(JSON.stringify(h)).not.toContain("secret");
  });
  it.each(["https://outside.test", "//outside.test", "/\\outside", "/catalog?token=secret", "/sign-in", "/unknown"])("rejects unsafe predecessor %s", href => {
    expect(safeBackHref(href, "CUSTOMER")).toBeNull();
  });
  it.each([
    ["/checkout", "CUSTOMER", "/cart"], ["/cart", "CUSTOMER", "/catalog"],
    ["/orders/12", "CUSTOMER", "/orders"], ["/account/addresses/2", "CUSTOMER", "/account/addresses"],
    ["/catalog/editions/12", null, "/catalog"], ["/ayuda/envios", null, "/ayuda"],
    ["/admin/orders", "ADMIN", "/admin"], ["/orders/12", null, "/"],
  ])("uses hierarchical fallback for %s", (href, role, expected) => {
    expect(backFallback(href, role)).toBe(expected);
  });
});
it("does not retain a sensitive nested return parameter", () => {
  expect(safeBackHref("/catalog?from=%2Frestablecer-contrasena%3Ftoken%3Dsynthetic", null)).toBeNull();
});
it("hides fallback at the admin root", () => {
  expect(backFallback("/admin", "ADMIN")).toBe("/admin");
});
it("retains only the consumed auth entry key across session establishment", () => {
  const h = new BackNavigationHistory();
  h.observe(visit("a", "/catalog"), "POP", "guest");
  h.observe(visit("b", "/sign-in?from=%2Fcart"), "PUSH", "guest");
  h.observe(visit("c", "/cart"), "REPLACE", "CUSTOMER:1:1");
  h.observe(visit("b", "/sign-in?from=%2Fcart"), "POP", "CUSTOMER:1:1");
  expect(h.isRetired("b")).toBe(true);
});
it("retires the whole email-action journey when it completes", () => {
  const h = new BackNavigationHistory();
  h.observe(visit("a", "/sign-in"), "POP", "guest");
  h.observe(visit("b", "/recuperar-contrasena"), "PUSH", "guest");
  h.observe(visit("c", "/restablecer-contrasena?token=synthetic"), "PUSH", "guest");
  h.observe(visit("d", "/catalog"), "PUSH", "guest");
  expect(h.isRetired("a")).toBe(true);
  expect(h.isRetired("b")).toBe(true);
  expect(h.isRetired("c")).toBe(true);
});

it("keeps the active auth key alive across authority change until redirect completes", () => {
  const h = new BackNavigationHistory();
  h.observe(visit("a", "/register?from=%2Fcart"), "POP", "guest:0");
  h.observe(visit("b", "/sign-in?from=%2Fcart"), "PUSH", "guest:0");
  h.observe(visit("b", "/sign-in?from=%2Fcart"), "PUSH", "CUSTOMER:1:1");
  expect(h.isRetired("b")).toBe(false);
  expect(h.isRetired("a")).toBe(true);
  h.observe(visit("c", "/cart"), "REPLACE", "CUSTOMER:1:1");
  expect(h.isRetired("b")).toBe(true);
  h.observe(visit("b", "/sign-in?from=%2Fcart"), "POP", "CUSTOMER:1:1");
  expect(h.isRetired("b")).toBe(true);
});
