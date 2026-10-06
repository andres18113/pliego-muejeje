import { createRef } from "react";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "@/shared/api/orders";
import { renderPurchaseRoute, stubApi } from "@/test/purchase";
import { pickupOrder } from "@/test/pickup";
import { OrderConfirmation } from "./OrderConfirmation";

const homeOrder: OrderDetail = {
  ...pickupOrder,
  fulfillment: { method: "HOME_DELIVERY" },
  address: { recipient: "Ana Pérez", line1: "Av. Principal 123", line2: "Departamento 4", city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: "170101", reference: "Frente al parque", phone: "+59325550134" },
  shipment: { shipmentId: "70", state: "PENDING", carrier: null, trackingCode: null, trackingUrl: null,
    estimatedDeliveryFrom: "2026-10-05T12:00:00Z", estimatedDeliveryTo: "2026-10-07T12:00:00Z", createdAt: "2026-10-04T23:55:12Z",
    preparingAt: null, shippedAt: null, outForDeliveryAt: null, deliveredAt: null, canceledAt: null, history: [] },
};
function renderConfirmation(order: OrderDetail) {
  stubApi({});
  return renderPurchaseRoute([{ path: "/confirmation", element: <OrderConfirmation order={order} headingRef={createRef()} /> }], "/confirmation");
}

describe("successful order confirmation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prioritizes pickup location, server readiness and code while moving commercial detail below", async () => {
    renderConfirmation(pickupOrder);
    expect(await screen.findByRole("heading", { level: 1, name: "Es momento de celebrar" })).toBeInTheDocument();
    expect(screen.getByText("Gracias por tu pedido N.º 700")).toBeInTheDocument();
    const immediate = within(screen.getByRole("complementary", { name: "Tu pedido" }));
    expect(immediate.getByText("P-ABC234")).toBeInTheDocument();
    expect(immediate.getByText(/19:32:12/)).toBeInTheDocument();
    expect(immediate.queryByText(/IVA|Total|Cien años/)).not.toBeInTheDocument();
    expect(immediate.getByRole("link", { name: "Ver pedido completo" })).toHaveAttribute("href", "/orders/700");
    expect(screen.queryByText("America/Guayaquil")).not.toBeInTheDocument();
    const details = within(screen.getByRole("region", { name: "Tu pedido N.º 700" }));
    expect(details.getByText("IVA (15 %)" )).toBeInTheDocument();
    expect(details.getByText(/2[.,]78/)).toBeInTheDocument();
    expect(details.queryByText("Cien años de soledad")).not.toBeInTheDocument();
    expect(screen.queryByText("SIM-PICKUP")).not.toBeInTheDocument();
    const fulfillment = within(screen.getByRole("region", { name: "Retiro" }));
    expect(fulfillment.getByText("Cien años de soledad")).toBeInTheDocument();
    expect(fulfillment.getByText("Cantidad: 1")).toBeInTheDocument();
    expect(fulfillment.getByRole("list")).toBeInTheDocument();
  });

  it("overlays the confirmed pickup destination on its snapshot map without an extra location card", async () => {
    renderConfirmation(pickupOrder);
    const destination = await screen.findByRole("region", { name: "Destino confirmado" });
    expect(within(destination).getByRole("heading", { name: "Enviar a" })).toBeInTheDocument();
    expect(within(destination).getByText("Punto de prueba Quito")).toBeInTheDocument();
    expect(within(destination).getByText("Calle de prueba 42")).toBeInTheDocument();
    expect(within(destination).getByTitle("Mapa de Punto de prueba Quito")).toHaveAttribute("src", expect.stringContaining("marker=-0.22%2C-78.5"));
    expect(within(destination).queryByRole("heading", { name: "Retirar en" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Calle de prueba 42")).toHaveLength(1);
  });

  it("uses the confirmed home address and server delivery window without pickup facts", async () => {
    renderConfirmation(homeOrder);
    const destination = await screen.findByRole("region", { name: "Destino confirmado" });
    expect(within(destination).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(destination).getByText(/Av\. Principal 123/)).toBeInTheDocument();
    const immediate = within(screen.getByRole("complementary", { name: "Tu pedido" }));
    expect(immediate.getByText("Entrega a domicilio")).toBeInTheDocument();
    expect(immediate.getByText(/5.*7.*octubre/)).toBeInTheDocument();
    expect(immediate.queryByText("Código de retiro")).not.toBeInTheDocument();
    expect(screen.queryByText("P-ABC234")).not.toBeInTheDocument();
    expect(within(destination).getByTitle("Mapa de referencia de PUCE")).toHaveAttribute("src", expect.stringContaining("marker=-0.21%2C-78.4914"));
    expect(within(destination).getByText(/no ubica la dirección de entrega/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Progreso del envío" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Av\. Principal 123/)).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Entrega" })).toHaveTextContent("Cien años de soledad");
  });

  it("does not invent a delivery window when the order snapshot has none", async () => {
    renderConfirmation({ ...homeOrder, shipment: { ...homeOrder.shipment!, estimatedDeliveryFrom: null, estimatedDeliveryTo: null } });
    expect(await screen.findByRole("heading", { name: "Es momento de celebrar" })).toBeInTheDocument();
    expect(screen.queryByText("Aún no disponible")).not.toBeInTheDocument();
    expect(screen.queryByText("Entrega estimada")).not.toBeInTheDocument();
  });

  it.each([
    ["PENDING_PAYMENT", "PENDING", "Tu pedido espera el pago"],
    ["CANCELLED", "REJECTED", "El pago no se completó"],
    ["CANCELLED", "REFUNDED", "Pedido cancelado"],
  ])("preserves the %s / %s confirmation instead of celebrating it", async (state, paymentState, heading) => {
    renderConfirmation({ ...pickupOrder, orderState: state, purchaseState: state, payment: { ...pickupOrder.payment, state: paymentState } });
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Es momento de celebrar" })).not.toBeInTheDocument();
  });
});

it("confirms digital ownership without presenting any physical destination", async () => {
  renderConfirmation({ ...homeOrder, fulfillment: null, address: null, shipment: null, items: [{ ...homeOrder.items[0], format: "EBOOK", requiresPhysicalFulfillment: false }] });
  await screen.findByRole("heading", { name: "Es momento de celebrar" });
  expect(screen.queryByRole("region", { name: "Destino confirmado" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver Mi biblioteca" })).toHaveAttribute("href", "/biblioteca");
});

it("limits a mixed purchase's delivery section to physical snapshots", async () => {
  renderConfirmation({ ...homeOrder, items: [{ ...homeOrder.items[0], format: "PAPERBACK" }, { ...homeOrder.items[0], orderItemId: "2", editionId: "43", title: "Libro digital", format: "EBOOK", requiresPhysicalFulfillment: false }] });
  const delivery = within(await screen.findByRole("region", { name: "Entrega" }));
  expect(delivery.getByText("Cien años de soledad")).toBeInTheDocument();
  expect(delivery.queryByText("Libro digital")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Compras digitales" })).toHaveTextContent("Libro digital");
});

it("classifies confirmation items from server capabilities despite display formats", async () => {
  renderConfirmation({ ...homeOrder, items: [
    { ...homeOrder.items[0], format: "EBOOK", requiresPhysicalFulfillment: true },
    { ...homeOrder.items[0], orderItemId: "2", title: "Compra digital autorizada", format: "PAPERBACK", requiresPhysicalFulfillment: false },
  ] });
  const delivery = within(await screen.findByRole("region", { name: "Entrega" }));
  expect(delivery.getByText("Cien años de soledad")).toBeInTheDocument();
  expect(delivery.queryByText("Compra digital autorizada")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Compras digitales" })).toHaveTextContent("Compra digital autorizada");
});
