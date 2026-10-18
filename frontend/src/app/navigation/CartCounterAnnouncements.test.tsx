import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { HeaderCart } from "./HeaderAccount";
import { PurchaseHeader } from "./PurchaseHeader";
afterEach(() => vi.unstubAllGlobals());
it.each(["/favorites", "/cart", "/catalog"])("the cart counter on %s remains readable without duplicating the saved-list notification", async path => {
 let quantity = 2;
 stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity }])) });
 const { queryClient } = renderPurchaseRoute([{ path, element: <HeaderCart /> }], path);
 const link = await screen.findByRole("link", { name: "Carrito, 2 unidades" });
 expect(Boolean(link.querySelector('[aria-live="polite"]'))).toBe(path === "/catalog");
 quantity = 3; await queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
 await waitFor(() => expect(link).toHaveAccessibleName("Carrito, 3 unidades"));
 expect(screen.getByTestId("header-cart-count")).toHaveTextContent("3");
});
it.each(["/cart", "/checkout"])("the purchase header at %s keeps its count while only checkout announces it", async path => {
 stubApi({ "GET /api/v1/cart": () => json(cartBody([{ quantity: 2 }])) });
 const view = renderPurchaseRoute([{ path, element: <PurchaseHeader /> }], path);
 await screen.findByText("(2 artículos)");
 const title = view.container.querySelector("[data-purchase-header] p");
 if (path === "/checkout") expect(title).toHaveAttribute("aria-live", "polite");
 else expect(title).not.toHaveAttribute("aria-live");
});

it("does not announce a cached zero as current when the cart can no longer be read", async () => {
 let failed = false;
 stubApi({ "GET /api/v1/cart": () => failed ? problem(503, "Unavailable", "Servicio no disponible", "Inténtalo de nuevo.") : json(cartBody([])) });
 const { queryClient } = renderPurchaseRoute([{ path: "/favorites", element: <HeaderCart /> }], "/favorites");
 const link = await screen.findByRole("link", { name: "Carrito, 0 unidades" });
 failed = true; await queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
 await waitFor(() => expect(link).toHaveAccessibleName("Carrito, unidades no disponibles"));
});
