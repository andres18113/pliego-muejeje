import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { BookCard } from "./BookCard";
import { toBookCardData } from "./bookCardModel";

const edition = { editionId: "9223372036854775807", title: "Ecuaciones diferenciales y problemas con valores en la frontera", authors: "William E. Boyce, Richard C. DiPrima", publisher: "Limusa Wiley", format: "PAPERBACK" as const, language: "es", price: "999999999.99", available: true, coverUrl: null, coverLicense: null, coverAttribution: null };

function setup(options: Partial<Parameters<typeof BookCard>[0]> = {}) {
  const favorite = vi.fn(), cart = vi.fn(), navigate = vi.fn();
  const view = render(<PliegoThemeProvider><MemoryRouter><BookCard
    book={toBookCardData(edition)} to="/catalog/editions/9223372036854775807?from=%2Fcatalog"
    favorite={{ state: "ready", selected: false, onPress: favorite }} cart={{ state: "ready", onPress: cart }}
    onNavigate={navigate} {...options} /></MemoryRouter></PliegoThemeProvider>);
  return { ...view, favorite, cart, navigate };
}

describe("BookCard controlled contract", () => {
  it("has one native navigation link with complete edition identity and description", () => {
    setup();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Ver detalle")).not.toBeInTheDocument();
    expect(screen.queryByText(edition.publisher)).not.toBeInTheDocument();
    expect(screen.queryByText("Rústica · Español")).not.toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeVisible();
    expect(screen.getByRole("heading")).toHaveAttribute("data-line-clamp", "true");
    expect(screen.getByRole("link")).toHaveAccessibleName(`Ver edición: ${edition.title}. Limusa Wiley, Rústica · Español`);
    expect(screen.getByRole("link")).toHaveAccessibleDescription(/William E\. Boyce, Richard C\. DiPrima.*999\.999\.999,99.*Disponible/);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(edition.title);
    expect(screen.getByText(edition.authors)).toHaveAttribute("data-line-clamp", "true");
  });

  it("keeps actions outside the link and forwards modified native navigation without intercepting it", () => {
    const view = setup();
    expect(screen.getByRole("link").querySelector("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Agregar a favoritos: ${edition.title}` }));
    expect(view.favorite).toHaveBeenCalledOnce(); expect(view.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Agregar al carrito: ${edition.title}` }));
    expect(view.cart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(view.navigate.mock.calls[0][0].ctrlKey).toBe(true);
  });

  it("lets the unavailable backend boolean disable purchase while preserving navigation and favorite", () => {
    setup({ book: toBookCardData({ ...edition, available: false }) });
    const purchase = screen.getByRole("button", { name: `Agregar al carrito: ${edition.title}` });
    expect(purchase).toBeDisabled();
    expect(purchase).toHaveAccessibleDescription(/No disponible/);
    expect(purchase).toHaveTextContent("shopping_cart_offAgregar");
    expect(screen.getByRole("button", { name: `Agregar a favoritos: ${edition.title}` })).toBeEnabled();
    expect(screen.getByRole("link")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("link")).toHaveAccessibleDescription(/No disponible/);
    expect(screen.getAllByText("No disponible")).toHaveLength(1);
  });

  it.each([
    { state: "ready" as const, icon: "add_shopping_cart", text: "Agregar", label: "Agregar al carrito" },
    { state: "pending" as const, icon: "schedule", text: "Agregando…", label: "Agregando…" },
    { state: "success" as const, icon: "check", text: "Agregado", label: "Agregado al carrito. Agregar otra unidad" },
  ])("renders the actual cart state $state with a symbol and text", ({ state, icon, text, label }) => {
    const press = vi.fn();
    setup({ cart: state === "pending" ? { state } : { state, onPress: press } });
    const button = screen.getByRole("button", { name: `${label}: ${edition.title}` });
    expect(button).toHaveTextContent(`${icon}${text}`);
    expect(button.querySelector('.material-symbol')).toHaveAttribute("aria-hidden", "true");
    if (state === "pending") { expect(button).toBeDisabled(); expect(button).toHaveAttribute("aria-busy", "true"); }
    else { fireEvent.click(button); expect(press).toHaveBeenCalledOnce(); }
  });

  it("disables only the pending action and does not announce unconfirmed favorite membership", () => {
    setup({ favorite: { state: "pending", selected: true } });
    expect(screen.getByRole("button", { name: `Guardando favorito…: ${edition.title}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Agregar al carrito: ${edition.title}` })).toBeEnabled();
  });

  it("does not fabricate a pressed value for an unconfirmed favorite", () => {
    setup({ favorite: { state: "unconfirmed", reason: "Favoritos sin confirmar." } });
    const favorite = screen.getByRole("button", { name: `Favoritos sin confirmar: ${edition.title}` });
    expect(favorite).toBeDisabled(); expect(favorite).not.toHaveAttribute("aria-pressed");
  });

  it("retains an uncertain cart recovery route and a visible error outside the cover", () => {
    setup({ cart: { state: "uncertain", recoveryTo: "/cart" }, feedback: { kind: "error", message: "No pudimos confirmar el carrito." } });
    expect(screen.getByRole("link", { name: "Consultar carrito" })).toHaveAttribute("href", "/cart");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar el carrito.");
  });

  it("leaves credits to the detail while retaining the cover data and deeper heading semantics", () => {
    setup({ book: { ...toBookCardData(edition), cover: { url: null, attribution: "Crédito técnico completo de la edición", license: "Licencia de prueba" } }, headingOrder: 4 });
    expect(screen.getByRole("heading", { level: 4 })).toHaveTextContent(edition.title);
    expect(screen.queryByText(/Crédito técnico completo de la edición/)).not.toBeInTheDocument();
  });
});
