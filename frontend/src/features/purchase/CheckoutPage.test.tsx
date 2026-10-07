import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartBody, json, problem, renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { CheckoutPage } from "./CheckoutPage";
import { useSession } from "@/app/session";
import * as cartApi from "@/shared/api/cart";
import { cartQueryKey } from "./cartQuery";

const routes = [
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "/orders/:orderId", element: <h1>Pedido abierto</h1> },
  { path: "/sign-in", element: <h1>Iniciar sesión</h1> },
];

const approved = { orderId: "700", orderState: "CONFIRMED", paymentState: "APPROVED", total: "18.50", paymentReference: "SIM-1" };

/** Opens the payment choice if a method is already settled, then picks one. Tarjeta opens the card dialog. */
async function choosePayment(user: ReturnType<typeof userEvent.setup>, method: "Tarjeta" | "Transferencia") {
  const change = screen.queryByRole("button", { name: "Cambiar método de pago" });
  if (change) await user.click(change);
  await user.click(screen.getByRole("button", { name: new RegExp(method) }));
  if (method === "Tarjeta") await screen.findByLabelText("Número de tarjeta");
}

async function fillCheckout(user: ReturnType<typeof userEvent.setup>, method: "Tarjeta" | "Transferencia", card?: string) {
  await screen.findByText(/Av\. Principal 123/);
  await choosePayment(user, method);
  if (card !== undefined) {
    await user.type(screen.getByLabelText("Número de tarjeta"), card);
    await user.type(screen.getByLabelText("Caducidad (MM/AA)"), "12/30");
    await user.type(screen.getByLabelText("Código de seguridad"), "123");
    await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
    await user.click(screen.getByRole("button", { name: "Usar esta tarjeta" }));
  }
}

describe("CheckoutPage", () => {
  it("discards A's delayed cart preflight instead of caching or submitting it after B signs in", async () => {
    let release: (response: Response) => void = () => {};
    let heldRead: Promise<cartApi.CartDetail> | undefined;
    let reads=0;
    const realRead=cartApi.getCartDetail;
    const spy=vi.spyOn(cartApi,"getCartDetail").mockImplementation(signal => {
      const pending=realRead(signal); if (++reads===2) heldRead=pending; return pending;
    });
    const cartA=cartBody(),cartB={...cartBody([{title:"Libro de Bea",cartItemId:"201"}]),cartId:"50"};
    let actor="2",aReads=0;
    const api=stubApi({
      "GET /api/v1/cart": request => request.headers.get("Authorization")==="Bearer beta-token" ? json(cartB)
        : ++aReads===1 ? json(cartA) : new Promise<Response>(done => { release=done; }),
      "GET /api/v1/me/addresses": request => json([{...savedAddress,addressId:request.headers.get("Authorization")==="Bearer beta-token" ? "16":"15"}]),
      "POST /api/v1/checkout":()=>json(approved,201),
    });
    function SwitchIdentity() {
      const {establish}=useSession();
      return <button onClick={()=>{actor="3";establish({accessToken:"beta-token",expiresAt:Date.now()+1_800_000,user:{userId:"3",email:"bea@example.com",role:"CUSTOMER"}});}}>Entrar como Bea</button>;
    }
    const user=userEvent.setup();
    const view=renderPurchaseRoute([{path:"/checkout",element:<><SwitchIdentity/><CheckoutPage/></>},routes[1]],"/checkout");
    const crossed: string[]=[];
    const unsubscribe=view.queryClient.getQueryCache().subscribe(event => {
      if(actor==="3" && event.type==="updated" && event.action.type==="success" && event.query.queryKey[0]===cartQueryKey[0]) crossed.push((event.query.state.data as cartApi.CartDetail).cartId!);
    });
    try {
      await fillCheckout(user,"Transferencia"); await user.click(screen.getByRole("button",{name:"Hacer pedido"}));
      await waitFor(()=>expect(heldRead).toBeDefined());
      await user.click(screen.getByRole("button",{name:"Entrar como Bea"}));
      await waitFor(()=>expect((view.queryClient.getQueryData(cartQueryKey) as cartApi.CartDetail)?.cartId).toBe("50"));
      await act(async()=>{release(json(cartA));await heldRead;});
      expect(crossed).not.toContain("40");
      expect(api.count("POST","/api/v1/checkout")).toBe(0);
      expect(view.router.state.location.pathname).toBe("/checkout");
    } finally {
      unsubscribe();spy.mockRestore();
      // Let the pre-fix diagnostic's already-dispatched continuation finish before test cleanup.
      await new Promise(done=>setTimeout(done,750));
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  it("validates each card field when it is left, keeps untouched fields quiet, and updates a touched field as it is corrected", async () => {
    const api = stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/); await choosePayment(user, "Tarjeta");
    const dialog = screen.getByRole("dialog", { name: "Tarjeta de crédito o débito" });
    const number = within(dialog).getByLabelText("Número de tarjeta");
    const expiry = within(dialog).getByLabelText("Caducidad (MM/AA)");
    const cvv = within(dialog).getByLabelText("Código de seguridad");
    const holder = within(dialog).getByLabelText("Nombre en la tarjeta");
    const errorOf = (input: HTMLElement) => input.getAttribute("aria-describedby")?.split(" ").map((id) => document.getElementById(id)?.textContent).filter((text) => text && !/dígitos (en|al)/.test(text)).join(" ") ?? "";

    expect([number, expiry, cvv, holder].map((input) => input.getAttribute("aria-invalid"))).toEqual([null, null, null, null]);

    await user.type(number, "4111111111111112"); await user.tab();
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(errorOf(number)).toBe("Este número de tarjeta no es válido. Revisa los dígitos.");
    expect(expiry).toHaveFocus();
    expect(expiry).not.toHaveAttribute("aria-invalid");

    await user.type(expiry, "1399"); await user.tab();
    expect(expiry).toHaveAttribute("aria-invalid", "true");
    expect(errorOf(expiry)).toBe("Escribe la fecha de caducidad en formato MM/AA.");

    await user.click(cvv); await user.type(cvv, "12"); await user.tab();
    expect(cvv).toHaveAttribute("aria-invalid", "true");
    expect(errorOf(cvv)).toBe("El código de seguridad debe tener 3 dígitos.");
    expect(holder).toHaveFocus();

    await user.tab();
    expect(holder).toHaveAttribute("aria-invalid", "true");
    expect(errorOf(holder)).toBe("Escribe el nombre del titular de la tarjeta.");
    expect(screen.getByRole("button", { name: "Usar esta tarjeta" })).toHaveFocus();

    // Touched fields update live as they are corrected.
    await user.clear(number); await user.type(number, "4111111111111111");
    await waitFor(() => expect(number).not.toHaveAttribute("aria-invalid"));
    await user.clear(expiry); await user.type(expiry, "1230");
    await waitFor(() => expect(expiry).not.toHaveAttribute("aria-invalid"));
    await user.type(cvv, "3");
    await waitFor(() => expect(cvv).not.toHaveAttribute("aria-invalid"));
    await user.type(holder, "Ana Pérez");
    await waitFor(() => expect(holder).not.toHaveAttribute("aria-invalid"));

    // Submit still validates everything: breaking one field again keeps the dialog open.
    await user.clear(holder);
    await user.click(screen.getByRole("button", { name: "Usar esta tarjeta" }));
    expect(screen.getByRole("dialog", { name: "Tarjeta de crédito o débito" })).toBeInTheDocument();
    expect(holder).toHaveAttribute("aria-invalid", "true");
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("does not flag an empty field that focus only passed through", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/); await choosePayment(user, "Tarjeta");
    const dialog = screen.getByRole("dialog", { name: "Tarjeta de crédito o débito" });
    await user.type(within(dialog).getByLabelText("Número de tarjeta"), "4111111111111111");
    await waitFor(() => expect(within(dialog).getByLabelText("Caducidad (MM/AA)")).toHaveFocus());
    await user.click(within(dialog).getByLabelText("Nombre en la tarjeta"));
    expect(within(dialog).getByLabelText("Caducidad (MM/AA)")).not.toHaveAttribute("aria-invalid");
    expect(within(dialog).getByLabelText("Número de tarjeta")).not.toHaveAttribute("aria-invalid");
  });

  it("opens concise CVV help with keyboard and returns focus without closing the card dialog", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/); await choosePayment(user, "Tarjeta");
    expect(screen.queryByText("3 dígitos al reverso de la tarjeta; 4 en el frente si es American Express.")).not.toBeInTheDocument();
    const help = screen.getByRole("button", { name: "Ayuda sobre el código de seguridad" });
    help.focus(); await user.keyboard("{Enter}");
    const panel = await screen.findByRole("dialog", { name: "Código de seguridad" });
    expect(within(panel).getByText("Busca los 3 dígitos en el reverso de tu tarjeta.")).toBeInTheDocument();
    expect((await within(panel).findByRole("img", { name: "Código de 3 dígitos al reverso de la tarjeta" })).tagName.toLowerCase()).toBe("svg");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Código de seguridad" })).not.toBeInTheDocument());
    expect(help).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Tarjeta de crédito o débito" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
  });

  it("uses the detected American Express brand for four-digit front-of-card help", async () => {
    stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/); await choosePayment(user, "Tarjeta");
    await user.type(screen.getByLabelText("Número de tarjeta"), "378282246310005");
    await user.click(screen.getByRole("button", { name: "Ayuda sobre el código de seguridad" }));
    const panel = await screen.findByRole("dialog", { name: "Código de seguridad" });
    expect(within(panel).getByText("Busca los 4 dígitos en el frente de tu tarjeta.")).toBeInTheDocument();
    expect(await within(panel).findByRole("img", { name: "Código de 4 dígitos en el frente de la tarjeta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código de seguridad", { selector: "input" })).toHaveAttribute("maxlength", "4");
    await user.click(within(panel).getByRole("button", { name: "Entendido" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ayuda sobre el código de seguridad" })).toHaveFocus());
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("3782 822463 10005");
  });

  it("disables placing an order until a card is confirmed or transfer is selected", async () => {
    const api = stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    const pay = screen.getByRole("button", { name: "Hacer pedido" });
    expect(pay).toBeDisabled();
    await choosePayment(user, "Tarjeta");
    expect(pay).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(pay).toBeDisabled();
    await fillCheckout(user, "Tarjeta", "4111111111111111");
    expect(pay).toBeEnabled();
    await choosePayment(user, "Transferencia");
    await screen.findByText("Banco Guayaquil");
    expect(pay).toBeEnabled();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("does not submit a valid card before the customer confirms using it", async () => {
    const api = stubApi({ "GET /api/v1/cart": () => json(cartBody()), "GET /api/v1/me/addresses": () => json([savedAddress]), "POST /api/v1/checkout": () => json(approved, 201) });
    const user = userEvent.setup(); renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/); await choosePayment(user, "Tarjeta");
    await user.type(screen.getByLabelText("Número de tarjeta"), "4111111111111111");
    await user.type(screen.getByLabelText("Caducidad (MM/AA)"), "12/30");
    await user.type(screen.getByLabelText("Código de seguridad"), "123");
    await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Pago" })); });
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
    expect(api.count("GET", "/api/v1/cart")).toBe(1);
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toBeDisabled();
  });

  it("shows only card brands supported by the current validator before entry", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);

    await choosePayment(user, "Tarjeta");

    expect(screen.getByRole("list", { name: "Tarjetas de prueba compatibles" })).toBeInTheDocument();
    for (const brand of ["Visa", "Mastercard", "American Express", "Diners Club"]) {
      expect(screen.getByRole("img", { name: brand })).toBeInTheDocument();
    }
    expect(screen.queryByRole("img", { name: /Discover|JCB/ })).not.toBeInTheDocument();
  });

  it("formats expiry digits as MM / AA and remains editable with the keyboard", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);
    await choosePayment(user, "Tarjeta");

    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.type(expiry, "1");
    expect(expiry).toHaveValue("1");
    await user.type(expiry, "a");
    expect(expiry).toHaveValue("1");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 /");
    await user.type(expiry, "2");
    expect(expiry).toHaveValue("10 / 2");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 / 20");
    await user.keyboard("{Backspace}");
    expect(expiry).toHaveValue("10 / 2");
    await user.type(expiry, "0");
    expect(expiry).toHaveValue("10 / 20");
    await user.type(expiry, "789");
    expect(expiry).toHaveValue("10 / 20");
    expect(expiry).toHaveAttribute("inputmode", "numeric");
  });

  it("advances through valid card fields and keeps focus on incomplete or invalid values", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Tarjeta");

    const number = screen.getByLabelText("Número de tarjeta");
    await user.type(number, "411111111111111");
    expect(number).toHaveFocus();
    await user.keyboard("1");
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await waitFor(() => expect(expiry).toHaveFocus());

    await user.type(expiry, "1328");
    expect(expiry).toHaveFocus();
    await user.clear(expiry);
    await user.type(expiry, "1228");
    const cvv = screen.getByLabelText("Código de seguridad");
    await waitFor(() => expect(cvv).toHaveFocus());

    await user.type(cvv, "12");
    expect(cvv).toHaveFocus();
    await user.keyboard("3");
    await waitFor(() => expect(screen.getByLabelText("Nombre en la tarjeta")).toHaveFocus());
  });

  it("keeps transaction feedback visible before navigating to the created order", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Transferencia");
    const submittedAt = Date.now();

    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByText("Creando tu pedido simulado…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    expect(Date.now() - submittedAt).toBeGreaterThanOrEqual(480);
  });

  it("rejects expiry months outside 01–12, identifies the field, and focuses it", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.clear(expiry);
    await user.type(expiry, "1328");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByText("Escribe la fecha de caducidad en formato MM/AA.")).toBeInTheDocument();
    expect(expiry).toHaveAttribute("aria-invalid", "true");
    expect(expiry).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("rejects an expired month and year before sending checkout", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await screen.findByText(/Av\. Principal 123/);
    await choosePayment(user, "Tarjeta");
    const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const expiredDigits = `${String(previousMonth.getMonth() + 1).padStart(2, "0")}${String(previousMonth.getFullYear() % 100).padStart(2, "0")}`;
    await user.type(screen.getByLabelText("Número de tarjeta"), "4111111111111111");
    const expiry = screen.getByLabelText("Caducidad (MM/AA)");
    await user.type(expiry, expiredDigits);
    await user.type(screen.getByLabelText("Código de seguridad"), "123");
    await user.type(screen.getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
    await user.click(screen.getByRole("button", { name: "Usar esta tarjeta" }));

    // The dialog keeps the card until it is valid: nothing reaches the page or the server.
    expect(await screen.findByText("La fecha de caducidad de la tarjeta ya venció.")).toBeInTheDocument();
    expect(expiry).toHaveFocus();
    expect(screen.queryByText(/^Visa-/)).not.toBeInTheDocument();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("shows the saved address compactly and switches to a focused selection to change it", async () => {
    const office = { ...savedAddress, addressId: "16", alias: "Oficina", line1: "Av. Amazonas 900", primary: false };
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress, office]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    const deliver = await screen.findByRole("tabpanel", { name: "Entrega" });
    expect(await within(deliver).findByText(/Av\. Principal 123/)).toBeInTheDocument();
    expect(within(deliver).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(deliver).queryByLabelText("Ciudad")).not.toBeInTheDocument();

    await user.click(within(deliver).getByRole("button", { name: "Cambiar dirección" }));
    expect(within(deliver).getAllByRole("radio")).toHaveLength(2);
    expect(within(deliver).getByRole("button", { name: "Añadir nueva dirección" })).toBeInTheDocument();
    expect(within(deliver).getByRole("link", { name: "Direcciones" })).toHaveAttribute("href", "/account/addresses");

    await user.click(within(deliver).getByRole("radio", { name: /Oficina/ }));
    expect(within(deliver).getByText(/Av\. Amazonas 900/)).toBeInTheDocument();
    expect(within(deliver).queryByRole("radio")).not.toBeInTheDocument();
    await waitFor(() => expect(within(deliver).getByRole("button", { name: "Cambiar dirección" })).toHaveFocus());
  });

  it("states the delivery window the cart API reports and nothing when it reports none", async () => {
    stubApi({
      "GET /api/v1/cart": [
        () => json({ ...cartBody(), estimatedDeliveryFrom: "2026-12-31", estimatedDeliveryTo: "2027-01-02" }),
        () => json(cartBody()),
      ],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const view = renderPurchaseRoute(routes, "/checkout");
    const deliver = await screen.findByRole("tabpanel", { name: "Entrega" });
    expect(await within(deliver).findByText("Entrega 31 Dic 2026 - 2 Ene 2027")).toBeInTheDocument();
    expect(within(deliver).getByRole("list", { name: "Libros de esta entrega" })).toHaveTextContent("Cien años de soledad");
    view.unmount();

    renderPurchaseRoute(routes, "/checkout");
    const again = await screen.findByRole("tabpanel", { name: "Entrega" });
    await within(again).findByText("Entrega a domicilio");
    expect(within(again).queryByText(/^Entrega \d/)).not.toBeInTheDocument();
  });

  it("keeps the card out of the page: it is entered in a dialog, summarised by its last digits and asked again after an attempt", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => problem(409, "P5007", "Referencia en uso", "Intenta otra vez."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await screen.findByText(/Av\. Principal 123/);

    await choosePayment(user, "Tarjeta");
    const dialog = screen.getByRole("dialog", { name: "Tarjeta de crédito o débito" });
    expect(within(dialog).getByLabelText("Código de seguridad")).toHaveAccessibleDescription(/3 dígitos al reverso/);
    await user.click(within(dialog).getByRole("button", { name: "Usar esta tarjeta" }));
    expect(await within(dialog).findByText("Escribe el número de tu tarjeta.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Número de tarjeta")).toHaveFocus();

    await user.type(within(dialog).getByLabelText("Número de tarjeta"), "4111111111111111");
    await user.type(within(dialog).getByLabelText("Caducidad (MM/AA)"), "12/30");
    await user.type(within(dialog).getByLabelText("Código de seguridad"), "123");
    await user.type(within(dialog).getByLabelText("Nombre en la tarjeta"), "Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Usar esta tarjeta" }));

    expect(await screen.findByText("Visa-1111")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar método de pago" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    expect(await screen.findByRole("heading", { name: "No se creó el pedido." })).toBeInTheDocument();
    expect(await screen.findByText(/No conservamos los datos de la tarjeta entre intentos/)).toBeInTheDocument();
    expect(screen.queryByText("Visa-1111")).not.toBeInTheDocument();
  });

  it("opens the shared address editor, with its searchable country picker, when no address is saved", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    // Without a saved address, "Entregar en" offers the shared editor straight away.
    await user.click(await screen.findByRole("button", { name: "Añadir dirección" }));
    await screen.findByRole("dialog", { name: "Nueva dirección" });
    const country = await screen.findByRole("combobox", { name: "País de entrega" });
    await user.click(country);
    const search = await screen.findByRole("combobox", { name: "Buscar país de entrega" });
    await user.type(search, "Colom");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(country).toHaveTextContent("Colombia");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Buscar país de entrega" })).not.toBeInTheDocument());
  });

  it("sends one CARD checkout with the saved address and opens the created order", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111 1111 1111 1111");
    expect(screen.queryByText("Pago aprobado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("4111 1111 1111 1111");
    expect(screen.getByRole("img", { name: "Visa detectada" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      fulfillmentMethod: "HOME_DELIVERY",
      addressId: "15",
      expectedCartId: "40",
      paymentMethod: "CARD",
      simulationOutcome: "APPROVED",
      cardNumber: "4111111111111111",
    });
    expect(api.count("POST", "/api/v1/checkout")).toBe(1);
  });

  it("rejects a non-Luhn card locally and never calls checkout", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111112");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByText("Este número de tarjeta no es válido. Revisa los dígitos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveFocus();
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("identifies the card-number field in a server validation error", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(400, "INVALID_CARD_NUMBER", "Número de tarjeta no válido", "El número no pasó la validación."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    await waitFor(() => expect(api.count("POST", "/api/v1/checkout")).toBe(1));
    expect(await screen.findByText("Número de tarjeta: El número no pasó la validación. Vuelve a escribirlo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de tarjeta")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Número de tarjeta")).toHaveFocus());
  });

  it("detects American Express and accepts its four-digit security code", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Tarjeta", "378282246310005");
    expect(screen.getByRole("img", { name: "American Express detectada" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código de seguridad")).toHaveAttribute("maxlength", "4");
    await user.clear(screen.getByLabelText("Código de seguridad"));
    await user.type(screen.getByLabelText("Código de seguridad"), "1234");
    await user.click(screen.getByRole("button", { name: "Usar esta tarjeta" }));
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({ cardNumber: "378282246310005" });
  });

  it("discards the card number when switching to TRANSFER and omits it from the request", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => json(approved, 201),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Tarjeta", "4111111111111111");
    await choosePayment(user, "Transferencia");
    expect(await screen.findByText("Banco Guayaquil")).toBeInTheDocument();
    expect(screen.getByText("2557897233")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Número de tarjeta")).not.toBeInTheDocument());
    await choosePayment(user, "Tarjeta");
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("");
    // Leaving the card dialog without confirming keeps the transfer that was chosen.
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByLabelText("Número de tarjeta")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Transferencia/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Transferencia/ }));
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    await screen.findByRole("heading", { name: "Pedido abierto" });
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      fulfillmentMethod: "HOME_DELIVERY",
      addressId: "15",
      expectedCartId: "40",
      paymentMethod: "TRANSFER",
      simulationOutcome: "APPROVED",
    });
  });

  it("resolves an unknown outcome through its exact attempt without replaying checkout", async () => {
    const api = stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => { throw new TypeError("Failed to fetch"); },
      "POST /api/v1/checkout/attempts/*/resolve": [
        () => json({ state: "PENDING", order: null }),
        () => json({ state: "CREATED", order: approved }),
      ],
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await user.click(await screen.findByRole("button", { name: "Consultar resultado" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Hacer pedido" })).toHaveAttribute("aria-disabled", "true"));
    expect(screen.queryByText("No se creó ningún pedido.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Consultar resultado" }));
    expect(await screen.findByRole("heading", { name: "Pedido abierto" })).toBeInTheDocument();
    const original = api.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/checkout");
    expect(original).toHaveLength(1);
    const key = original[0].headers.get("Idempotency-Key");
    expect(api.calls.filter((call) => call.path.includes("/resolve")).every((call) => call.path.includes(key!))).toBe(true);
  });

  it("allows a new attempt only after the backend fences and confirms absence", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => problem(503, "INTERNAL_SERVER_ERROR", "Error", "Falla temporal."),
      "POST /api/v1/checkout/attempts/*/resolve": () => json({ state: "NOT_CREATED", order: null }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");
    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));
    await user.click(await screen.findByRole("button", { name: "Consultar resultado" }));
    expect(await screen.findByRole("heading", { name: "No se creó ningún pedido." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hacer pedido" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows the server's offer savings in the order summary without computing them or showing expiry", async () => {
    stubApi({
      "GET /api/v1/cart": () => json({
        ...cartBody([
          { quantity: 2, currentPrice: "63.96", currentSubtotal: "127.92", originalPrice: "79.95", unitSavings: "15.99", originalSubtotal: "159.90", lineSavings: "31.97" },
          { cartItemId: "101", editionId: "43", title: "Rayuela", quantity: 1, currentPrice: "18.50", currentSubtotal: "18.50", originalPrice: "18.50", unitSavings: "0.00", originalSubtotal: "18.50", lineSavings: "0.00" },
        ]),
        originalSubtotal: "178.40", savingsTotal: "31.97", currentSubtotal: "146.42", subtotal: "146.42", taxRate: "15.00", taxAmount: "21.96", shippingAmount: "0.00", total: "168.38",
      }),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
    });
    renderPurchaseRoute(routes, "/checkout");

    const summary = await screen.findByRole("complementary", { name: "Resumen del pedido" });
    const saving = await within(summary).findByText(/Ahorras \$\s*31,97/);
    expect(saving.parentElement?.querySelector(".material-symbol")?.textContent).toBe("sell");
    expect(within(summary).getAllByText(/Ahorras/)).toHaveLength(1);
    expect([...summary.querySelectorAll("li s")].map((node) => node.textContent?.replace(/\s+/g, " "))).toEqual(["Precio anterior: $ 159,90"]);
    const rows = [...summary.querySelectorAll("dl > div")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")]);
    expect(rows).toEqual([["Subtotal", "$ 178,40"], ["Ahorro total", "-$ 31,97"], ["IVA (15 %)", "$ 21,96"], ["Gastos de envío", "$ 0,00"], ["Total", "$ 168,38"]]);
    expect(summary.textContent).not.toMatch(/Quedan|Queda |Termina/);
  });

  it.each([[403,/No tienes permiso/],[429,/Espera un momento/],[503,/servicio/]] as const)("explains a pre-confirmation HTTP %s failure without sending checkout", async (status,detail) => {
    const api=stubApi({
      "GET /api/v1/cart":[() => json(cartBody()),() => problem(status,"READ_FAILURE","Consulta no disponible","Detalle de transporte")],
      "GET /api/v1/me/addresses":() => json([savedAddress]),
    });
    const user=userEvent.setup();renderPurchaseRoute(routes,"/checkout");
    await fillCheckout(user,"Transferencia");
    await user.click(screen.getByRole("button",{name:"Hacer pedido"}));
    expect(await screen.findByRole("heading",{name:"No enviamos tu pedido."})).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(api.count("POST","/api/v1/checkout")).toBe(0);
  });

  it("requires fresh acceptance when the pricing snapshot changes without changing the final amount", async () => {
    const api=stubApi({
      "GET /api/v1/cart":[() => json({...cartBody(),quoteFingerprint:"a".repeat(64)}),() => json({...cartBody(),quoteFingerprint:"b".repeat(64)})],
      "GET /api/v1/me/addresses":() => json([savedAddress]),
    });
    const user=userEvent.setup();renderPurchaseRoute(routes,"/checkout");
    await fillCheckout(user,"Transferencia");
    await user.click(screen.getByRole("button",{name:"Hacer pedido"}));
    expect(await screen.findByRole("heading",{name:"Tu carrito cambió."})).toBeInTheDocument();
    expect(api.count("POST","/api/v1/checkout")).toBe(0);
  });

  it("stops before submitting when the server cart changed since it was shown", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody([{ currentPrice: "19.00", currentSubtotal: "19.00" }])),
      ],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    const summary = screen.getByRole("complementary", { name: "Resumen del pedido" });
    expect(within(summary).getByText("Total").nextSibling).toHaveTextContent("18,50");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByRole("heading", { name: "Tu carrito cambió." })).toBeInTheDocument();
    await waitFor(() => expect(within(summary).getByText("Total").nextSibling).toHaveTextContent("19,00"));
    expect(api.count("POST", "/api/v1/checkout")).toBe(0);
  });

  it("protects the accepted quote through confirmation and recovers an authoritative quote conflict", async () => {
    const api = stubApi({
      "GET /api/v1/cart": [() => json({ ...cartBody(), quoteFingerprint: "a".repeat(64) }), () => json({ ...cartBody(), quoteFingerprint: "a".repeat(64) }), () => json({ ...cartBody([{ currentPrice: "19.00", currentSubtotal: "19.00" }]), quoteFingerprint: "b".repeat(64) })],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => problem(409,"P4005","El carrito cambió","Revisa el nuevo total."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes,"/checkout");
    await fillCheckout(user,"Transferencia");
    await user.click(screen.getByRole("button",{ name: "Hacer pedido" }));
    expect(await screen.findByRole("heading",{ name: "Tu carrito cambió y no se creó el pedido." })).toBeInTheDocument();
    expect(api.calls.find(call => call.method === "POST" && call.path === "/api/v1/checkout")?.body).toMatchObject({ expectedQuoteFingerprint: "a".repeat(64) });
    expect(screen.getByRole("button",{ name: "Hacer pedido" })).toBeEnabled();
    expect(api.count("POST","/api/v1/checkout")).toBe(1);
  });

  it("explains a P3002 stock conflict, refreshes the cart, and creates no order", async () => {
    stubApi({
      "GET /api/v1/cart": [
        () => json(cartBody()),
        () => json(cartBody()),
        () => json(cartBody([{ available: false, unavailabilityReason: "P3002" }])),
      ],
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(409, "P3002", "Existencias insuficientes", "Uno o más libros ya no tienen existencias suficientes."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByRole("heading", { name: "La disponibilidad cambió y no se creó el pedido." })).toBeInTheDocument();
    // The summary renders as a mobile disclosure and a desktop aside; CSS shows one.
    expect((await screen.findAllByText("No hay existencias suficientes para esta cantidad.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Revisar el carrito" })).toHaveAttribute("href", "/cart");
  });

  it("maps P5004 to the address choice", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/orders": () => json({ items: [], page: 0, pageSize: 1, totalCount: "0" }),
      "POST /api/v1/checkout": () => problem(404, "P5004", "Dirección no disponible", "La dirección seleccionada no está disponible."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    expect(await screen.findByText("Esa dirección ya no está disponible. Elige otra o agrega una nueva.")).toBeInTheDocument();
  });

  it("maps server field violations to the payment choice instead of inferring another field", async () => {
    stubApi({
      "GET /api/v1/cart": () => json(cartBody()),
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "POST /api/v1/checkout": () => json({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa los campos indicados.",
        violations:[{field:"paymentMethod",message:"Elige un método de pago de prueba disponible."}]},400),
    });
    const user=userEvent.setup(); renderPurchaseRoute(routes,"/checkout");
    await fillCheckout(user,"Transferencia");
    await user.click(screen.getByRole("button",{name:"Hacer pedido"}));
    const error=await screen.findByText("Elige un método de pago de prueba disponible.");
    expect(error).toBeInTheDocument();
    expect(screen.getByRole("group",{name:"Método de pago"})).toHaveAccessibleDescription("Elige un método de pago de prueba disponible.");
    expect(screen.getByRole("button",{name:/Transferencia/})).toHaveAttribute("aria-pressed","true");
  });

  it("asks a guest to sign in and return to checkout", async () => {
    stubApi({});
    renderPurchaseRoute(routes, "/checkout", { role: null });

    expect(await screen.findByRole("heading", { name: "Inicia sesión para finalizar tu compra." })).toBeInTheDocument();
    // Both the page action and the header link keep the checkout intent.
    for (const link of screen.getAllByRole("link", { name: "Iniciar sesión" })) {
      expect(link).toHaveAttribute("href", "/sign-in?from=%2Fcheckout");
    }
  });

  it("clears the session and asks for sign-in again after a 401", async () => {
    stubApi({
      "GET /api/v1/me/addresses": () => json([savedAddress]),
      "GET /api/v1/cart": [() => json(cartBody()), () => problem(401, "AUTH_INVALID_TOKEN", "Sesión no válida", "Inicia sesión otra vez.")],
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/checkout");

    await fillCheckout(user, "Transferencia");
    await user.click(screen.getByRole("button", { name: "Hacer pedido" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Tu sesión ya no está activa." })).toBeInTheDocument());
  });
});
