import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { InvoiceDocumentPage } from "./InvoiceDocumentPage";

const routes = [{ path: "/orders/:orderId/invoice", element: <InvoiceDocumentPage /> }];
const ACCESS = "GET /api/v1/orders/700/invoice/files/PDF/access";
const FILE = "GET /api/v1/orders/700/invoice/files/PDF";
const metadata = (pdf: string, extra: Record<string, unknown> = {}) => json({
  invoiceId: "5", orderId: "700", state: "ISSUED", provenance: "SIMULATED", documentNumber: "999-999-000000001",
  files: [{ type: "PDF", state: pdf }, { type: "XML", state: "READY" }], ...extra,
});
const streamed = () => json({ delivery: "API_STREAM", url: "/api/v1/orders/700/invoice/files/PDF?disposition=inline", expiresAt: null });
const pdf = () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf" } });

describe("InvoiceDocumentPage", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:invoice"), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("authorizes through the access endpoint, then shows the streamed PDF with its number and order", async () => {
    const api = stubApi({ "GET /api/v1/orders/700/invoice": () => metadata("READY"), [ACCESS]: streamed, [FILE]: pdf });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    const viewer = await screen.findByTitle("Factura N.° 999-999-000000001");
    await waitFor(() => expect(viewer).toHaveAttribute("src", "blob:invoice"));
    expect(screen.getByRole("heading", { level: 1, name: "Factura" })).toBeInTheDocument();
    expect(screen.getByText("Pedido N.°").nextSibling).toHaveTextContent("700");
    expect(screen.getByRole("link", { name: "Volver al pedido" })).toHaveAttribute("href", "/orders/700");
    const order = api.calls.map((call) => call.path).filter((path) => path.includes("/files/PDF"));
    expect(order).toEqual(["/api/v1/orders/700/invoice/files/PDF/access?disposition=inline", "/api/v1/orders/700/invoice/files/PDF?disposition=inline"]);
    // The PDF carries the academic notice; the page adds none.
    expect(screen.queryByText(/simulación académica/i)).not.toBeInTheDocument();
  });

  it("frames a private-storage link as given and never streams the file itself", async () => {
    const api = stubApi({
      "GET /api/v1/orders/700/invoice": () => metadata("READY"),
      [ACCESS]: () => json({ delivery: "SIGNED_URL", url: "https://storage.example/invoices/5.pdf?X-Amz-Expires=300", expiresAt: "2026-10-27T12:05:00Z" }),
    });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    const viewer = await screen.findByTitle("Factura N.° 999-999-000000001");
    expect(viewer).toHaveAttribute("src", "https://storage.example/invoices/5.pdf?X-Amz-Expires=300");
    expect(api.count("GET", "/api/v1/orders/700/invoice/files/PDF?")).toBe(0);
  });

  it("saves the streamed PDF under the invoice number", async () => {
    stubApi({ "GET /api/v1/orders/700/invoice": () => metadata("READY"), [ACCESS]: streamed, [FILE]: pdf });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("factura-999-999-000000001.pdf");
      expect(this.href).toBe("blob:invoice");
    });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    await waitFor(() => expect(screen.getByTitle("Factura N.° 999-999-000000001")).toHaveAttribute("src", "blob:invoice"));
    await userEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("saves a stored PDF through a fresh attachment link, followed in place so the browser downloads it", async () => {
    const signed = (request: Request) => {
      const attachment = new URL(request.url).searchParams.get("disposition") === "attachment";
      return json({ delivery: "SIGNED_URL", url: `https://storage.example/invoices/5.pdf?response-content-disposition=${attachment ? "attachment" : "inline"}`, expiresAt: "2026-10-27T12:05:00Z" });
    };
    const api = stubApi({ "GET /api/v1/orders/700/invoice": () => metadata("READY"), [ACCESS]: signed });
    const followed: { href: string; target: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { followed.push({ href: this.href, target: this.target }); });
    const open = vi.spyOn(window, "open");
    renderPurchaseRoute(routes, "/orders/700/invoice");
    await screen.findByTitle("Factura N.° 999-999-000000001");
    await userEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(followed).toEqual([{ href: "https://storage.example/invoices/5.pdf?response-content-disposition=attachment", target: "" }]));
    expect(open).not.toHaveBeenCalled();
    expect(api.calls.filter((call) => call.path.startsWith("/api/v1/orders/700/invoice/files/PDF/access")).map((call) => call.path))
      .toEqual(["/api/v1/orders/700/invoice/files/PDF/access?disposition=inline", "/api/v1/orders/700/invoice/files/PDF/access?disposition=attachment"]);
  });

  it("waits quietly while the PDF is prepared and asks for no file", async () => {
    const api = stubApi({ "GET /api/v1/orders/700/invoice": () => metadata("PROCESSING") });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    expect(await screen.findByRole("heading", { name: "Estamos preparando tu factura." })).toBeInTheDocument();
    expect(api.count("GET", "/api/v1/orders/700/invoice/files")).toBe(0);
  });

  it("names a missing invoice without revealing whose it is", async () => {
    stubApi({ "GET /api/v1/orders/700/invoice": () => problem(404, "INVOICE_NOT_FOUND", "Factura no disponible", "El pedido todavía no tiene una factura.") });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    expect(await screen.findByRole("heading", { name: "No encontramos esta factura." })).toBeInTheDocument();
  });

  it("says a historical invoice has no file instead of offering an action that cannot work", async () => {
    stubApi({ "GET /api/v1/orders/700/invoice": () => metadata("UNAVAILABLE", { provenance: "LEGACY", documentNumber: "001-001-000000042" }) });
    renderPurchaseRoute(routes, "/orders/700/invoice");
    expect(await screen.findByRole("heading", { name: "El archivo de esta factura no está disponible." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descargar PDF" })).not.toBeInTheDocument();
  });

  it("asks a guest to sign in and return to this invoice", async () => {
    const api = stubApi({});
    renderPurchaseRoute(routes, "/orders/700/invoice", { role: null });
    expect(await screen.findByRole("heading", { name: "Inicia sesión para ver tu factura." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" }).getAttribute("href")).toContain(encodeURIComponent("/orders/700/invoice"));
    expect(api.count("GET", "/api/v1/orders/700/invoice")).toBe(0);
  });
});
