import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FavoriteButton } from "@/features/catalog/FavoriteButton";
import { favoriteStatusQueryKey } from "@/shared/api/favorites";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
afterEach(() => vi.unstubAllGlobals());
const key = favoriteStatusQueryKey("2", ["42"]);
function renderFavorite(selected: boolean) {
  return renderPurchaseRoute([{ path: "/catalog", element: <FavoriteButton editionId="42" title="Un libro" isFavorite={selected} ready queryKey={key} returnHref="/catalog" /> }], "/catalog");
}
it.each([true, false])("reconciles lost successful response with membership %s without repeating the mutation", async selected => {
  const method = selected ? "DELETE" : "PUT";
  const api = stubApi({ [`${method} /api/v1/me/favorites/42`]: () => { throw new TypeError("Lost response"); }, "GET /api/v1/me/favorites/status": () => json([{ editionId: "42", favorite: !selected }]) });
  const { queryClient } = renderFavorite(selected);
  queryClient.setQueryData(key, [{ editionId: "42", favorite: selected }]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `${selected ? "Quitar de" : "Agregar a"} favoritos: Un libro` }));
  expect(await screen.findByRole("status")).toHaveTextContent(selected ? "Quitado de favoritos." : "Agregado a favoritos.");
  expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", String(!selected));
  expect(queryClient.getQueryData(key)).toEqual([{ editionId: "42", favorite: !selected }]);
  expect(api.count(method, "/api/v1/me/favorites/42")).toBe(1);
  expect(api.count("GET", "/api/v1/me/favorites/status")).toBe(1);
});
it("keeps an unknown result unconfirmed and offers only a read to recover", async () => {
  const api = stubApi({ "DELETE /api/v1/me/favorites/42": () => { throw new TypeError("Lost response"); }, "GET /api/v1/me/favorites/status": [() => { throw new TypeError("Offline"); }, () => json([{ editionId: "42", favorite: false }])] });
  renderFavorite(true); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Quitar de favoritos: Un libro" }));
  const check = await screen.findByRole("button", { name: "Consultar favorito: Un libro" });
  expect(check).not.toHaveAttribute("aria-pressed");
  expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar tus favoritos.");
  await user.click(check);
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar a favoritos: Un libro" })).toHaveAttribute("aria-pressed", "false"));
  expect(api.count("DELETE", "/api/v1/me/favorites/42")).toBe(1);
  expect(api.count("GET", "/api/v1/me/favorites/status")).toBe(2);
});
it("uses an authoritative unchanged state after a server error", async () => {
  stubApi({ "DELETE /api/v1/me/favorites/42": () => problem(503, "UNAVAILABLE", "Servicio no disponible", "Sin confirmar"), "GET /api/v1/me/favorites/status": () => json([{ editionId: "42", favorite: true }]) });
  renderFavorite(true); await userEvent.setup().click(screen.getByRole("button", { name: "Quitar de favoritos: Un libro" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El libro sigue guardado en tus favoritos.");
  expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
});
