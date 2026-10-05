import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { useCartControl } from "./useBookCardActions";

afterEach(() => vi.unstubAllGlobals());

it.each(["EBOOK", "AUDIOBOOK"])("cards do not send a second unit of %s already in cart", async (format) => {
  const post = vi.fn(() => json({ cartItemId: "13", quantity: 2 }));
  const feedback = vi.fn();
  stubApi({ "GET /api/v1/cart": () => json({ items: [{ editionId: "42", quantity: 1 }] }), "POST /api/v1/cart/items": post });
  function Probe() {
    const control = useCartControl({ editionId: "42", available: true, format, returnHref: "/probe", onFeedback: feedback });
    return <button onClick={"onPress" in control ? control.onPress : undefined}>Agregar</button>;
  }
  renderPurchaseRoute([{ path: "/probe", element: <Probe /> }], "/probe");
  await userEvent.setup().click(await screen.findByRole("button", { name: "Agregar" }));
  await waitFor(() => expect(feedback).toHaveBeenCalled());
  expect(post).not.toHaveBeenCalled();
});
