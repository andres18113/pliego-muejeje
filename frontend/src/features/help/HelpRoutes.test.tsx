import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { HelpArticlePage, HelpPage } from "./HelpRoutes";

afterEach(() => vi.unstubAllGlobals());
it("shows the published resources the address asks for and opens plain text article content safely", async () => {
  const article = { slug: "ebooks", categorySlug: "digital", title: "Cómo funcionan los eBooks", summary: "Titularidad digital", position: 1, applicability: "EBOOK" };
  const api = stubApi({ "GET /api/v1/help/categories": () => json({ items: [{ slug: "digital", title: "Digital", position: 1, applicability: "GENERAL" }] }), "GET /api/v1/help/articles": request => json({ items: new URL(request.url).searchParams.get("que") === "ebooks" ? [article] : [], page: 0, pageSize: 20, totalCount: "1" }), "GET /api/v1/help/articles/ebooks": () => json({ ...article, body: "Tu cuenta registra la titularidad.\n\n<script>alert('x')</script>" }) });
  const user = userEvent.setup();
  renderPurchaseRoute([{ path: "/ayuda", element: <HelpPage /> }, { path: "/ayuda/:slug", element: <HelpArticlePage /> }], "/ayuda?que=ebooks");
  expect(await screen.findByRole("heading", { level: 1, name: "Estamos aquí para ayudarte." })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "Echa un vistazo a estos recursos de asistencia" })).toBeInTheDocument();
  // Resources first: no search field, topic chips or purchase-type filter.
  expect(screen.queryByRole("search")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { pressed: true })).toBeNull();
  await user.click(await screen.findByRole("link", { name: "Cómo funcionan los eBooks" }));
  await screen.findByRole("heading", { name: "Cómo funcionan los eBooks" });
  expect(screen.getByText("<script>alert('x')</script>")).toBeInTheDocument();
  expect(api.calls.some(call => call.path.includes("que=ebooks"))).toBe(true);
});

const ebookArticle = { slug: "ebooks", categorySlug: "ebooks", title: "eBooks", summary: "Lectura digital", position: 1, applicability: "EBOOK" };
it.each([false, true])("closes on the other published topics, never the one being read (%s)", async (hasAnotherResource) => {
  const resources = hasAnotherResource ? [ebookArticle, { ...ebookArticle, slug: "pagos", categorySlug: "pagos", title: "Pagos", applicability: "GENERAL" }] : [ebookArticle];
  const api = stubApi({
    "GET /api/v1/help/categories": () => json({ items: [{ slug: "ebooks", title: "eBooks", position: 1, applicability: "EBOOK" }] }),
    "GET /api/v1/help/articles/ebooks": () => json({ ...ebookArticle, body: "Tus libros digitales." }),
    "GET /api/v1/help/articles": request => {
      expect(new URL(request.url).searchParams.get("category") ?? "").toBe("");
      return json({ items: resources, page: 0, pageSize: 20, totalCount: String(resources.length) });
    },
  });
  renderPurchaseRoute([{ path: "/ayuda/:slug", element: <HelpArticlePage /> }], "/ayuda/ebooks");
  await screen.findByRole("heading", { level: 1, name: "eBooks" });
  // The topic repeats the title, so it is not shown above it.
  expect(screen.queryByRole("link", { name: "eBooks" })).toBeNull();
  await waitFor(() => expect(api.calls.some(call => call.method === "GET" && new URL(call.path, "http://localhost").pathname === "/api/v1/help/articles")).toBe(true));
  if (hasAnotherResource) {
    const onward = await screen.findByRole("navigation", { name: "Otros temas de Ayuda" });
    expect(within(onward).getByRole("link", { name: "Pagos" })).toHaveAttribute("href", "/ayuda/pagos");
    expect(within(onward).queryByRole("link", { name: "eBooks" })).toBeNull();
  } else {
    expect(screen.queryByRole("navigation", { name: "Otros temas de Ayuda" })).toBeNull();
  }
});

const identityArticle = { slug: "cedula-o-ruc", categorySlug: "cedula-o-ruc", title: "Cédula o RUC", summary: "Por qué lo solicitamos y cómo corregirlo.", position: 10, applicability: "GENERAL" };
const correctionRequest = { id: "1", status: "PENDING", proposedType: "EC_CEDULA", proposedNumber: "1710034065", reasonCode: "DOCUMENT_TYPO",
  createdAt: "2026-10-25T17:00:00Z", dueAt: "2026-11-09T17:00:00Z", decidedAt: null, decisionReason: null };
const identity = (request: object | null) => ({ type: "EC_CEDULA", number: "0912345675", used: true, correctionMode: "REQUEST", correctionRequest: request });
function renderIdentityArticle(role: "CUSTOMER" | "ADMIN" | null, billingIdentity?: () => Response, slug = "cedula-o-ruc") {
  const article = slug === "cedula-o-ruc" ? identityArticle : ebookArticle;
  const api = stubApi({
    "GET /api/v1/help/categories": () => json({ items: [] }),
    [`GET /api/v1/help/articles/${slug}`]: () => json({ ...article, body: "## Cómo corregirla\nEn Mi perfil." }),
    "GET /api/v1/help/articles": () => json({ items: [article], page: 0, pageSize: 20, totalCount: "1" }),
    ...(billingIdentity ? { "GET /api/v1/me/billing-identity": billingIdentity } : {}),
  });
  renderPurchaseRoute([{ path: "/ayuda/:slug", element: <HelpArticlePage /> }], `/ayuda/${slug}`, { role });
  return api;
}
const identityReads = (api: ReturnType<typeof stubApi>) => api.calls.filter(call => call.path === "/api/v1/me/billing-identity").length;

it("shows a signed-in customer's pending correction with the server's own answer date and the way to it", async () => {
  renderIdentityArticle("CUSTOMER", () => json(identity(correctionRequest)));
  const status = await screen.findByRole("region", { name: "Tu solicitud de corrección" });
  expect(within(status).getByText("En revisión")).toBeVisible();
  expect(within(status).getByText(/Respuesta antes del/)).toHaveTextContent(/Respuesta antes del 9 nov\.? 2026/);
  expect(within(status).getByRole("link", { name: "Ver solicitud" })).toHaveAttribute("href", "/account/identity");
});

it.each([
  ["no request", () => json(identity(null))],
  ["no identification", () => new Response(null, { status: 204 })],
  ["a decided request", () => json(identity({ ...correctionRequest, status: "APPROVED", decidedAt: "2026-10-30T17:00:00Z" }))],
  ["a withdrawn request", () => json(identity({ ...correctionRequest, status: "WITHDRAWN" }))],
  ["a failed read", () => json({ code: "P1000", title: "Error", detail: "Error" }, 500)],
])("shows nothing personal for a customer with %s", async (_case, billingIdentity) => {
  const api = renderIdentityArticle("CUSTOMER", billingIdentity);
  await screen.findByRole("heading", { level: 1, name: "Cédula o RUC" });
  await waitFor(() => expect(identityReads(api)).toBe(1));
  expect(screen.queryByRole("region", { name: "Tu solicitud de corrección" })).toBeNull();
  expect(screen.queryByText(/Respuesta antes del/)).toBeNull();
});

it("keeps the article public and personal-free for a guest, and never reads anyone's identification", async () => {
  const api = renderIdentityArticle(null);
  await screen.findByRole("heading", { level: 2, name: "Cómo corregirla" });
  expect(screen.queryByRole("region", { name: "Tu solicitud de corrección" })).toBeNull();
  expect(identityReads(api)).toBe(0);
});

it("reads the identification only on the Cédula o RUC article", async () => {
  const api = renderIdentityArticle("CUSTOMER", () => json(identity(correctionRequest)), "ebooks");
  await screen.findByRole("heading", { level: 1, name: "eBooks" });
  expect(identityReads(api)).toBe(0);
});
