import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BackNavigationProvider } from "@/app/navigation/BackNavigationProvider";
import { cartBody, json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { storefrontNavigationFixture } from "@/test/storefrontFixture";
import { CartPreviewProvider } from "@/features/purchase/CartPreview";
import { EditionDetailPage } from "./EditionDetailPage";
import type { DigitalEligibility } from "@/shared/api/digitalEligibility";

const edition = { editionId: "42", bookId: "1", title: "Lectura digital", authors: [], publisher: { name: "Editorial" }, categories: [], sku: "D42", price: "18.50", format: "EBOOK", language: "es", available: true };
const eligible: DigitalEligibility = { editionId: "42", owned: false, ownedItemId: null, pendingOrder: false, pendingOrderId: null, inCart: false, purchasable: true };
const routes = [{ path: "/catalog/editions/:editionId", element: <BackNavigationProvider><CartPreviewProvider><EditionDetailPage /></CartPreviewProvider></BackNavigationProvider> }];
function api(state: () => DigitalEligibility, overrides = {}) {
  return stubApi({ "GET /api/v1/catalog/editions/42": () => json(edition), "GET /api/v1/storefront/navigation": () => json(storefrontNavigationFixture),
    "GET /api/v1/me/favorites/status": () => json([{ editionId: "42", favorite: false }]), "GET /api/v1/me/digital-eligibility": () => json([state()]),
    "GET /api/v1/cart": () => json(cartBody([])), ...overrides });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  [{ owned: true, ownedItemId: "800", pendingOrder: true, pendingOrderId: "900" }, "Ya está en tu biblioteca", "Ver en Mi biblioteca", "/biblioteca/800"],
  [{ pendingOrder: true, pendingOrderId: "900", inCart: true }, "Tienes un pedido abierto con esta edición", "Ver pedido", "/orders/900"],
  [{ inCart: true }, "Ya está en tu carrito", "Ver carrito", "/cart"],
] as const)("mirrors digital state %j in the scene and sticky action", async (state, message, label, href) => {
  api(() => ({ ...eligible, ...state }));
  renderPurchaseRoute(routes, "/catalog/editions/42");
  expect(await screen.findByText(message)).toBeInTheDocument();
  const scene = within(screen.getByRole("region", { name: "Compra" }));
  expect(scene.getByRole("link", { name: label })).toHaveAttribute("href", href);
  expect(scene.queryByRole("button", { name: "Agregar al carrito" })).not.toBeInTheDocument();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ bottom: -1 } as DOMRect);
  act(() => window.dispatchEvent(new Event("scroll")));
  const bar = within(await screen.findByRole("region", { name: "Resumen del libro" }));
  expect(bar.getByRole("link", { name: label })).toHaveAttribute("href", href);
  expect(bar.queryByRole("button", { name: /Agregar/ })).not.toBeInTheDocument();
});
it("rereads eligibility after add and on cart invalidation", async () => {
  let current = eligible;
  const transport = api(() => current, { "POST /api/v1/cart/items": () => { current = { ...eligible, inCart: true }; return json({ cartItemId: "100", quantity: 1 }); } });
  const { queryClient } = renderPurchaseRoute(routes, "/catalog/editions/42");
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito" }));
  await screen.findByText("Ya está en tu carrito");
  current = { ...eligible, pendingOrder: true, pendingOrderId: "900" };
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["customer-cart"] }); });
  await screen.findByText("Tienes un pedido abierto con esta edición");
  expect(transport.count("GET", "/api/v1/me/digital-eligibility")).toBeGreaterThanOrEqual(3);
});
it.each(["P6002", "P6003"])("explains add conflict %s without opening the drawer", async code => {
  api(() => eligible, { "POST /api/v1/cart/items": () => problem(409, code, "Conflicto", "Error genérico") });
  renderPurchaseRoute(routes, "/catalog/editions/42");
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar al carrito" }));
  await screen.findByText(code === "P6002" ? "Ya está en tu biblioteca" : "Tienes un pedido abierto con esta edición");
  expect(screen.queryByText(/Error genérico/)).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Tu carrito" })).not.toBeInTheDocument();
});
it("keeps the add button during a failed advisory read", async () => {
  api(() => eligible, { "GET /api/v1/me/digital-eligibility": () => problem(503, "DOWN", "No disponible", "Inténtalo otra vez") });
  renderPurchaseRoute(routes, "/catalog/editions/42");
  expect(await screen.findByRole("button", { name: "Agregar al carrito" })).toBeInTheDocument();
});
it.each([null, "ADMIN"] as const)("does not read customer eligibility for %s", async role => {
  const transport = api(() => ({ ...eligible, owned: true }));
  renderPurchaseRoute(routes, "/catalog/editions/42", { role });
  await screen.findByRole("heading", { name: "Lectura digital" });
  await waitFor(() => expect(transport.count("GET", "/api/v1/me/digital-eligibility")).toBe(0));
});

it.each(["page", "bar"])("keeps keyboard focus on the local destination when eligibility replaces the %s add", async source => {
  let current = eligible;
  api(() => current);
  const { queryClient } = renderPurchaseRoute(routes, "/catalog/editions/42");
  const scene = within(await screen.findByRole("region", { name: "Compra" }));
  if (source === "bar") {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ bottom: -1 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    await screen.findByRole("region", { name: "Resumen del libro" });
  }
  const surface = source === "bar" ? within(screen.getByRole("region", { name: "Resumen del libro" })) : scene;
  act(() => surface.getByRole("button", { name: "Agregar al carrito" }).focus());
  current = { ...eligible, owned: true, ownedItemId: "800", purchasable: false };
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["customer-cart"] }); });
  await waitFor(() => expect(surface.getByRole("link", { name: "Ver en Mi biblioteca" })).toHaveFocus());
});
