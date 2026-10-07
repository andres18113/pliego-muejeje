/** Global search: every suggested edition says whether it is a Libro, an eBook or an Audiolibro. */
import { expect, test } from "@playwright/test";
const ed = (i: number, title: string, authors: string, format: string) => ({ editionId: String(40 + i), bookId: String(i), title, authors, publisher: "Editorial Sur", isbn13: null, price: "18.50", coverUrl: null, coverLicense: null, coverAttribution: null, format, language: "es", available: true, ...(format === "AUDIOBOOK" ? { audioDurationSeconds: 3600, narrators: ["Ana"] } : format === "EBOOK" ? { ebookFileFormat: "EPUB" } : {}) });
const items = [ed(1, "50 experimentos imprescindibles para entender la psicología social", "Rodríguez, Armando (coord.); Morales Domínguez, José Francisco (coord.); Delgado, Naira (coord.)", "PAPERBACK"), ed(2, "Administración de proyectos de informática", "Toro López, Francisco J.", "EBOOK"), ed(3, "Alicia en el país de las maravillas", "Carroll, Lewis", "AUDIOBOOK"), ed(4, "Antropología de la religión", "Duch, Lluís", "HARDCOVER")];
for (const [name, w, h, zoom] of [["desktop", 1280, 800, false], ["phone", 390, 844, false], ["small200", 320, 640, true]] as const) test(`search results name each edition's medium (${name})`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mantine-color-scheme-value", "light"));
  await page.route("**/api/v1/**", route => { const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/refresh") return route.fulfill({ json: { accessToken: "t", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "u@example.com", role: "CUSTOMER" } } });
    if (url.pathname === "/api/v1/me") return route.fulfill({ json: { customerId: "100", email: "u@example.com", firstNames: "Usuario", lastNames: "Prueba", phone: null, state: "ACTIVE", version: "0" } });
    if (url.pathname === "/api/v1/cart") return route.fulfill({ json: { cartId: null, state: null, totalCurrent: "0.00", items: [] } });
    if (url.pathname.startsWith("/api/v1/catalog/editions")) return route.fulfill({ json: { items, page: 0, pageSize: Number(url.searchParams.get("pageSize") ?? url.searchParams.get("size") ?? 20), totalCount: "4" } });
    return route.fulfill({ json: { items: url.pathname === "/api/v1/catalog/editions" ? items : [], page: 0, pageSize: 20, totalCount: "4" } }); });
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/ayuda");
  if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Buscar libros en el catálogo" }).click();
  const dialog = page.getByRole("dialog", { name: "Buscar en el catálogo" });
  await dialog.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill("de");
  const rows = dialog.locator("ul a");
  await expect(rows).toHaveCount(4);
  // Each result names its medium from the edition's own format: the same quiet cue for all three, never a coloured row.
  const cues = await rows.evaluateAll(as => as.map(a => { const m = a.querySelector("[data-media]")!; const symbol = m.querySelector(".material-symbol")!.textContent!; return [m.getAttribute("data-media"), symbol, m.textContent!.replace(symbol, ""), getComputedStyle(a).backgroundColor]; }));
  expect(cues).toEqual([["PHYSICAL", "book_2", "Libro", "rgba(0, 0, 0, 0)"], ["EBOOK", "mobile", "eBook", "rgba(0, 0, 0, 0)"], ["AUDIOBOOK", "headphones", "Audiolibro", "rgba(0, 0, 0, 0)"], ["PHYSICAL", "book_2", "Libro", "rgba(0, 0, 0, 0)"]]);
  // Authors read as names: editorial role marks such as "(coord.)" are not shown.
  await expect(rows.first().locator("strong + span")).toHaveText("Rodríguez, Armando; Morales Domínguez, José Francisco; Delgado, Naira");
  // Keyboard: down from the field through the rows, up back to the field.
  await page.keyboard.press("ArrowDown"); await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await expect(dialog.getByRole("searchbox")).toBeFocused();
  await expect(dialog.getByRole("link", { name: /Ver todos los resultados de/ })).toHaveCount(1);
  await expect(dialog.getByText("4 ediciones", { exact: true })).toBeVisible();
  expect(await dialog.evaluate(el => [...el.querySelectorAll("ul a")].some(a => a.scrollWidth > a.clientWidth + 1)), "a result overflows").toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("search.png") });
});
