import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { orderDetailFixture, orderSummaryFixture } from "@/test/orders";
import { useCustomerOrders } from "./ordersQuery";
import { ApiRequestError } from "@/shared/api/errors";

function Probe() {
  const query = useCustomerOrders(0);
  return <><pre data-testid="models" data-error={query.isError} data-error-status={query.error instanceof ApiRequestError ? query.error.status : undefined}>{JSON.stringify(query.viewModels)}</pre>
    <button onClick={() => void query.refetch()}>Refresh</button></>;
}

describe("customer orders integration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reconciles visible summaries through detail and exposes server-owned actions and prices", async () => {
    const api = stubApi({
      "GET /api/v1/orders": () => json({ items: [orderSummaryFixture()],page: 0,pageSize: 10,totalCount: "1" }),
      "GET /api/v1/orders/700": () => json(orderDetailFixture("IN_TRANSIT", { availableActions: { cancel: false, changeShippingAddress: false } })),
    });
    renderPurchaseRoute([{ path: "/orders", element: <Probe /> }],"/orders");
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent('"code":"IN_TRANSIT"'));
    const [model] = JSON.parse(screen.getByTestId("models").textContent!);
    expect(model.availableActions.cancel).toBe(false);
    expect(model.pricing.tax).toBe("5.55");
    expect(api.count("GET","/api/v1/orders/700")).toBe(1);
  });

  it("fails closed on actions if detail enrichment fails", async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [orderSummaryFixture()],page: 0,pageSize: 10,totalCount: "1" }),
      "GET /api/v1/orders/700": [
        () => json(orderDetailFixture()),
        () => problem(503,"DATABASE_ERROR","No disponible","Inténtalo otra vez."),
      ],
    });
    renderPurchaseRoute([{ path: "/orders", element: <Probe /> }],"/orders");
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent('"cancel":true'));
    await userEvent.click(screen.getByRole("button",{ name: "Refresh" }));
    await waitFor(() => expect(screen.getByTestId("models")).toHaveAttribute("data-error","true"));
    const [model] = JSON.parse(screen.getByTestId("models").textContent!);
    expect(model.availableActions.cancel).toBe(false);
    expect(model.pricing.tax).toBe("5.55");
  });

  it("prioritizes expired authentication over another row's read failure", async () => {
    stubApi({
      "GET /api/v1/orders": () => json({ items: [orderSummaryFixture(),orderSummaryFixture({ orderId: "701" })],page: 0,pageSize: 10,totalCount: "2" }),
      "GET /api/v1/orders/700": () => problem(503,"DATABASE_ERROR","No disponible","Inténtalo otra vez."),
      "GET /api/v1/orders/701": () => problem(401,"AUTHENTICATION_REQUIRED","Sesión vencida","Inicia sesión."),
    });
    renderPurchaseRoute([{ path: "/orders",element: <Probe /> }],"/orders");
    await waitFor(() => expect(screen.getByTestId("models")).toHaveAttribute("data-error-status","401"));
  });
});
