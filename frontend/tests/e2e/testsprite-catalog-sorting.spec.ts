import { expect, test } from "@playwright/test";

// Real local backend/PG18; opt-in isolated fixture, with no request interception.
test.skip(!process.env.PLIEGO_CATALOG_SORT_LIVE, "Requires the isolated Spanish catalog fixture and local backend");
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true, ignorePunctuation: true });

for (const width of [320, 390, 1280]) {
  test(`Spanish ordering preserves search, filters and pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const query = "que=Autora+orden+espa%C3%B1ol&category=catalog-spanish-fixture&productType=EBOOK&format=EBOOK&language=es&minPrice=10.00&maxPrice=10.00&pageSize=2";
    await page.goto(`/catalog?${query}`);
    const cards = page.locator("[data-bookcard-title]");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveText("2 lecciones");
    const before: string[] = [];
    const collectPages = async (result: string[]) => {
      for (let n = 0; n < 7; n++) {
        await expect(page.getByRole("navigation", { name: "Paginación del catálogo" }).getByText(`Página ${n + 1} de 7`, { exact: true })).toBeAttached();
        const titles = await cards.allTextContents();
        result.push(...titles);
        if (n < 6) {
          const changed = page.waitForResponse(response => response.url().includes("/catalog/editions?") && new URL(response.url()).searchParams.get("page") === String(n + 1) && response.status() === 200);
          await page.getByRole("link", { name: "Siguiente", exact: true }).click();
          await changed;
          await expect(page.getByRole("navigation", { name: "Paginación del catálogo" }).getByText(`Página ${n + 2} de 7`, { exact: true })).toBeAttached();
          await expect(cards.first()).not.toHaveText(titles[0]);
        }
      }
    };
    await collectPages(before);
    expect(before).toHaveLength(13);
    expect(before).toEqual([...before].sort(collator.compare));
    expect(before.indexOf("Análisis matemático")).toBeLessThan(before.indexOf("Anestesiología y medicina perioperatoria"));
    expect(before.indexOf("Nube")).toBeLessThan(before.indexOf("Ñandú"));
    expect(before.indexOf("Ñandú")).toBeLessThan(before.indexOf("Oceano"));
    await page.getByRole("combobox", { name: "Ordenar por" }).click();
    await page.getByRole("option", { name: "Título: Z–A", exact: true }).click();
    await expect(cards.first()).toHaveText("Oceano");
    const state = new URL(page.url()).searchParams;
    expect(state.get("sort")).toBe("TITLE_DESC");
    expect(state.has("page")).toBe(false);
    for (const [key, value] of new URLSearchParams(query)) expect(state.get(key)).toBe(value);
    const after: string[] = [];
    await collectPages(after);
    expect(after).toHaveLength(13);
    expect(after).toEqual([...before].sort((a, b) => collator.compare(b, a)));
    expect(new Set(after)).toEqual(new Set(before));
    await test.info().attach("catalog-order", { body: JSON.stringify({ width, ascending: before, descending: after, filteredUrl: page.url() }, null, 2), contentType: "application/json" });
    await page.reload();
    await expect(cards.first()).toHaveText("2 lecciones");
    await page.screenshot({ path: test.info().outputPath(`catalog-sort-${width}.png`), fullPage: true });
    await page.goBack();
    expect(new URL(page.url()).searchParams.get("sort")).toBe("TITLE_DESC");
  });
}
