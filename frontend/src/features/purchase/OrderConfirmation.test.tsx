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

  it("shows the order's historical savings from its snapshot, with the PUCE reference line and no expiry", async () => {
    const discounted: OrderDetail = {
      ...homeOrder,
      pricingSnapshotAvailable: true, originalSubtotal: "136.95", savingsTotal: "20.74", currentSubtotal: "116.21",
      subtotal: "116.21", taxRate: "15.00", taxAmount: "17.43", shippingAmount: "0.00", total: "133.64",
      items: [
        { orderItemId: "1", editionId: "474", title: "Manual de medicina basada en evidencias", authors: "Autora", publisher: "Editorial", requiresPhysicalFulfillment: true, format: "PAPERBACK", unitPrice: "63.96", quantity: 1, subtotal: "63.96", pricingSnapshotAvailable: true, originalPrice: "79.95", unitSavings: "15.99", originalSubtotal: "79.95", lineSavings: "15.99" },
        { orderItemId: "2", editionId: "42", title: "Cien años de soledad", authors: "Autora", publisher: "Editorial", requiresPhysicalFulfillment: true, format: "PAPERBACK", unitPrice: "19.00", quantity: 2, subtotal: "38.00", pricingSnapshotAvailable: true, originalPrice: "19.00", unitSavings: "0.00", originalSubtotal: "38.00", lineSavings: "0.00" },
        { orderItemId: "3", editionId: "306", title: "La mujer en la historia", authors: "Autora", publisher: "Editorial", requiresPhysicalFulfillment: false, format: "EBOOK", unitPrice: "14.25", quantity: 1, subtotal: "14.25", pricingSnapshotAvailable: true, originalPrice: "19.00", unitSavings: "4.75", originalSubtotal: "19.00", lineSavings: "4.75" },
      ],
    };
    renderConfirmation(discounted);
    await screen.findByRole("heading", { level: 1, name: "Es momento de celebrar" });
    const details = screen.getByRole("region", { name: "Tu pedido N.º 700" });
    const rows = [...details.querySelectorAll("dl > div")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")]);
    expect(rows).toEqual([["Subtotal", "$ 136,95"], ["Ahorro total", "-$ 20,74"], ["IVA (15 %)", "$ 17,43"], ["Gastos de envío", "$ 0,00"], ["Total pagado", "$ 133,64"]]);
    expect(details.querySelector("[data-tone='savings']")).not.toBeNull();

    const fulfillment = screen.getByRole("region", { name: "Entrega" });
    const items = [...fulfillment.querySelectorAll("li")];
    expect(items[0].querySelector("s")?.textContent?.replace(/\s+/g, " ")).toBe("Precio anterior: $ 79,95");
    expect(within(items[0]).getByText(/Ahorraste \$\s*15,99/).querySelector(".material-symbol")?.textContent).toBe("sell");
    expect(items[1].querySelector("s")).toBeNull();
    expect(within(items[1]).queryByText(/Ahorraste/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Compras digitales" })).getByText(/Ahorraste \$\s*4,75/)).toBeInTheDocument();

    expect(screen.getByText("Referencia PUCE en la entrada principal.")).toBeInTheDocument();
    expect(screen.queryByText(/para esta demo/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Quedan|Queda \d|Termina el/);
  });

  it("keeps an order without a pricing snapshot as it was: no savings are invented", async () => {
    renderConfirmation({ ...homeOrder, pricingSnapshotAvailable: false, originalSubtotal: "99.00", savingsTotal: "10.00" });
    await screen.findByRole("heading", { level: 1, name: "Es momento de celebrar" });
    const details = screen.getByRole("region", { name: "Tu pedido N.º 700" });
    expect(within(details).queryByText("Ahorro total")).toBeNull();
    expect(within(details).getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/Ahorraste/)).toBeNull();
    expect(document.querySelector("[data-confirmation='fulfillment'] s")).toBeNull();
  });

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
    expect(within(destination).getByText("Referencia PUCE en la entrada principal.")).toBeInTheDocument();
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
