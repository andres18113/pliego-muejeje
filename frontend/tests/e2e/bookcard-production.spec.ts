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
    if (path === "/cart") return ok({ cartId: quantities.size ? "40" : null, state: quantities.size ? "ACTIVE" : null, items: [...quantities].map(([id, quantity]) => ({ cartItemId: id, editionId: id, title: editions.find((book) => book.editionId === id)!.title, authors: "Autor de prueba", sku: id, coverUrl: null, quantity, currentPrice: "20.00", currentSubtotal: "20.00", available: true, unavailabilityReason: null })), totalCurrent: quantities.size ? "20.00" : "0.00" });
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
  test(`BookCard production ${scheme}: approved grid, complete cover, identity and targets`, async ({ page }) => {
    test.setTimeout(120_000);
    await install(page, scheme);
    for (const route of ["/catalog?que=lectura", "/", "/favorites"]) {
      await page.goto(route);
      await expect(page.locator("[data-bookcard]")).toHaveCount(route === "/" ? 8 : 12);
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
            actionAxis: (() => {
              const favorite = card.querySelector('[data-bookcard-favorite]')!.getBoundingClientRect();
              const cart = card.querySelector('[data-bookcard-cart]')!.getBoundingClientRect();
              return { centers: Math.abs(favorite.top + favorite.height / 2 - cart.top - cart.height / 2), gap: cart.left - favorite.right, leftToRight: favorite.left < cart.left, favoriteBorder: getComputedStyle(card.querySelector('[data-bookcard-favorite]')!).borderTopWidth };
            })(),
            cartTextVisible: getComputedStyle(card.querySelector('[data-bookcard-cart] .mantine-Button-label > span:last-child')!).display !== 'none',
            cartNeutral: !card.querySelector('[data-bookcard-cart]')!.hasAttribute('data-unavailable') || (getComputedStyle(card.querySelector('[data-bookcard-cart]')!).color === getComputedStyle(card.querySelector('[data-bookcard-identity] p')!).color && getComputedStyle(card.querySelector('[data-bookcard-cart]')!).backgroundColor === 'rgba(0, 0, 0, 0)'),
            cartText: card.querySelector('[data-bookcard-cart] .mantine-Button-label > span:last-child')!.textContent,
            cartIcon: card.querySelector('[data-bookcard-cart] .material-symbol')!.textContent,
            available: !card.querySelector('[data-bookcard-cart]')!.hasAttribute('data-unavailable'),
            secondaryRows: card.querySelectorAll('[data-bookcard-detail-cue], [data-bookcard-credit]').length,
            badge: card.querySelector('[data-stockstatus]')!.getAttribute('data-variant'),
            stockOnCover: card.querySelector('[data-bookcard-cover] [data-stockstatus]') !== null,
            links: card.querySelectorAll("[data-bookcard-link]").length,
            titleTop: card.querySelector("[data-bookcard-title]")!.getBoundingClientRect().top,
            stockTop: card.querySelector("[data-bookcard-availability]")!.getBoundingClientRect().top,
            actionTop: card.querySelector("[data-bookcard-actions]")!.getBoundingClientRect().top,
            height: card.getBoundingClientRect().height,
            priceTop: card.querySelector("[data-bookcard-price]")!.getBoundingClientRect().top,
            commercialGap: card.querySelector("[data-bookcard-price]")!.getBoundingClientRect().top - card.querySelector("[data-bookcard-identity]")!.getBoundingClientRect().bottom,
            identityBounded: [...card.querySelectorAll<HTMLElement>("[data-line-clamp]")].every((text) => getComputedStyle(text).webkitLineClamp === "2" && text.clientHeight <= 2 * parseFloat(getComputedStyle(text).lineHeight) + 1),
            clipped: [...card.querySelectorAll<HTMLElement>("[data-bookcard-price], [data-bookcard-availability], [data-bookcard-detail-cue]")].some((text) => text.scrollHeight > text.clientHeight || getComputedStyle(text).webkitLineClamp !== "none"),
            nestedButtons: card.querySelector("[data-bookcard-link] button") !== null,
            targets: [...card.querySelectorAll("button")].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
            fits: [...card.querySelectorAll("img")].every((img) => getComputedStyle(img).objectFit === "contain" && img.alt === ""),
          })),
        }));
        expect(metrics.overflow).toBe(0);
        expect(metrics.columns).toBe(route === "/" ? 8 : width >= 1408 ? 6 : width >= 1200 ? 5 : width >= 992 ? 4 : width >= 768 ? 3 : 2);
        expect(metrics.gap).toBe(route === "/" ? 24 : 16);
        if (width === 320) expect(metrics.cardWidth).toBe(route === "/" ? 208 : 136);
        for (const card of metrics.cards) { expect(card.actionAxis.centers).toBeLessThan(1); expect(card.actionAxis.leftToRight).toBe(true); expect(card.actionAxis.gap).toBeCloseTo(8, 0); expect(card.actionAxis.favoriteBorder).toBe("1px"); expect(card.cartTextVisible).toBe(true); expect(card.cartNeutral).toBe(true); expect(card.cartText).toBe("Agregar"); expect(card.cartIcon).toBe(card.available ? "add_shopping_cart" : "shopping_cart_off"); expect(card.secondaryRows).toBe(0); expect(card.badge).toBe("badge"); expect(card.stockOnCover).toBe(false); expect(card.identityBounded).toBe(true); expect(card.clipped).toBe(false); expect(card.commercialGap).toBeLessThanOrEqual(8); expect(card.links).toBe(1); expect(card.nestedButtons).toBe(false); expect(card.ratio).toBeCloseTo(2 / 3, 2); expect(card.fits).toBe(true); for (const target of card.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); } }
        if ((route.startsWith("/catalog") || route === "/") && [320, 375, 768, 1024, 1200, 1440, 1920].includes(width)) {
          await page.locator(".edition-grid").screenshot({ path: `/tmp/pliego-${route === "/" ? "home" : "bookcard"}-${scheme}-${width}.png`, style: "header { visibility: hidden; }" });
        }
        for (let index = 0; index < metrics.cards.length; index += metrics.columns) {
          const row = metrics.cards.slice(index, index + metrics.columns);
          expect(Math.max(...row.map((card) => card.titleTop)) - Math.min(...row.map((card) => card.titleTop))).toBeLessThan(1);
          for (const key of ["height", "priceTop", "stockTop", "actionTop"] as const) {
            expect(Math.max(...row.map((card) => card[key])) - Math.min(...row.map((card) => card[key])), `${route}, ${width}px, ${key}`).toBeLessThan(1);
          }
        }
      }
    }
  });
}

test("BookCard: independent actions, confirmed add and an accessible single-link route", async ({ page }) => {
  const api = await install(page, "dark");
  await page.goto("/catalog?que=lectura");
  const card = page.locator("[data-bookcard]").first();
  await expect(card.locator("[data-bookcard-favorite]")).toBeEnabled();
  await card.locator("[data-bookcard-link]").focus(); await page.keyboard.press("Tab");
  await expect(card.locator("[data-bookcard-favorite]")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(card.getByRole("status")).toHaveText("Quitado de favoritos.");
  await expect(page).toHaveURL(/\/catalog\?que=lectura$/);
  await page.keyboard.press("Tab");
  await expect(card.locator("[data-bookcard-cart]")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(card.getByRole("status")).toHaveText("Agregado al carrito.");
  await expect(card.locator("[data-bookcard-cart] .material-symbol")).toHaveText("check");
  await expect(card.locator("[data-bookcard-cart]")).toHaveAccessibleName("Agregado al carrito. Agregar otra unidad: El extranjero");
  await expect(card.locator("[data-bookcard-cart]")).toBeEnabled();
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
  await expect(card.locator("[data-bookcard-cart] .material-symbol")).toHaveText("add_shopping_cart");
  await card.locator("[data-bookcard-cart]").focus();
  await page.keyboard.press("Space");
  await expect(card.getByRole("status")).toHaveText("El carrito ahora tiene 2 unidades de esta edición.");
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(2);
  await card.locator("[data-bookcard-link]").click();
  await expect(page).toHaveURL(/\/catalog\/editions\/9000001\?from=/);
  await expect(page.getByRole("heading", { level: 1, name: "El extranjero" })).toBeVisible();
  await page.getByRole("link", { name: "Volver al catálogo" }).first().click();
  await expect(page).toHaveURL(/\/catalog\?que=lectura$/);
});

test("BookCard blocks an unconfirmed add without locking favorites or retrying the command", async ({ page }) => {
  const api = await install(page, "light", "unconfirmed");
  await page.goto("/catalog"); const card = page.locator("[data-bookcard]").first();
  await card.locator("[data-bookcard-cart]").click();
  await expect(card.getByRole("alert")).toHaveText("No pudimos confirmar el carrito. Consúltalo antes de volver a intentarlo.");
  await expect(card.locator("[data-bookcard-cart]")).toBeDisabled();
  await expect(card.locator("[data-bookcard-favorite]")).toBeEnabled();
  await expect(card.getByRole("link", { name: "Consultar carrito" })).toHaveAttribute("href", "/cart");
  expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
});

test("BookCard reconciles a lost add response from the cart read without another POST", async ({ page }) => {
  const api = await install(page, "light", "confirmed-after-loss");
  await page.goto("/catalog"); const card = page.locator("[data-bookcard]").first();
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
    await expect(card.locator("[data-bookcard-title]")).toHaveCSS("text-decoration-line", "underline");
    await page.mouse.move(0, 0);
    await expect(card.locator("[data-bookcard-cover-affordance]")).toHaveCSS("opacity", "0");
    await link.hover();
    const hover = await card.evaluate((element) => {
      const cue = element.querySelector('[data-bookcard-cover-affordance]')!.getBoundingClientRect();
      const cover = element.querySelector('[data-bookcard-cover]')!.getBoundingClientRect();
      return { area: cue.width * cue.height / (cover.width * cover.height), symbol: element.querySelector('[data-bookcard-cover-affordance] .material-symbol')!.textContent };
    });
    expect(hover.area).toBeLessThan(.08);
    expect(hover.symbol).toBe("visibility");
    await expect(card.locator("[data-bookcard-cover-affordance]")).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await link.focus();
    await page.keyboard.press("Tab");
    await expect(card.locator("[data-bookcard-favorite]")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset }))).toEqual({ width: "3px", offset: "3px" });
    await expect(card.locator("[data-bookcard-cover-affordance]")).toHaveCSS("opacity", "1");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const width of [320, 375, 768, 1024, 1200, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await page.locator(".edition-grid").evaluate((grid) => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...grid.querySelectorAll<HTMLElement>("[data-bookcard-price], [data-bookcard-availability], [data-bookcard-detail-cue]")].some((text) => text.scrollHeight > text.clientHeight || text.scrollWidth > text.clientWidth || getComputedStyle(text).webkitLineClamp !== "none"),
        columns: grid.getAttribute("data-presentation") === "rail" ? grid.children.length : getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        cards: [...grid.querySelectorAll<HTMLElement>("[data-bookcard]")].map((card) => ({
          height: card.getBoundingClientRect().height,
          tops: ["price", "availability", "actions"].map((part) => card.querySelector(`[data-bookcard-${part}]`)!.getBoundingClientRect().top),
        })),
        cartTextFits: [...grid.querySelectorAll<HTMLElement>('[data-bookcard-cart] .mantine-Button-label > span:last-child')].every((text) => text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 2),
        targets: [...grid.querySelectorAll("a, button")].map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
      }));
      expect(result.overflow).toBe(false);
      expect(result.clipped).toBe(false);
      expect(result.cartTextFits).toBe(true);
      for (let index = 0; index < result.cards.length; index += result.columns) {
        const row = result.cards.slice(index, index + result.columns);
        expect(Math.max(...row.map((card) => card.height)) - Math.min(...row.map((card) => card.height))).toBeLessThan(1);
        for (let part = 0; part < 3; part++) expect(Math.max(...row.map((card) => card.tops[part])) - Math.min(...row.map((card) => card.tops[part]))).toBeLessThan(1);
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
    await expect(card.locator("[data-bookcard-title]")).toHaveCSS("text-decoration-line", "underline");
    await expect(card.locator("[data-bookcard-cart]")).toBeDisabled();
    await expect(card.locator("[data-bookcard-cart]")).toHaveText("shopping_cart_offAgregar");
    await expect(card.locator("[data-bookcard-cart]")).toHaveAccessibleDescription(/No disponible/);
    await expect(card.locator("[data-bookcard-cart] .mantine-Button-label > span:last-child")).toBeVisible();
    const availableCard = page.locator("[data-bookcard]").first();
    await availableCard.locator("[data-bookcard-cart]").tap();
    await expect(availableCard.getByRole("status")).toHaveText("Agregado al carrito.");
    await card.locator("[data-bookcard-favorite]").tap();
    await expect(card.getByRole("status")).toHaveText("Quitado de favoritos.");
    expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
    await card.locator("[data-bookcard-link]").tap();
    await expect(page).toHaveURL(/\/catalog\/editions\/9000003/);
    await expect(page.locator(".detail-copy [data-stockstatus-label]")).toHaveText("No disponible");
    await expect(page.locator(".detail-copy").getByText("Salamandra", { exact: true })).toBeVisible();
    await context.close();
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`Home discovery rail ${scheme}: independent keyboard and touch actions reach detail`, async ({ page, browser }) => {
    const api = await install(page, scheme);
    await page.goto("/");
    await expect(page.locator('[data-presentation="rail"] [data-bookcard]')).toHaveCount(8);
    await expect(page.locator('.discovery-count')).toHaveCount(0);
    const card = page.locator('[data-bookcard]').first();
    await card.locator('[data-bookcard-link]').focus();
    await page.keyboard.press("Tab");
    await expect(card.locator('[data-bookcard-favorite]')).toBeFocused();
    await page.keyboard.press("Space");
    await expect(card.getByRole("status")).toHaveText("Quitado de favoritos.");
    await card.locator('[data-bookcard-cart]').focus();
    await page.keyboard.press("Space");
    await expect(card.getByRole("status")).toHaveText("Agregado al carrito.");
    expect(api.commands.filter((command) => command.path === "/cart/items")).toHaveLength(1);
    await expect(page).toHaveURL(/\/$/);
    await card.locator('[data-bookcard-link]').focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "El extranjero" })).toBeVisible();

    const context = await browser.newContext({ viewport: { width: 375, height: 844 }, hasTouch: true, isMobile: true });
    const touch = await context.newPage();
    await install(touch, scheme);
    await touch.goto("/");
    await expect(touch.locator('[data-bookcard]')).toHaveCount(8);
    const touchCard = touch.locator('[data-bookcard]').first();
    await touchCard.locator('[data-bookcard-favorite]').tap();
    await expect(touchCard.getByRole("status")).toHaveText("Quitado de favoritos.");
    await touchCard.locator('[data-bookcard-cart]').tap();
    await expect(touchCard.getByRole("status")).toHaveText("Agregado al carrito.");
    await touch.locator('[data-bookcard]').filter({ has: touch.locator('[data-bookcard-cart][data-unavailable]') }).first().locator('[data-bookcard-link]').tap();
    await expect(touch.locator('.detail-copy [data-stockstatus-label]')).toHaveText("No disponible");
    await context.close();
  });
}
