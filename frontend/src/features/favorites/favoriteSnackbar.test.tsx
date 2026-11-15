import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissFavoriteSnackbar, FavoriteSnackbar, showFavoriteSnackbar } from "./favoriteSnackbar";

function Shell() {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate("/ofertas")}>Ir a ofertas</button>
    <FavoriteSnackbar />
  </>;
}
function renderAt(path = "/catalog") {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/favorites" element={<p>Página de favoritos</p>} />
    <Route path="*" element={<Shell />} />
  </Routes></MemoryRouter>);
}
const toast = () => document.querySelector("[data-undo-toast]");

describe("FavoriteSnackbar", () => {
  afterEach(() => act(() => dismissFavoriteSnackbar()));

  it("tells a save politely, with the title for assistive technology, and offers the Favoritos page", async () => {
    renderAt();
    act(() => showFavoriteSnackbar({ owner: Symbol("card"), favorite: true, title: "Rayuela", undo: vi.fn() }));
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("Agregado a favoritos: Rayuela");
    await userEvent.setup().click(screen.getByRole("button", { name: "Ver favoritos" }));
    expect(screen.getByText("Página de favoritos")).toBeInTheDocument();
  });

  it("offers to undo a removal and shows the work while it runs", async () => {
    renderAt();
    const undo = vi.fn();
    act(() => showFavoriteSnackbar({ owner: Symbol("card"), favorite: false, title: "Rayuela", undo }));
    expect(toast()).toHaveTextContent("Quitado de favoritos");
    await userEvent.setup().click(screen.getByRole("button", { name: "Deshacer" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Guardando…" })).toHaveAttribute("aria-busy", "true");
  });

  it("leaves when the page changes, when its card leaves, and with its close button", async () => {
    renderAt();
    const user = userEvent.setup();
    const owner = Symbol("card");
    act(() => showFavoriteSnackbar({ owner, favorite: true, title: "Rayuela", undo: vi.fn() }));
    await user.click(screen.getByRole("button", { name: "Ir a ofertas" }));
    expect(toast()).toBeNull();

    act(() => showFavoriteSnackbar({ owner, favorite: true, title: "Rayuela", undo: vi.fn() }));
    act(() => dismissFavoriteSnackbar(Symbol("other card")));
    expect(toast()).not.toBeNull();
    act(() => dismissFavoriteSnackbar(owner));
    expect(toast()).toBeNull();

    act(() => showFavoriteSnackbar({ owner, favorite: false, title: "Rayuela", undo: vi.fn() }));
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(toast()).toBeNull();
  });
});
