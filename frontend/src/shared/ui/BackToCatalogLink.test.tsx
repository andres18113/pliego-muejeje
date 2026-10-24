import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it } from "vitest";
import { BackToCatalogLink } from "./BackToCatalogLink";

it.each([
  ["/catalog?que=Cien&productType=EBOOK&page=2#resultados", "Volver al catálogo"],
  ["/ofertas?productType=EBOOK", "Volver a Ofertas"],
  ["/catalog/editions/250?from=%2Fofertas", "Volver a la edición"],
  ["/favorites", "Volver a Favoritos"],
  ["/", "Volver al inicio"],
  ["/cart?source=edition#items", "Volver al carrito"],
  ["/checkout?method=TRANSFER#payment", "Volver a finalizar la compra"],
  ["/account/", "Volver a mi cuenta"],
  ["/account/addresses?view=all#primary", "Volver a mis direcciones"],
  ["/orders?page=2", "Volver a mis pedidos"],
  ["/orders/123/", "Volver al pedido"],
  ["/biblioteca?productType=EBOOK&page=1", "Volver a mi biblioteca"],
  ["/biblioteca/123", "Volver a la edición de mi biblioteca"],
])("describes and follows the contextual destination %s", async (to, label) => {
  const router = createMemoryRouter([
    { path: "/sign-in", element: <BackToCatalogLink to={to} /> },
    { path: "*", element: <h1>Destino</h1> },
  ], { initialEntries: ["/sign-in"] });
  render(<RouterProvider router={router} />);
  const link = screen.getByRole("link", { name: label });
  expect(link).toHaveAttribute("href", to);
  fireEvent.click(link);
  await screen.findByRole("heading", { name: "Destino" });
  expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).toBe(to);
});

it("uses replace fallback rather than unknown browser history", async () => {
  const router = createMemoryRouter([
    { path: "/current", element: <BackToCatalogLink to="/catalog?que=Origen" historyBack /> },
    { path: "*", element: <h1>Destino</h1> },
  ], { initialEntries: ["/untrusted", "/current"] });
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("link", { name: "Volver al catálogo" }));
  await screen.findByRole("heading", { name: "Destino" });
  expect(router.state.location.pathname + router.state.location.search).toBe("/catalog?que=Origen");
  expect(router.state.historyAction).toBe("REPLACE");
});
