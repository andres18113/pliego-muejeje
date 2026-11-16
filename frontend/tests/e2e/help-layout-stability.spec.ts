import { expect, test } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

// Classic scrollbars, as desktop Windows shows them: headless Chromium hides them by default, which would hide the
// sideways shift a scrollbar causes when a loading page starts to scroll.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const article = {
  slug: "entrega-a-domicilio", categorySlug: "entrega-a-domicilio", title: "Entrega a domicilio", summary: "Cómo llega tu pedido a tu dirección.", position: 1, applicability: "PHYSICAL",
  body: Array.from({ length: 6 }, (_, index) => `## Paso ${index + 1}\n\nPreparamos tu pedido, lo entregamos a la empresa de envíos y te avisamos por correo en cada cambio de estado, con el número de guía para seguirlo.`).join("\n\n"),
};

// The Help article placeholder once let the footer sit in the first view; the arriving article pushed it out
// (0.19 CLS on phones, 0.11 on desktop with the scrollbar appearing). Loading must now keep the page still.
for (const [width, height] of [[412, 823], [1350, 940]] as const) {
  test(`a Help article arrives without moving the page at ${width}×${height}`, async ({ page }) => {
    let releaseArticle: () => void = () => undefined;
    const articleGate = new Promise<void>(resolve => { releaseArticle = resolve; });
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^.*\/api\/v1/, "");
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === "/auth/refresh") return route.fulfill({ status: 204 });
      if (path === "/catalog/offer-refresh") return json({ serverTime: new Date().toISOString(), nextTransitionAt: null, revalidateAfterSeconds: 60 });
      if (path === "/storefront/navigation") return json(storefrontNavigationFixture);
      if (path === "/help/categories") return json({ items: [{ slug: "entrega-a-domicilio", title: "Envíos", position: 1, applicability: "PHYSICAL" }] });
      if (path === "/help/articles/entrega-a-domicilio") { await articleGate; return json(article); }
      if (path === "/help/articles") return json({ items: [article, { ...article, slug: "pagos", title: "Pagos" }], page: 0, pageSize: 20, totalCount: "2" });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      const shifts: number[] = [];
      (window as unknown as { layoutShifts: number[] }).layoutShifts = shifts;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) shifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: true });
    });

    await page.goto("/ayuda/entrega-a-domicilio");
    // The loading state is really shown (the transition under test), with its footer below the first view.
    await expect(page.getByText("Cargando artículo…")).toBeAttached();
    await expect(page.locator("footer").last()).not.toBeInViewport();
    await page.evaluate(() => document.fonts.ready);
    releaseArticle();
    await expect(page.getByRole("heading", { level: 1, name: "Entrega a domicilio" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Otros temas de Ayuda" })).toBeAttached();
    await page.waitForTimeout(300);
    const total = await page.evaluate(() => (window as unknown as { layoutShifts: number[] }).layoutShifts.reduce((sum, value) => sum + value, 0));
    expect(total).toBeLessThan(0.01);
  });
}
