import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
const immutableCoverPath = (url: string) => decodeURIComponent(new URL(`../../../covers/generated/r2-normalized${new URL(url).pathname}`, import.meta.url).pathname);

const widths = [320, 375, 390, 576, 767, 768, 991, 992, 1024, 1199, 1200, 1407, 1408, 1440, 1920];

async function openDiagnostic(page: Page) {
  await page.route("https://covers.pliegolibros.com/**", async (route) => {
    const url = new URL(route.request().url());
    const path = immutableCoverPath(route.request().url());
    if (!existsSync(path)) return route.abort();
    if (url.searchParams.has("bookcard-diagnostic")) await new Promise((resolve) => setTimeout(resolve, 1000));
    return route.fulfill({ path: immutableCoverPath(route.request().url()), contentType: "image/webp" });
  });
  await page.goto("/dev/theme");
  await page.locator("[data-bookcard-diagnostic]").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
}

async function choose(page: Page, field: string, option: string) {
  await page.getByRole("combobox", { name: field, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function columns(width: number) { return width >= 1408 ? 6 : width >= 1200 ? 5 : width >= 992 ? 4 : width >= 768 ? 3 : 2; }

for (const scheme of ["Light", "Dark"] as const) {
  test(`BookCard ${scheme}: approved grid, bounds, density and contrast`, async ({ page }) => {
    test.setTimeout(120_000);
    await openDiagnostic(page);
    await page.getByRole("radiogroup", { name: "Color scheme" }).getByText(scheme, { exact: true }).click();
    for (const dataset of ["Catálogo real · 12 ediciones", "Casos límite · 12 variaciones"]) {
      await choose(page, "Datos del diagnóstico", dataset);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        const grid = page.locator("[data-bookcard-grid]");
        await expect(grid.locator("[data-bookcard]")).toHaveCount(12);
        const geometry = await grid.evaluate((element) => {
          const cards = [...element.querySelectorAll<HTMLElement>("[data-bookcard]")];
          const measurements = cards.map((card) => {
            const cover = card.querySelector<HTMLElement>("[data-bookcard-cover]")!;
            const title = card.querySelector<HTMLElement>("[data-bookcard-title]")!;
            const actions = [...card.querySelectorAll<HTMLButtonElement>("button")];
            const box = card.getBoundingClientRect();
            return {
              ratio: cover.getBoundingClientRect().width / cover.getBoundingClientRect().height,
              coverTop: cover.getBoundingClientRect().top,
              titleTop: title.getBoundingClientRect().top,
              priceTop: card.querySelector("[data-bookcard-price]")!.getBoundingClientRect().top,
              actionTop: actions[0].getBoundingClientRect().top,
              titleHeight: title.getBoundingClientRect().height,
              titleLineHeight: parseFloat(getComputedStyle(title).lineHeight),
              targets: actions.map((action) => ({ width: action.getBoundingClientRect().width, height: action.getBoundingClientRect().height, name: action.getAttribute("aria-label") })),
              overflow: [...card.querySelectorAll<HTMLElement>("a, p, h3, button")].some((child) => child.scrollWidth > child.clientWidth + 1 || child.getBoundingClientRect().right > box.right + 1),
            };
          });
          const luminance = (color: string) => {
            // Canvas resolves both rgb() and opaque color-mix()/color(srgb ...) to sRGB bytes.
            const context = document.createElement("canvas").getContext("2d")!;
            context.fillStyle = color; context.fillRect(0, 0, 1, 1);
            const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
            return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
          };
          const contrast = (foreground: string, background: string) => {
            const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          };
          const card = cards[0];
          const background = (element: Element) => {
            let surface: Element | null = element;
            while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
            return getComputedStyle(surface!).backgroundColor;
          };
          const contrasts = [...card.querySelectorAll<HTMLElement>("h3, p")].map((text) => contrast(getComputedStyle(text).color, background(text)));
          const cart = card.querySelector<HTMLElement>("[data-bookcard-cart]")!;
          contrasts.push(contrast(getComputedStyle(cart).color, background(cart)));
          return { columns: getComputedStyle(element).gridTemplateColumns.split(" ").length, overflow: document.documentElement.scrollWidth - window.innerWidth, measurements, contrasts };
        });
        expect(geometry.columns, `${dataset} ${width}px`).toBe(columns(width));
        expect(geometry.overflow, `${dataset} ${width}px page overflow`).toBe(0);
        expect(Math.min(...geometry.contrasts)).toBeGreaterThanOrEqual(4.5);
        for (const card of geometry.measurements) {
          expect(card.ratio).toBeCloseTo(2 / 3, 2);
          expect(card.overflow, `${dataset} ${width}px card overflow`).toBe(false);
          // Titles wrap naturally; a four-line clamp only guards pathological lengths.
          expect(card.titleHeight).toBeLessThanOrEqual(card.titleLineHeight * 4 + 1);
          for (const target of card.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); expect(target.name).toBeTruthy(); }
        }
        for (let start = 0; start < 12; start += geometry.columns) {
          const row = geometry.measurements.slice(start, start + geometry.columns);
          for (const key of ["coverTop", "titleTop"] as const) expect(Math.max(...row.map((card) => card[key])) - Math.min(...row.map((card) => card[key]))).toBeLessThan(1);
          // Full content determines each card’s price/action positions.
        }
      }
    }
  });
}

test("BookCard: keyboard order, full names, separate actions and navigation", async ({ page }) => {
  await openDiagnostic(page);
  const first = page.locator("[data-bookcard]").first();
  const link = first.locator("[data-bookcard-link]");
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(first.locator("[data-bookcard-cart]")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first.getByRole("status")).toHaveText("Agregado al carrito.");
  await page.keyboard.press("Tab");
  await expect(first.locator("[data-bookcard-favorite]")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first.locator("[data-bookcard-favorite]")).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("status")).toHaveText("Agregado a favoritos.");
  await expect(page).toHaveURL(/\/dev\/theme$/);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  expect(await link.evaluate((element) => ({ visible: element.matches(":focus-visible"), width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset }))).toEqual({ visible: true, width: "3px", offset: "3px" });
  const duplicates = page.locator('[data-bookcard-diagnostic] [data-bookcard-link]').filter({ hasText: "Ecuaciones diferenciales y problemas con valores en la frontera" });
  await expect(duplicates).toHaveCount(2);
  await expect(duplicates.first()).toHaveAccessibleName("Ver edición: Ecuaciones diferenciales y problemas con valores en la frontera. Limusa Wiley, Rústica · Español");
  await expect(duplicates.last()).toHaveAccessibleName("Ver edición: Ecuaciones diferenciales y problemas con valores en la frontera. Pearson Educación, Rústica · Español");
  await expect(link).toHaveAccessibleDescription(/Albert Camus.*20,00/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/bookcard=9000001#bookcard-preview/);
  await expect(page.locator("#bookcard-preview-title")).toBeFocused();
  await expect(page.locator("[data-bookcard-preview]")).toContainText("Albert Camus");
  await page.goBack();
  await expect(page).toHaveURL(/\/dev\/theme$/);
});

test("BookCard: unavailable, unconfirmed favorites, pending, rejection and recovery", async ({ page }) => {
  await openDiagnostic(page);
  await choose(page, "Datos del diagnóstico", "Casos límite · 12 variaciones");
  const unavailable = page.locator("[data-bookcard]").nth(5);
  await expect(unavailable.locator("[data-bookcard-cart]")).toBeDisabled();
  await expect(unavailable.locator("[data-bookcard-favorite]")).toBeEnabled();
  await expect(unavailable.locator("[data-bookcard-link]")).not.toHaveAttribute("aria-disabled");
  await expect(unavailable.locator("[data-bookcard-cart]")).toHaveText("shopping_cart_offAgregar");
  await expect(page.locator("[data-bookcard-fallback]")).toHaveCount(3);
  await expect(page.locator("[data-bookcard-credit]")).toHaveCount(0);
  for (const scenario of ["Invitado · requiere sesión", "Administrador · acceso restringido", "Favoritos sin confirmar", "Comando pendiente", "Comando rechazado", "Carrito · resultado incierto"]) {
    await choose(page, "Escenario de acciones", scenario);
    const first = page.locator("[data-bookcard]").first();
    if (scenario === "Comando pendiente") await expect(first.locator("[data-bookcard-cart]")).toHaveAttribute("aria-busy", "true");
    if (scenario.startsWith("Administrador") || scenario === "Comando pendiente") {
      await expect(first.locator("[data-bookcard-cart]")).toBeDisabled(); await expect(first.locator("[data-bookcard-favorite]")).toBeDisabled();
      if (scenario === "Comando pendiente") {
        const cart = first.locator("[data-bookcard-cart]");
        // Playwright's disabled matcher includes aria-disabled; pending keeps native focusability.
        expect(await cart.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false);
        await cart.focus(); await expect(cart).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(first.locator("[data-bookcard-feedback]")).toHaveCount(0);
      }
    } else if (scenario === "Favoritos sin confirmar") {
      await expect(first.locator("[data-bookcard-favorite]")).toBeDisabled();
      await expect(first.locator("[data-bookcard-favorite]")).not.toHaveAttribute("aria-pressed");
      await expect(first.locator("[data-bookcard-cart]")).toBeEnabled();
    } else {
      await first.locator("[data-bookcard-cart]").click();
      await expect(first.locator("[data-bookcard-feedback]")).toBeVisible();
      if (scenario === "Comando rechazado") { await expect(first.locator("[data-bookcard-cart]")).toBeDisabled(); await expect(first.locator("[data-bookcard-availability]")).toContainText("No disponible"); }
      if (scenario.startsWith("Carrito")) { await expect(first.locator("[data-bookcard-cart]")).toBeDisabled(); await expect(first.getByRole("link", { name: "Consultar carrito" })).toHaveAttribute("href", "/cart"); }
    }
  }
});

test("BookCard: delayed and failed real images keep their reserved geometry", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://covers.pliegolibros.com/**", async (route) => {
    if (route.request().url().includes("000002-")) await gate;
    if (route.request().url().includes("000014-")) return route.abort();
    return route.fulfill({ path: immutableCoverPath(route.request().url()), contentType: "image/webp" });
  });
  await page.goto("/dev/theme", { waitUntil: "domcontentloaded" });
  const first = page.locator("[data-bookcard]").first();
  await first.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await expect(first.locator('[data-bookcard-cover]')).toHaveAttribute("aria-busy", "true");
  const measure = () => first.evaluate((card) => {
    const cover = card.querySelector('[data-bookcard-cover]')!.getBoundingClientRect();
    const title = card.querySelector('[data-bookcard-title]')!.getBoundingClientRect();
    return { width: cover.width, height: cover.height, titleOffset: title.top - card.getBoundingClientRect().top };
  });
  const before = await measure();
  await expect(first.locator(".mantine-Skeleton-root")).toBeVisible();
  await expect(page.locator("[data-bookcard]").nth(1).locator("[data-bookcard-fallback]")).toBeVisible();
  release();
  await expect(first.locator('[data-bookcard-cover]')).toHaveAttribute("aria-busy", "false");
  expect(await measure()).toEqual(before);
});

test("BookCard: Auto, touch, text expansion, 200% text and reduced motion", async ({ page }) => {
  await openDiagnostic(page);
  await page.getByRole("radiogroup", { name: "Color scheme" }).getByText("Auto", { exact: true }).click();
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", colorScheme);
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const grid = page.locator("[data-bookcard-grid]");
  await expect(grid.locator("[data-bookcard]")).toHaveCount(12);
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.locator('[data-bookcard-diagnostic]').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const first = page.locator("[data-bookcard]").first();
  await first.locator("[data-bookcard-title]").evaluate((element) => { element.textContent = "Título".repeat(50); });
  expect(await first.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await first.locator("[data-bookcard-cart]").click();
  await expect(first.getByRole("status")).toHaveText("Agregado al carrito.");
  const touch = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touchPage = await touch.newPage();
  await openDiagnostic(touchPage);
  await touchPage.locator("[data-bookcard-favorite]").first().tap();
  await expect(touchPage.locator("[data-bookcard-favorite]").first()).toHaveAttribute("aria-pressed", "true");
  await touch.close();
});
