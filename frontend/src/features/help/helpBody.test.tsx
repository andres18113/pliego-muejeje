import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { HelpBody, parseHelpBody, parseInline } from "./helpBody";

const body = `Antes de empezar, ten tu cédula a mano.

## Cómo pagar
1. Agrega tus libros al [carrito](/cart).
2. Elige el método de pago.

## Qué necesitas
- Una cuenta verificada.
- Una dirección en [Direcciones](/account/addresses).

## Si algo sale mal
Escríbenos desde [Ayuda](https://example.com/phish) o revisa <script>alert('x')</script>.`;

it("reads sections, steps, lists and PLIEGO links from plain text", () => {
  expect(parseHelpBody(body).map(block => block.kind)).toEqual(["paragraph", "heading", "steps", "heading", "bullets", "heading", "paragraph"]);
  expect(parseHelpBody("Uno.\n\nDos.")).toEqual([
    { kind: "paragraph", inline: [{ kind: "text", text: "Uno." }] },
    { kind: "paragraph", inline: [{ kind: "text", text: "Dos." }] },
  ]);
  // Only an internal path is a link; an external or protocol-relative address stays text.
  expect(parseInline("[a](/orders) [b](https://x.test) [c](//x.test)")).toEqual([
    { kind: "link", text: "a", to: "/orders" },
    { kind: "text", text: " [b](https://x.test) [c](//x.test)" },
  ]);
});

it("renders the convention as headings, ordered steps and links, keeping markup-like text as text", async () => {
  render(<MemoryRouter><HelpBody body={body} /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 2, name: "Cómo pagar" })).toBeInTheDocument();
  const steps = screen.getAllByRole("list").find(list => list.tagName === "OL")!;
  expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "carrito" })).toHaveAttribute("href", "/cart");
  expect(screen.getByRole("link", { name: "Direcciones" })).toHaveAttribute("href", "/account/addresses");
  expect(screen.queryByRole("link", { name: "Ayuda" })).toBeNull();
  expect(screen.getByText(/<script>alert\('x'\)<\/script>/)).toBeInTheDocument();
  // A short article has no contents list.
  expect(screen.queryByRole("navigation")).toBeNull();
});

it("gives only a long article a contents list that moves focus to the chosen section", async () => {
  const sections = ["Uno", "Dos", "Tres", "Cuatro", "Cinco"].map(name => `## ${name}\n${"Una respuesta práctica y corta para esta pregunta. ".repeat(10)}`).join("\n\n");
  render(<MemoryRouter><HelpBody body={sections} /></MemoryRouter>);
  const contents = screen.getByRole("navigation", { name: "En este artículo" });
  await userEvent.setup().click(within(contents).getByRole("link", { name: "Cuatro" }));
  expect(screen.getByRole("heading", { level: 2, name: "Cuatro" })).toHaveFocus();
});
