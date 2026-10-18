import { useState } from "react";
import { act, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSession } from "@/app/session";
import { renderPurchaseRoute } from "@/test/purchase";
import { CartAddedNotification, useCartAddedNotification } from "./CartAddedNotification";
afterEach(() => vi.useRealTimers());
function Probe() {
 const notice = useCartAddedNotification();
 return <><button onClick={() => notice.show({ quantity: 3, addedQuantity: 1 })}>Agregar</button><CartAddedNotification addition={notice.addition} onDismiss={notice.dismiss} /></>;
}
it("dismisses after five seconds and pauses while the action has focus", () => {
 vi.useFakeTimers(); renderPurchaseRoute([{ path: "/probe", element: <Probe /> }], "/probe", { role: null });
 const add = screen.getByRole("button", { name: "Agregar" });
 act(() => add.click()); expect(screen.getByText("¡Agregado al carrito!")).toBeInTheDocument();
 act(() => vi.advanceTimersByTime(4999)); expect(screen.getByText("¡Agregado al carrito!")).toBeInTheDocument();
 act(() => vi.advanceTimersByTime(1)); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
 act(() => { add.focus(); add.click(); });
 act(() => screen.getByRole("link", { name: "Ver carrito" }).focus());
 act(() => vi.advanceTimersByTime(10000)); expect(screen.getByText("¡Agregado al carrito!")).toBeInTheDocument();
 act(() => add.focus()); act(() => vi.advanceTimersByTime(5000)); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
});
it("manual dismissal returns keyboard focus to the invoking control", () => {
 renderPurchaseRoute([{ path: "/probe", element: <Probe /> }], "/probe", { role: null });
 const add = screen.getByRole("button", { name: "Agregar" }); act(() => { add.focus(); add.click(); });
 const close = screen.getByRole("button", { name: "Cerrar aviso de carrito" }); act(() => { close.focus(); close.click(); });
 expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument(); expect(add).toHaveFocus();
});

it("does not retain another actor's notification after the session changes", () => {
 function ScopedProbe() {
  const notice = useCartAddedNotification(); const { establish } = useSession();
  return <><button onClick={() => notice.show({ quantity: 3, addedQuantity: 1 })}>Agregar</button>
   <button onClick={() => establish({ accessToken: "another-test-token", expiresAt: Date.now() + 1800000, user: { userId: "3", email: "otra@example.invalid", role: "CUSTOMER" } })}>Cambiar cuenta</button>
   <CartAddedNotification addition={notice.addition} onDismiss={notice.dismiss} /></>;
 }
 renderPurchaseRoute([{ path: "/probe", element: <ScopedProbe /> }], "/probe");
 act(() => screen.getByRole("button", { name: "Agregar" }).click()); expect(screen.getByText("¡Agregado al carrito!")).toBeInTheDocument();
 act(() => screen.getByRole("button", { name: "Cambiar cuenta" }).click()); expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
});
it("a newer confirmed result replaces the notice without destroying its focused action", () => {
 renderPurchaseRoute([{ path: "/probe", element: <Probe /> }], "/probe", { role: null });
 const add = screen.getByRole("button", { name: "Agregar" }); act(() => { add.focus(); add.click(); });
 const action = screen.getByRole("link", { name: "Ver carrito" }); act(() => action.focus());
 act(() => add.click()); expect(action).toHaveFocus(); expect(screen.getAllByText("¡Agregado al carrito!")).toHaveLength(1);
});

it("dismissal falls back to the current collection heading when the invoking row disappeared", () => {
 function DisconnectedProbe() {
  const notice = useCartAddedNotification(); const [present, setPresent] = useState(true);
  return <><h2 id="collection-heading" tabIndex={-1}>Colección actual</h2>
   {present && <button onClick={() => notice.show({ quantity: 3, addedQuantity: 1 })}>Agregar</button>}
   <button onClick={() => setPresent(false)}>Cambiar página</button>
   <CartAddedNotification addition={notice.addition} onDismiss={notice.dismiss} fallbackFocus={() => document.getElementById("collection-heading")} /></>;
 }
 renderPurchaseRoute([{ path: "/probe", element: <DisconnectedProbe /> }], "/probe", { role: null });
 const add = screen.getByRole("button", { name: "Agregar" }); act(() => { add.focus(); add.click(); });
 act(() => screen.getByRole("button", { name: "Cambiar página" }).click());
 const close = screen.getByRole("button", { name: "Cerrar aviso de carrito" }); act(() => { close.focus(); close.click(); });
 expect(screen.getByRole("heading", { name: "Colección actual" })).toHaveFocus();
});

it("Ver carrito on the current cart focuses and reveals its review content instead of the old add control", () => {
 function CartProbe() { const notice = useCartAddedNotification(); return <main id="contenido-principal" tabIndex={-1}><button onClick={() => notice.show({ quantity: 1, addedQuantity: 1 })}>Agregar</button><CartAddedNotification addition={notice.addition} onDismiss={notice.dismiss} /></main>; }
 renderPurchaseRoute([{ path: "/cart", element: <CartProbe /> }], "/cart", { role: null });
 const main = document.getElementById("contenido-principal")!; const scroll = vi.fn(); main.scrollIntoView = scroll;
 const add = screen.getByRole("button", { name: "Agregar" }); act(() => { add.focus(); add.click(); });
 const action = screen.getByRole("link", { name: "Ver carrito" }); act(() => { action.focus(); action.click(); });
 expect(main).toHaveFocus(); expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
 expect(screen.queryByText("¡Agregado al carrito!")).not.toBeInTheDocument();
});
