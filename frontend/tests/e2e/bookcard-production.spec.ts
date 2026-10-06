import { expect, test, type Page } from "@playwright/test";
import manifest from "../../../covers/generated/manifest-normalized.json" with { type: "json" };
import { bookCardFixtures } from "../../src/dev/bookCardFixtures";

async function install(page: Page, scheme: "light" | "dark", outcome: "ok" | "unconfirmed" | "confirmed-after-loss" = "ok") {
  const editions = bookCardFixtures.map((book, index) => ({ ...book, available: index % 3 !== 2, price: index === 8 ? "999999999.99" : book.price }));
  const saved = new Set(editions.map((book) => book.editionId));
  const quantities = new Map<string, number>();
  const commands: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript((value) => localStorage.setItem("mantine-color-scheme-value", value), scheme);
  await page.route("https://covers.pliegolibros.com/**", (route) => {
    const book = manifest.records.find((record) => record.cover_url === route.request().url());
    return book ? route.fulfill({ path: decodeURIComponent(new URL(`../../../covers/${book.original_file}`, import.meta.url).pathname), contentType: "image/webp" }) : route.abort();
  });
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    const body = route.request().postDataJSON();
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/auth/refresh") return ok({ accessToken: "bookcard-test-token", tokenType: "Bearer", expiresInSeconds: 3600, user: { userId: "100", email: "bookcard@example.test", role: "CUSTOMER" } });
    if (path === "/catalog/categories") return ok({ items: [{ slug: "literatura", name: "Literatura", parentSlug: null }] });
    if (path === "/catalog/filter-options") return ok({ languages: ["es"], minimumPrice: "20.00", maximumPrice: "999999999.99" });
    if (path === "/catalog/editions") {
      const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
      return ok({ items: editions.slice(0, pageSize), page: 0, pageSize, totalCount: String(editions.length) });
    }
    if (/^\/catalog\/editions\/\d+$/.test(path)) {
      const book = editions.find((edition) => path.endsWith(`/${edition.editionId}`))!;
      return ok({ ...book, authors: [{ authorId: "9", name: book.authors, order: 1 }], publisher: { publisherId: "5", name: book.publisher }, categories: [], pageCount: 400, publicationDate: null, sku: "PLG-BK-000014", synopsis: "Edición de prueba del contrato real.", subtitle: null, coverSourceUrl: null });
    }
    if (path === "/me/favorites/status") return ok(url.searchParams.getAll("editionIds").map((editionId) => ({ editionId, favorite: saved.has(editionId) })));
    if (path === "/me/favorites") return ok({ items: editions.filter((book) => saved.has(book.editionId)).map((book) => ({ ...book, favoritedAt: "2026-10-01T12:00:00Z" })), page: 0, pageSize: 20, totalCount: String(saved.size) });
    if (path.startsWith("/me/favorites/") && method === "DELETE") { commands.push({ method, path, body }); saved.delete(path.split("/").at(-1)!); return route.fulfill({ status: 204 }); }
    if (path.startsWith("/me/favorites/") && method === "PUT") { commands.push({ method, path, body }); saved.add(path.split("/").at(-1)!); return route.fulfill({ status: 204 }); }
    if (path === "/cart") return ok({ cartId: quantities.size ? "40" : null, state: quantities.size ? "ACTIVE" : null, requiresPhysicalFulfillment: quantities.size > 0, physicalItemCount: quantities.size, digitalItemCount: 0, items: [...quantities].map(([id, quantity]) => ({ cartItemId: id, editionId: id, title: editions.find((book) => book.editionId === id)!.title, authors: "Autor de prueba", sku: id, coverUrl: null, requiresPhysicalFulfillment: true, quantityEditable: true, quantity, currentPrice: "20.00", currentSubtotal: "20.00", available: true, unavailabilityReason: null })), totalCurrent: quantities.size ? "20.00" : "0.00" });
    if (path === "/cart/items" && method === "POST") {
      commands.push({ method, path, body });
      if (outcome !== "unconfirmed") quantities.set(body.editionId, (quantities.get(body.editionId) ?? 0) + 1);
      if (outcome !== "ok") return route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ code: "SERVICE_UNAVAILABLE", title: "No pudimos confirmar", detail: "Respuesta perdida.", status: 503 }) });
      return ok({ cartId: "40", cartItemId: body.editionId, quantity: quantities.get(body.editionId) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { commands };
}

for (const scheme of ["light", "dark"] as const) {
  test(`BookCard production ${scheme}: responsive grid, complete cover, identity and targets`, async ({ page }) => {
    test.setTimeout(120_000);
    await install(page, scheme);
    // The Home presents books as reading scenes and Favoritos as a reading list; BookCard's route is the catalog.
    for (const route of ["/catalog?que=lectura"]) {
      await page.goto(route);
      await expect(page.locator("[data-bookcard]")).toHaveCount(route === "/" ? 4 : 12);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 375, 390, 768, 992, 1024, 1200, 1408, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        const metrics = await page.locator(".edition-grid").evaluate((grid) => ({
          columns: grid.getAttribute("data-presentation") === "rail" ? grid.children.length : getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          gap: parseFloat(getComputedStyle(grid).columnGap),
          cardWidth: grid.firstElementChild!.getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth - innerWidth,
          cards: [...grid.querySelectorAll<HTMLElement>("[data-bookcard]")].map((card) => ({
            ratio: card.querySelector("[data-bookcard-cover]")!.getBoundingClientRect().width / card.querySelector("[data-bookcard-cover]")!.getBoundingClientRect().height,
            // Browse card: the favorite sits on the cover stage's top-right corner, outside the product link; no cart action.
            favoriteOnStage: (() => {
              const favorite = card.querySelector("[data-bookcard-favorite]")!.getBoundingClientRect();
              const stage = card.querySelector("[data-bookcard-shelf]")!.getBoundingClientRect();
              return favorite.top >= stage.top && favorite.right <= stage.right && stage.right - favorite.right <= 12 && favorite.top - stage.top <= 12;
            })(),
            favoriteOutsideLink: card.querySelector("[data-bookcard-link] [data-bookcard-favorite]") === null,
            cartActions: card.querySelectorAll("[data-bookcard-cart]").length,
            secondaryRows: card.querySelectorAll('[data-bookcard-detail-cue], [data-bookcard-credit]').length,
            badge: card.querySelector('[data-stockstatus]')!.getAttribute('data-variant'),
            stockOnCover: card.querySelector('[data-bookcard-cover] [data-stockstatus]') !== null,
            links: card.querySelectorAll("[data-bookcard-link]").length,
            titleTop: card.querySelector("[data-bookcard-title]")!.getBoundingClientRect().top,
            stockTop: card.querySelector("[data-bookcard-availability]")!.getBoundingClientRect().top,
            height: card.getBoundingClientRect().height,
            priceTop: card.querySelector("[data-bookcard-price]")!.getBoundingClientRect().top,
            commercialGap: card.querySelector("[data-bookcard-price]")!.getBoundingClientRect().top - card.querySelector("[data-bookcard-identity]")!.getBoundingClientRect().bottom,
            identityBounded: [...card.querySelectorAll<HTMLElement>("[data-line-clamp]")].every((text) => { const lines = Number(getComputedStyle(text).webkitLineClamp); return lines >= 2 && lines <= 4 && text.clientHeight <= lines * parseFloat(getComputedStyle(text).lineHeight) + 1; }),
            clipped: [...card.querySelectorAll<HTMLElement>("[data-bookcard-price], [data-bookcard-availability], [data-bookcard-detail-cue]")].some((text) => text.scrollHeight > text.clientHeight || getComputedStyle(text).webkitLineClamp !== "none"),
            nestedButtons: card.querySelector("[data-bookcard-link] button") !== null,
            targets: [...card.querySelectorAll("button")].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
            fits: [...card.querySelectorAll("img")].every((img) => getComputedStyle(img).objectFit === "contain" && img.alt === ""),
          })),
        }));
        expect(metrics.overflow).toBe(0);
        // Catalog: the commerce shelf — 3 wide columns from 600px (beside the persistent filters on desktop), 2 on phones.
        expect(metrics.columns).toBe(route.startsWith("/catalog") ? width >= 600 ? 3 : 2 : width >= 992 ? 4 : width >= 768 ? 3 : 2);
        expect(metrics.gap).toBe(route.startsWith("/catalog") ? width >= 1200 ? 32 : width >= 920 ? 24 : width >= 600 ? 20 : width < 360 ? 12 : 16 : 16);
        if (width === 320) expect(metrics.cardWidth).toBe(route.startsWith("/catalog") ? 138 : 136);
        for (const card of metrics.cards) { expect(card.favoriteOnStage, `${route}, ${width}px, favorite placement`).toBe(true); expect(card.favoriteOutsideLink).toBe(true); expect(card.cartActions).toBe(0); expect(card.secondaryRows).toBe(0); expect(card.badge).toBe("quiet"); expect(card.stockOnCover).toBe(false); expect(card.identityBounded).toBe(true); expect(card.clipped).toBe(false); expect(card.commercialGap).toBeLessThanOrEqual(16); expect(card.links).toBe(1); expect(card.nestedButtons).toBe(false); expect(card.ratio).toBeCloseTo(2 / 3, 2); expect(card.fits).toBe(true); for (const target of card.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); } }
        if ((route.startsWith("/catalog") || route === "/") && [320, 375, 768, 1024, 1200, 1440, 1920].includes(width)) {
          await page.locator(".edition-grid").screenshot({ path: `/tmp/pliego-${route === "/" ? "home" : "bookcard"}-${scheme}-${width}.png`, style: "header { visibility: hidden; }" });
        }
        for (let index = 0; index < metrics.cards.length; index += metrics.columns) {
          const row = metrics.cards.slice(index, index + metrics.columns);
          expect(Math.max(...row.map((card) => card.titleTop)) - Math.min(...row.map((card) => card.titleTop))).toBeLessThan(1);
          for (const key of ["height", "priceTop", "stockTop"] as const) {
            expect(Math.max(...row.map((card) => card[key])) - Math.min(...row.map((card) => card[key])), `${route}, ${width}px, ${key}`).toBeLessThan(1);
          }
        }
      }
    }
  });
}

test("BookCard: browse card — independent favorite on the stage and an accessible single-link route", async ({ page }) => {
  const api = await install(page, "dark");
  await page.goto("/catalog?que=lectura");
  const card = page.locator("[data-bookcard]").first();
  await expect(card.locator("[data-bookcard-favorite]")).toBeEnabled();
  // Buying happens on the edition page: the catalog card carries no cart action.
  await expect(card.locator("[data-bookcard-cart]")).toHaveCount(0);
  // Focus order: the product link, then its favorite.
  await card.locator("[data-bookcard-link]").focus(); await page.keyboard.press("Tab");
  await expect(card.locator("[data-bookcard-favorite]")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(card.getByRole("status")).toHaveText("Quitado de favoritos.");
  await expect(page).toHaveURL(/\/catalog\?que=lectura$/);
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(0);
  await card.locator("[data-bookcard-link]").click();
  await expect(page).toHaveURL(/\/catalog\/editions\/9000001\?from=/);
  await expect(page.getByRole("heading", { level: 1, name: "El extranjero" })).toBeVisible();
  await page.getByRole("link", { name: "Volver al catálogo" }).first().click();
  await expect(page).toHaveURL(/\/catalog\?que=lectura$/);
});

test("Card cart control (Favoritos) blocks an unconfirmed add without locking favorites or retrying the command", async ({ page }) => {
  const api = await install(page, "light", "unconfirmed");
  // The catalog card is browse-only; the shared cart control still serves Favoritos rows.
  await page.goto("/favorites"); const card = page.locator("[data-favorite-row]").first();
  await card.locator("[data-bookcard-cart]").click();
  await expect(card.getByRole("alert")).toHaveText("No pudimos confirmar el carrito. Consúltalo antes de volver a intentarlo.");
  await expect(card.locator("[data-bookcard-cart]")).toBeDisabled();
  await expect(card.locator("[data-bookcard-favorite]")).toBeEnabled();
  await expect(card.getByRole("link", { name: "Consultar carrito" })).toHaveAttribute("href", "/cart");
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
});

test("Card cart control (Favoritos) reconciles a lost add response from the cart read without another POST", async ({ page }) => {
  const api = await install(page, "light", "confirmed-after-loss");
  // The catalog card is browse-only; the shared cart control still serves Favoritos rows.
  await page.goto("/favorites"); const card = page.locator("[data-favorite-row]").first();
  await card.locator("[data-bookcard-cart]").click();
  await expect(card.getByRole("status")).toHaveText("Agregado al carrito.");
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`BookCard production ${scheme}: detail affordance, keyboard focus and 200% text`, async ({ page }) => {
    await install(page, scheme);
    await page.goto("/catalog");
    const card = page.locator("[data-bookcard]").first();
    const link = card.locator("[data-bookcard-link]");
    await expect(card.locator("[data-bookcard-detail-cue]")).toHaveCount(0);
    await expect(card.locator("[data-bookcard-title]")).toHaveCSS("text-decoration-line", "none");
    await expect(card.locator("[data-bookcard-cover-affordance]")).toHaveCount(0);
    const coverBefore = await card.locator("[data-bookcard-cover]").boundingBox();
    await link.hover();
    await expect.poll(async () => (await card.locator("[data-bookcard-cover]").boundingBox())!.y).toBeLessThan(coverBefore!.y);
    await page.mouse.move(0, 0);
    await link.focus();
    await page.keyboard.press("Tab");
    await expect(card.locator("[data-bookcard-favorite]")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset }))).toEqual({ width: "3px", offset: "4px" });
    await expect(card.locator("[data-bookcard-title]")).toHaveCSS("text-decoration-line", "underline");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const width of [320, 375, 768, 1024, 1200, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await page.locator(".edition-grid").evaluate((grid) => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...grid.querySelectorAll<HTMLElement>("[data-bookcard-price], [data-bookcard-availability], [data-bookcard-detail-cue]")].some((text) => text.scrollHeight > text.clientHeight || text.scrollWidth > text.clientWidth || getComputedStyle(text).webkitLineClamp !== "none"),
        columns: grid.getAttribute("data-presentation") === "rail" ? grid.children.length : getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        cards: [...grid.querySelectorAll<HTMLElement>("[data-bookcard]")].map((card) => ({
          height: card.getBoundingClientRect().height,
          tops: ["price", "availability"].map((part) => card.querySelector(`[data-bookcard-${part}]`)!.getBoundingClientRect().top),
        })),
        favoriteFits: [...grid.querySelectorAll<HTMLElement>('[data-bookcard-favorite]')].every((button) => { const box = button.getBoundingClientRect(); const card = button.closest('[data-bookcard]')!.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && box.right <= card.right + 0.5 && box.left >= card.left - 0.5; }),
        targets: [...grid.querySelectorAll("a, button")].map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
      }));
      expect(result.overflow, `200% text, ${width}px, horizontal overflow`).toBe(false);
      expect(result.clipped, `200% text, ${width}px, clipped commercial text`).toBe(false);
      expect(result.favoriteFits).toBe(true);
      for (let index = 0; index < result.cards.length; index += result.columns) {
        const row = result.cards.slice(index, index + result.columns);
        expect(Math.max(...row.map((card) => card.height)) - Math.min(...row.map((card) => card.height))).toBeLessThan(1);
        for (let part = 0; part < 2; part++) expect(Math.max(...row.map((card) => card.tops[part])) - Math.min(...row.map((card) => card.tops[part])), `200% text, ${width}px, ${["price", "availability"][part]}`).toBeLessThan(1);
      }
      for (const target of result.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/catalog\/editions\/9000001/);
  });

  test(`BookCard production ${scheme}: touch opens unavailable detail and toggles favorite`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const api = await install(page, scheme);
    await page.goto("/catalog");
    const card = page.locator("[data-bookcard]").nth(2);
    await expect(card.locator("[data-bookcard-title]")).toHaveCSS("text-decoration-line", "none");
    // Browse card: no cart action; an unavailable edition says so in its stock line and still opens its detail.
    await expect(card.locator("[data-bookcard-cart]")).toHaveCount(0);
    await expect(card.locator("[data-bookcard-availability]")).toContainText("No disponible");
    await card.locator("[data-bookcard-favorite]").tap();
    await expect(card.getByRole("status")).toHaveText("Quitado de favoritos.");
    expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(0);
    await card.locator("[data-bookcard-link]").tap();
    await expect(page).toHaveURL(/\/catalog\/editions\/9000003/);
    await expect(page.locator("main.detail-route [data-stockstatus-label]")).toHaveText("No disponible");
    await expect(page.locator("main.detail-route").getByText("Salamandra", { exact: true })).toBeVisible();
    await context.close();
  });
}

