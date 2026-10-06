import { expect, test, type Page } from "@playwright/test";

const address = { addressId: "15", alias: "Casa", recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null,
  city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134", primary: true };

async function installApi(page: Page) {
  let quantity = 2;
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/refresh") return json({ accessToken: "a11y-test", expiresInSeconds: 1800, user: { userId: "2", email: "ana@example.com", role: "CUSTOMER" } });
    if (path === "/api/v1/me") return json({ customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/api/v1/reference/countries") return json([{ code: "EC", name: "Ecuador" }]);
    if (path === "/api/v1/me/addresses" && request.method() === "GET") return json([address]);
    if (path === "/api/v1/me/addresses/15" && request.method() === "PUT") {
      writes.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/cart/items/100" && request.method() === "PUT") {
      const body = request.postDataJSON(); quantity = body.quantity;
      writes.push({ path, body }); return json({ cartId: "40", cartItemId: "100", quantity });
    }
    if (path === "/api/v1/cart") return json({ cartId: "40", state: "ACTIVE", requiresPhysicalFulfillment: true, physicalItemCount: 1, digitalItemCount: 0, items: [{ cartItemId: "100", editionId: "42", title: "Cien años de soledad", authors: "Gabriel García Márquez", sku: "PLG-42", coverUrl: null,
      requiresPhysicalFulfillment: true, quantityEditable: true, quantity, currentPrice: "18.50", currentSubtotal: (quantity * 18.5).toFixed(2), available: true, unavailabilityReason: null }], totalCurrent: (quantity * 18.5).toFixed(2) });
    return route.fulfill({ status: 404, contentType: "application/problem+json", body: JSON.stringify({ code: "NOT_FOUND", title: "Recurso no disponible" }) });
  });
  return writes;
}

async function enlargeText(page: Page) {
  // Resize the relevant rendered text itself, including fixed-pixel labels/inputs.
  // Snapshot computed sizes first so descendants do not multiply inherited scaling.
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>(
      "[data-quantity], [data-quantity] span, .address-form label, .address-form summary, .address-form summary span, .address-form input, .address-form .purchase-actions button",
    )];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * 2}px`; });
  });
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [375, 1280]) {
  test(`cart quantity is exposed and synchronized with keyboard changes at 200% text / ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = await installApi(page);
    await page.goto("/cart");
    const quantity = page.getByRole("combobox", { name: "Cantidad de Cien años de soledad" });
    await expect(quantity).toBeVisible(); await enlargeText(page);
    await expect(quantity).toHaveAttribute("data-quantity", "2");
    await quantity.focus(); await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option")).toHaveCount(10);
    await expect(page.getByRole("option", { name: "2" })).toHaveAttribute("aria-selected", "true");
    // Every choice is a comfortable target, also at enlarged text.
    expect(await page.getByRole("option").evaluateAll((options) => options.every((option) => option.getBoundingClientRect().height >= 44))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(quantity).toBeFocused();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await expect(page.getByText("Cantidad actualizada: 3 unidades.")).toBeVisible();
    await expect(quantity).toHaveAttribute("data-quantity", "3");
    await expect(quantity).toBeFocused();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter");
    await expect(page.getByText("Cantidad actualizada: 2 unidades.")).toBeVisible();
    await expect(quantity).toHaveAttribute("data-quantity", "2");
    await expect(quantity).toBeFocused();
    expect(writes.map((write) => write.body)).toEqual([{ quantity: 3 }, { quantity: 2 }]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`collapsed address errors reveal a labelled field and allow keyboard recovery at 200% text / ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = await installApi(page);
    await page.goto("/account/addresses");
    const edit = page.getByRole("button", { name: "Editar Casa" });
    await edit.focus(); await page.keyboard.press("Enter");
    const form = page.locator(".address-form");
    await expect(form).toBeVisible(); await enlargeText(page);
    const summary = form.locator("summary"), details = form.locator("details");
    await summary.focus(); await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    const postal = form.getByRole("textbox", { name: "Código postal", exact: true });
    await postal.focus(); await page.keyboard.insertText("123456789012345678901");
    await summary.focus(); await page.keyboard.press("Space");
    await expect(details).not.toHaveAttribute("open");
    const save = form.getByRole("button", { name: "Guardar dirección" });
    await save.focus(); await page.keyboard.press("Enter");
    const error = form.getByText("Usa como máximo 20 caracteres.", { exact: true });
    await expect(details).toHaveAttribute("open", "");
    await expect(postal).toBeVisible(); await expect(error).toBeVisible();
    // Error text is inserted only after validation; include it in the 200% resize.
    await error.evaluate((element: HTMLElement) => { element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; });
    await expect(postal).toHaveAttribute("aria-invalid", "true");
    await expect(postal).toHaveAccessibleName("Código postal");
    await expect(postal).toHaveAccessibleDescription("Usa como máximo 20 caracteres.");
    await expect(postal).toBeFocused();
    await expect(error).toBeInViewport();
    const session = await page.context().newCDPSession(page);
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const field = nodes.find((node) => !node.ignored && node.role?.value === "textbox" && node.name?.value === "Código postal");
    expect(field?.description?.value).toBe("Usa como máximo 20 caracteres.");
    expect(field?.properties?.find((property) => property.name === "invalid")?.value.value).toBe("true");
    await session.detach();
    const focusedBounds = await postal.boundingBox();
    expect(focusedBounds!.y).toBeGreaterThanOrEqual(0);
    expect(focusedBounds!.y + focusedBounds!.height).toBeLessThanOrEqual(1000);
    expect(writes).toHaveLength(0);
    await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("170101");
    await page.keyboard.press("Tab"); await expect(form.getByLabel("Referencia para la entrega")).toBeFocused();
    await page.keyboard.press("Tab"); await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ postalCode: "170101", line1: address.line1 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
