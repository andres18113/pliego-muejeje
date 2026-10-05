import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";
import { HelpArticlePage, HelpPage } from "./HelpRoutes";

afterEach(() => vi.unstubAllGlobals());
it("searches published Help and opens plain text article content safely", async () => {
  const article = { slug: "ebooks", categorySlug: "digital", title: "Cómo funcionan los eBooks", summary: "Titularidad digital", position: 1, applicability: "EBOOK" };
  const api = stubApi({ "GET /api/v1/help/categories": () => json({ items: [{ slug: "digital", title: "Digital", position: 1, applicability: "GENERAL" }] }), "GET /api/v1/help/articles": request => json({ items: new URL(request.url).searchParams.get("que") === "ebooks" ? [article] : [], page: 0, pageSize: 20, totalCount: "1" }), "GET /api/v1/help/articles/ebooks": () => json({ ...article, body: "Tu cuenta registra la titularidad.\n\n<script>alert('x')</script>" }) });
  const user = userEvent.setup();
  renderPurchaseRoute([{ path: "/ayuda", element: <HelpPage /> }, { path: "/ayuda/:slug", element: <HelpArticlePage /> }], "/ayuda");
  await user.type(screen.getByLabelText("Buscar en Ayuda"), "ebooks");
  await user.click(screen.getByRole("button", { name: "Buscar" }));
  await user.click(await screen.findByRole("link", { name: "Cómo funcionan los eBooks" }));
  await screen.findByRole("heading", { name: "Cómo funcionan los eBooks" });
  expect(screen.getByText("<script>alert('x')</script>")).toBeInTheDocument();
  expect(api.calls.some(call => call.path.includes("que=ebooks"))).toBe(true);
});
