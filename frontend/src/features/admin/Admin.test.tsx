import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteObject } from "react-router-dom";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { AdminArea, AdminOverviewPage } from "./AdminArea";
import { AdminPickupsPage } from "./AdminPickupsPage";
import { AdminPickupDetailPage } from "./AdminPickupDetailPage";
import { AdminCorrectionsPage } from "./AdminCorrectionsPage";
import { adminMomentLabel, normalizePickupCode } from "./adminModels";

const routes: RouteObject[] = [{ path: "/admin", element: <AdminArea />, children: [
  { index: true, element: <AdminOverviewPage /> },
  { path: "retiros", element: <AdminPickupsPage /> },
  { path: "retiros/:orderId", element: <AdminPickupDetailPage /> },
  { path: "correcciones", element: <AdminCorrectionsPage /> },
] }];

const pickup = (patch: Record<string, unknown> = {}) => ({
  orderId: "701", orderReference: "PL-4827-1093", state: "READY", orderState: "PREPARING", paymentState: "APPROVED",
  createdAt: "2026-11-01T14:00:00Z", readyAt: "2026-11-01T14:25:00Z", collectedAt: null, collectedBy: null, identityVerified: null,
  location: { id: "1", name: "PUCE · Sede matriz", address: "Av. 12 de Octubre", city: "Quito" },
  customer: { customerId: "42", name: "Ana Pérez", email: "ana@example.com", identityType: "EC_CEDULA", identityNumber: "1710034065" },
  items: [{ orderItemId: "9", title: "Cien años de soledad", format: "PAPERBACK", quantity: 2 }],
  unitCount: 2, total: "37.00", ...patch,
});
const page = (items: unknown[], totalCount = String(items.length)) => json({ items, page: 0, pageSize: 10, totalCount });
const correction = (patch: Record<string, unknown> = {}) => ({
  id: "31", customerId: "42", customerName: "Ana Pérez", customerEmail: "ana@example.com",
  currentType: "EC_CEDULA", currentNumber: "1710034065", proposedType: "EC_RUC", proposedNumber: "1710034065001",
  reasonCode: "DOCUMENT_CHANGED", note: "Ahora facturo como persona natural con RUC.", status: "PENDING",
  createdAt: "2026-10-30T15:00:00Z", dueAt: "2026-11-14T15:00:00Z", decidedAt: null, decidedBy: null, decidedByEmail: null,
  decisionReason: null, customerHasBilledInvoices: true, ...patch,
});

describe("Administración", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is not offered to a customer, and asks a visitor to sign in", async () => {
    const api = stubApi({});
    const view = renderPurchaseRoute(routes, "/admin/retiros");
    expect(await screen.findByRole("heading", { name: "Esta área no está disponible para tu cuenta." })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.startsWith("/api/v1/admin"))).toBe(false);
    view.unmount();
    renderPurchaseRoute(routes, "/admin", { role: null });
    expect(await screen.findByRole("heading", { name: "Inicia sesión para administrar PLIEGO." })).toBeInTheDocument();
  });

  it("opens on what is waiting, from the server's own counts", async () => {
    stubApi({
      "GET /api/v1/admin/pickups": (request) => new URL(request.url).searchParams.get("state") === "READY"
        ? page([pickup()], "3") : page([pickup({ state: "PENDING" })], "1"),
      "GET /api/v1/admin/billing-identity-corrections": () => page([correction()], "2"),
    });
    renderPurchaseRoute(routes, "/admin", { role: "ADMIN" });
    expect(await screen.findByText("3 pedidos listos para retirar")).toBeInTheDocument();
    expect(screen.getByText("1 en preparación")).toBeInTheDocument();
    expect(await screen.findByText("2 solicitudes por revisar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retiros en tienda" })).toHaveAttribute("href", "/admin/retiros");
    expect(screen.getByRole("link", { name: "Correcciones de identificación" })).toHaveAttribute("href", "/admin/correcciones");
  });
});

// V-Model UT-F (docs/testing/admin-pickup-handover-v-model.md): each test names the acceptance criteria it covers.
const detail = (patch: Record<string, unknown> = {}) => ({ ...pickup(), paymentMethod: "TRANSFER",
  availableActions: { cancel: false, cancellationDeadline: null }, ...patch });
const collected = () => detail({ state: "COLLECTED", orderState: "DELIVERED", collectedAt: "2026-11-01T15:42:00Z",
  collectedBy: { userId: "5", email: "staff@pliego.test" }, identityVerified: true });
const invalidCode = () => problem(400, "P5013", "Código de retiro incorrecto", "El código de retiro no corresponde al pedido.");

describe("Retiros en tienda", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes what staff type from the customer's code", () => {
    expect(normalizePickupCode(" abcd 2345 ")).toBe("P-ABCD2345");
    expect(normalizePickupCode("p-abcd-2345")).toBe("P-ABCD2345");
  });

  it("AC-1.1: each queued order is one link to its page, and the queue never shows a code", async () => {
    stubApi({ "GET /api/v1/admin/pickups": () => page([pickup()]) });
    renderPurchaseRoute(routes, "/admin/retiros", { role: "ADMIN" });
    const queue = await screen.findByRole("list", { name: "Listos para retirar" });
    const link = within(queue).getByRole("link", { name: /Pedido #PL-4827-1093.*Ana Pérez.*Entregar/ });
    expect(link).toHaveAttribute("href", "/admin/retiros/701");
    expect(document.body.textContent).not.toMatch(/P-[2-9A-Z]{6,8}/);
  });

  it("AC-1.2, AC-1.3: a code verified at the counter opens the order with that step done, never in the URL", async () => {
    const api = stubApi({
      "GET /api/v1/admin/pickups": () => page([]),
      "POST /api/v1/admin/pickups/lookup": () => json(pickup()),
      "GET /api/v1/admin/pickups/701": () => json(detail()),
    });
    const user = userEvent.setup();
    const { router } = renderPurchaseRoute(routes, "/admin/retiros", { role: "ADMIN" });
    await user.type(await screen.findByLabelText("Código de retiro"), "abcd 2345");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pedido #PL-4827-1093" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/retiros/701");
    expect(`${router.state.location.search}${router.state.location.hash}${JSON.stringify(router.state.location.state)}`).not.toMatch(/ABCD/);
    expect(screen.getByText("Código verificado para este pedido.")).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/admin/pickups/701/verify-code")).toBe(0);
    const trail = within(screen.getByRole("navigation", { name: "Ruta" }));
    expect(trail.getByRole("link", { name: "Retiros en tienda" })).toHaveAttribute("href", "/admin/retiros");
  });

  it("AC-2.1–2.4: shows the order, its books, the customer and the pickup, never the code", async () => {
    stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail()) });
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    expect(await screen.findByRole("heading", { level: 1, name: "Pedido #PL-4827-1093" })).toBeInTheDocument();
    expect(screen.getByText("Listo para retirar")).toBeInTheDocument();
    expect(screen.getByText(/Transferencia/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Libros del pedido" })).getByText("Cien años de soledad")).toBeInTheDocument();
    const customer = within(screen.getByRole("region", { name: "Cliente" }));
    expect(customer.getByText("ana@example.com")).toBeInTheDocument();
    expect(customer.getByText("1710034065")).toBeInTheDocument();
    expect(screen.getByText("PUCE · Sede matriz")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/P-[2-9A-Z]{6,8}/);
  });

  it("AC-2.5: an unknown or non-pickup order reads as not found", async () => {
    stubApi({ "GET /api/v1/admin/pickups/999": () => problem(404, "P5016", "Retiro no encontrado", "No encontramos un retiro.") });
    renderPurchaseRoute(routes, "/admin/retiros/999", { role: "ADMIN" });
    expect(await screen.findByRole("heading", { name: "No encontramos este retiro." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Retiros en tienda" })).toHaveAttribute("href", "/admin/retiros");
  });

  it("AC-3.1, AC-3.2: identity and confirmation stay locked until this order's code is verified; a wrong code changes nothing", async () => {
    const api = stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail()), "POST /api/v1/admin/pickups/701/verify-code": invalidCode });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    const confirm = await screen.findByRole("button", { name: "Confirmar entrega" });
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Se habilita después de verificar el código.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Pide al cliente su código"), "P-ZZZZZZZZ");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    expect(await screen.findByText("El código no corresponde a este pedido. Revísalo con el cliente.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path.endsWith("/verify-code"))?.body).toEqual({ code: "P-ZZZZZZZZ" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(confirm).toBeDisabled();
    expect(api.count("POST", "/api/v1/admin/orders/701/pickup/collect")).toBe(0);
  });

  it("AC-4.1, AC-4.2, AC-5.1, AC-6.1: code, then identity, then one confirmation turns it Retirado", async () => {
    let release: (value: Response) => void = () => {};
    const api = stubApi({
      "GET /api/v1/admin/pickups/701": [() => json(detail()), () => json(collected())],
      "POST /api/v1/admin/pickups/701/verify-code": () => json(detail()),
      "POST /api/v1/admin/orders/701/pickup/collect": () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    await user.type(await screen.findByLabelText("Pide al cliente su código"), "p-abcd2345");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    expect(await screen.findByText("Código verificado para este pedido.")).toBeInTheDocument();
    // AC-4.1: the identity to compare appears in the handover once the code is verified.
    expect(within(screen.getByRole("region", { name: "Entrega" })).getByText("1710034065")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirmar entrega" });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Verifiqué el documento de identidad de Ana Pérez." }));
    expect(screen.getByText("Entregarás 2 libros a Ana Pérez.")).toBeInTheDocument();
    await user.click(confirm);
    // In flight: the action cannot be pressed twice.
    expect(await screen.findByRole("button", { name: "Confirmando…" })).toBeDisabled();
    release(json(collected()));
    expect(await screen.findByText("Entrega confirmada: entregaste 2 libros a Ana Pérez.")).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.endsWith("/pickup/collect"))).toHaveLength(1);
    expect(api.calls.find((call) => call.path.endsWith("/pickup/collect"))?.body).toEqual({ pickupCode: "P-ABCD2345", identityVerified: true });
    expect(await screen.findByText(/lo confirmó staff@pliego\.test/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar entrega" })).toBeNull();
  });

  it("AC-6.2, AC-6.4: a pickup someone else collected first is reported and shown as it is now", async () => {
    stubApi({
      "GET /api/v1/admin/pickups/701": [() => json(detail()), () => json(collected())],
      "POST /api/v1/admin/pickups/701/verify-code": () => json(detail()),
      "POST /api/v1/admin/orders/701/pickup/collect": () => problem(409, "P5017", "Pedido ya retirado", "Este pedido ya fue retirado."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    await user.type(await screen.findByLabelText("Pide al cliente su código"), "P-ABCD2345");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Confirmar entrega" }));
    expect(await screen.findByText("Este pedido ya fue retirado. No entregues los libros otra vez.")).toBeInTheDocument();
    expect(await screen.findByText(/lo confirmó staff@pliego\.test/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar entrega" })).toBeNull();
  });

  it("AC-2.1: a preparing order inside its cancellation window is expected when the window ends, not earlier", async () => {
    stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail({ state: "PENDING", orderState: "CONFIRMED", readyAt: "2026-11-01T18:08:00Z",
      availableActions: { cancel: true, cancellationDeadline: "2026-11-01T18:13:00Z" } })) });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T18:05:00Z"));
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    const line = await screen.findByText(/Estará listo aproximadamente el/);
    expect(line.textContent).toContain(adminMomentLabel("2026-11-01T18:13:00Z")!);
    expect(line.textContent).not.toContain(adminMomentLabel("2026-11-01T18:08:00Z")!);
    vi.restoreAllMocks();
  });

  it("ADR 0051: a pending order whose time has passed says why it waits, never promising a moment already gone", async () => {
    stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail({ state: "PENDING", orderState: "CONFIRMED", readyAt: "2026-11-01T21:59:00Z",
      availableActions: { cancel: false, cancellationDeadline: null } })) });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T03:00:00Z"));
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    expect(await screen.findByText(/fuera de su horario de atención o el pago sigue pendiente/)).toBeInTheDocument();
    expect(screen.queryByText(/Estará listo aproximadamente el/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar entrega" })).toBeNull();
    vi.restoreAllMocks();
  });

  it("AC-6.3: a not-ready order offers no handover", async () => {
    stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail({ state: "PENDING", orderState: "CONFIRMED" })) });
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    expect(await screen.findByText(/No entregues los libros todavía/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar entrega" })).toBeNull();
    expect(screen.queryByLabelText("Pide al cliente su código")).toBeNull();
  });

  it("AC-7.2: a customer gets no admin page and no admin request", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, "/admin/retiros/701");
    expect(await screen.findByRole("heading", { name: "Esta área no está disponible para tu cuenta." })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.startsWith("/api/v1/admin"))).toBe(false);
  });

  it("AC-8.1: cancel is offered only while the server allows it, behind a confirmation", async () => {
    const api = stubApi({
      "GET /api/v1/admin/pickups/701": [() => json(detail({ state: "PENDING", orderState: "CONFIRMED",
        availableActions: { cancel: true, cancellationDeadline: "2026-11-01T14:06:00Z" } })),
        () => json(detail({ state: "CANCELLED", orderState: "CANCELLED", paymentState: "REFUNDED" }))],
      "POST /api/v1/admin/orders/701/cancel": () => json({ orderId: "701", previousState: "CONFIRMED", orderState: "CANCELLED", paymentState: "REFUNDED", restoredUnits: 2 }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar el pedido #PL-4827-1093?" });
    expect(within(dialog).getByText(/Se reembolsarán \$\s?37,00 a Ana Pérez\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar pedido" }));
    expect(await screen.findByText(/Cancelaste el pedido #PL-4827-1093\./)).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/admin/orders/701/cancel")).toBe(1);
    expect(await screen.findByText("Este pedido fue cancelado. No entregues los libros.")).toBeInTheDocument();
  });

  it("AC-8.2: no cancel action when the server does not allow one", async () => {
    stubApi({ "GET /api/v1/admin/pickups/701": () => json(detail()) });
    renderPurchaseRoute(routes, "/admin/retiros/701", { role: "ADMIN" });
    await screen.findByRole("heading", { level: 1, name: "Pedido #PL-4827-1093" });
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  });
});

describe("Correcciones de identificación", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the change and its invoice context, and requires a reason to reject", async () => {
    const api = stubApi({
      "GET /api/v1/admin/billing-identity-corrections": () => page([correction()]),
      "POST /api/v1/admin/billing-identity-corrections/31/decision": () => json({ id: "31", status: "REJECTED", decidedAt: "2026-11-01T16:00:00Z", decidedBy: "5", decisionReason: "El RUC no corresponde a tu nombre." }),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/correcciones", { role: "ADMIN" });
    const card = (await screen.findByRole("heading", { name: "Ana Pérez" })).closest("li")!;
    const change = within(card as HTMLElement).getByLabelText("Cambio solicitado");
    expect(within(change).getByText("1710034065")).toBeInTheDocument();
    expect(within(change).getByText("1710034065001")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(/esas facturas no cambian/)).toBeInTheDocument();

    await user.click(within(card as HTMLElement).getByRole("button", { name: "Rechazar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Rechazar la solicitud de Ana Pérez?" });
    await user.click(within(dialog).getByRole("button", { name: "Rechazar solicitud" }));
    expect(await within(dialog).findByText("Escribe el motivo del rechazo.")).toBeInTheDocument();
    expect(api.count("POST", "/api/v1/admin/billing-identity-corrections/31/decision")).toBe(0);

    await user.type(within(dialog).getByLabelText("Motivo del rechazo"), "El RUC no corresponde a tu nombre.");
    await user.click(within(dialog).getByRole("button", { name: "Rechazar solicitud" }));
    expect(await screen.findByText("Rechazaste la solicitud de Ana Pérez. Verá el motivo en su perfil.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path.endsWith("/decision"))?.body).toEqual({ decision: "REJECT", decisionReason: "El RUC no corresponde a tu nombre." });
  });

  it("approves after confirming, and reports a request someone else already resolved", async () => {
    const api = stubApi({
      "GET /api/v1/admin/billing-identity-corrections": () => page([correction()]),
      "POST /api/v1/admin/billing-identity-corrections/31/decision": [
        () => problem(409, "P1111", "Solicitud no pendiente", "La solicitud ya no está pendiente."),
      ],
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/admin/correcciones", { role: "ADMIN" });
    await user.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Aprobar la corrección de Ana Pérez?" });
    expect(within(dialog).getByText("Las facturas ya emitidas no cambian.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Aprobar corrección" }));
    expect(await screen.findByText("Esta solicitud ya no está pendiente: otra persona la resolvió o el cliente la retiró.")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path.endsWith("/decision"))?.body).toMatchObject({ decision: "APPROVE" });
    // The list is read again after the refusal.
    await waitFor(() => expect(api.count("GET", "/api/v1/admin/billing-identity-corrections")).toBeGreaterThan(1));
  });
});
