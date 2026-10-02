import { expect, test, type Page } from "@playwright/test";
import manifest from "../../../covers/generated/manifest-normalized.json" with { type: "json" };

async function openDiagnostic(page: Page) {
  await page.route("https://covers.pliegolibros.com/**", (route) => {
    const book = manifest.records.find((record) => record.cover_url === route.request().url());
    return book ? route.fulfill({ path: decodeURIComponent(new URL(`../../../covers/${book.original_file}`, import.meta.url).pathname), contentType: "image/webp" }) : route.abort();
  });
  await page.goto("/dev/theme");
  await page.locator("[data-stockstatus-diagnostic]").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
}

for (const scheme of ["Light", "Dark"] as const) {
  test(`StockStatus ${scheme}: approved BookCard widths, scale, meaning and contrast`, async ({ page }) => {
    await openDiagnostic(page);
    await page.getByRole("radiogroup", { name: "Color scheme" }).getByText(scheme, { exact: true }).click();
    const section = page.locator("[data-stockstatus-diagnostic]");
    const grid = section.locator("[data-stockstatus-bookcards]");
    for (const width of [320, 375, 390, 768, 1024, 1200, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(grid.locator("[data-stockstatus]")).toHaveCount(12);
      await expect(grid.locator("[data-bookcard-cart][data-unavailable]")).toHaveCount(6);
      const metrics = await section.evaluate((element) => {
        const luminance = (color: string) => {
          // Canvas resolves both rgb() and opaque color-mix()/color(srgb ...) to sRGB bytes.
          const context = document.createElement("canvas").getContext("2d")!;
          context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
          return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
        };
        const statuses = [...element.querySelectorAll<HTMLElement>("[data-stockstatus]")];
        const contrast = (text: HTMLElement) => {
          let parent: HTMLElement | null = text;
          while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
          const foreground = luminance(getComputedStyle(text).color), background = luminance(getComputedStyle(parent!).backgroundColor);
          return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        };
        const grid = element.querySelector("[data-stockstatus-bookcards]")!;
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          sectionOverflow: element.scrollWidth - element.clientWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          cardWidth: grid.firstElementChild!.getBoundingClientRect().width,
          statuses: statuses.map((status) => {
            const label = status.querySelector<HTMLElement>("[data-stockstatus-label]")!;
            const icon = status.querySelector<HTMLElement>(".material-symbol")!;
            const explanation = status.querySelector<HTMLElement>("[data-stockstatus-explanation]");
            const box = status.getBoundingClientRect();
            return {
              size: status.dataset.size, label: label.textContent, font: getComputedStyle(label).fontSize,
              lineHeight: getComputedStyle(label).lineHeight, icon: icon.textContent,
              iconWidth: icon.getBoundingClientRect().width, iconHeight: icon.getBoundingClientRect().height,
              contrast: contrast(label), explanationContrast: explanation ? contrast(explanation) : null,
              overflow: status.scrollWidth > status.clientWidth + 1 || label.getBoundingClientRect().right > box.right + 1,
              explanationClamped: explanation ? getComputedStyle(explanation).webkitLineClamp !== "none" : false,
            };
          }),
        };
      });
      expect(metrics.overflow, `${width}px page`).toBe(0);
      expect(metrics.sectionOverflow).toBe(0);
      expect(metrics.columns).toBe(width >= 1408 ? 6 : width >= 1200 ? 5 : width >= 992 ? 4 : width >= 768 ? 3 : 2);
      if (width === 320) expect(metrics.cardWidth).toBe(136);
      for (const status of metrics.statuses) {
        expect(status.overflow).toBe(false);
        expect(status.contrast).toBeGreaterThanOrEqual(4.5);
        if (status.explanationContrast !== null) expect(status.explanationContrast).toBeGreaterThanOrEqual(4.5);
        expect(status.explanationClamped).toBe(false);
        expect(status.font).toBe(status.size === "compact" ? "12px" : "14px");
        expect(status.lineHeight).toBe(status.size === "compact" ? "16px" : "20px");
        expect(status.iconWidth).toBe(status.size === "compact" ? 16 : 20);
        expect(status.iconHeight).toBe(status.iconWidth);
        expect(status.icon).toBe(status.label === "Disponible" ? "check_circle" : "block");
      }
    }
    const cases = section.locator("[data-stockstatus-case]");
    for (const [index, explanation] of ["No hay existencias suficientes para esta cantidad.", "Esta edición ya no está a la venta.", "Este libro ya no está a la venta."].entries()) {
      for (const status of await cases.nth(index + 2).locator("[data-stockstatus]").all()) await expect(status.locator("[data-stockstatus-explanation]")).toHaveText(explanation);
    }
    await expect(section.locator('[data-stockstatus] .material-symbol:not([aria-hidden="true"])')).toHaveCount(0);
  });
}

test("StockStatus: informative semantics, keyboard order and one caller-owned announcement", async ({ page }) => {
  await openDiagnostic(page);
  const section = page.locator("[data-stockstatus-diagnostic]");
  await expect(section.locator('[data-stockstatus][tabindex], [data-stockstatus][role], [data-stockstatus][aria-live]')).toHaveCount(0);
  expect(await section.locator('[data-stockstatus-case="0"] [data-stockstatus]').first().ariaSnapshot()).toContain("Disponible");
  const insufficient = await section.locator('[data-stockstatus-case="2"] [data-stockstatus]').first().ariaSnapshot();
  expect(insufficient).toContain("No disponible"); expect(insufficient).toContain("No hay existencias suficientes para esta cantidad."); expect(insufficient).not.toContain("block");
  const lastCart = section.locator("[data-stockstatus-bookcards] [data-bookcard-cart]").last();
  // Last card is unavailable, so start from its still enabled favorite.
  await expect(lastCart).toBeDisabled();
  await section.locator("[data-stockstatus-bookcards] [data-bookcard-favorite]").last().focus();
  await page.keyboard.press("Tab");
  const button = section.getByRole("button", { name: "Simular cambio de disponibilidad" });
  await expect(button).toBeFocused();
  await expect(button).toHaveAccessibleDescription("Disponible");
  await page.keyboard.press("Space");
  await expect(section.locator("#stockstatus-surface-value [data-stockstatus-label]")).toHaveText("No disponible");
  await expect(button).toHaveAccessibleDescription("No disponible");
  await expect(section.getByRole("status")).toHaveText("Cien años de soledad: No disponible.");
  await expect(button).toBeFocused();
  await expect(section.getByRole("status")).toHaveCount(1);
});

test("StockStatus: narrow mobile and enlarged text retain full state and reasons", async ({ page }) => {
  await openDiagnostic(page);
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const section = page.locator("[data-stockstatus-diagnostic]");
  const result = await section.evaluate((element) => ({
    overflow: element.scrollWidth > element.clientWidth,
    statuses: [...element.querySelectorAll<HTMLElement>("[data-stockstatus]")].map((status) => ({
      overflow: status.scrollWidth > status.clientWidth,
      label: status.querySelector<HTMLElement>("[data-stockstatus-label]")!.textContent,
      font: getComputedStyle(status).fontSize,
      clipped: [...status.querySelectorAll<HTMLElement>("[data-stockstatus-label], [data-stockstatus-explanation]")].some((text) => text.scrollHeight > text.clientHeight || getComputedStyle(text).webkitLineClamp !== "none"),
    })),
  }));
  expect(result.overflow).toBe(false);
  for (const status of result.statuses) { expect(status.overflow).toBe(false); expect(status.clipped).toBe(false); expect(["24px", "28px"]).toContain(status.font); }
  await expect(section.locator('[data-stockstatus-case="2"] [data-stockstatus-explanation]')).toHaveCount(2);
});
