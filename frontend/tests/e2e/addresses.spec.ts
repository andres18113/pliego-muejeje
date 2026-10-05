import { expect, test, type Page, type Route } from "@playwright/test";

/** In-memory stand-in for the address endpoints of the v1 REST contract. */
class FakeAddresses {
  addresses: Record<string, unknown>[] = [
    { addressId: "15", alias: "Casa", recipient: "Ana Pérez", line1: "Av. Principal 123", line2: null, city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: null, reference: null, phone: "+59325550134", primary: true },
    { addressId: "16", alias: "Oficina", recipient: "Ana Pérez", line1: "Av. Amazonas 100", line2: "Piso 4", city: "Quito", province: "Pichincha", countryCode: "EC", postalCode: "170135", reference: "Edificio azul", phone: "+593991234567", primary: false },
  ];
  posts = 0;
  puts = 0;
  deletes = 0;
  rejectNextUpdate = false;

  async install(page: Page) {
    await page.route("**/api/v1/**", (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    const ok = (payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (path === "/auth/refresh") return route.fulfill({ status: 204 });
    if (path === "/auth/login") return ok({ accessToken: "e2e-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: "ana@example.com", role: "CUSTOMER" } });
    if (path === "/me" && method === "GET") return ok({ customerId: "100", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" });
    if (path === "/reference/countries") return ok([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]);
    if (path === "/me/addresses" && method === "GET") return ok(this.addresses);
    if (path === "/me/addresses" && method === "POST") {
      this.posts += 1;
      const addressId = String(20 + this.addresses.length);
      if (body.makePrimary) this.addresses.forEach((address) => { address.primary = false; });
      this.addresses.push({ line2: null, postalCode: null, reference: null, ...body, addressId, primary: Boolean(body.makePrimary) });
      return ok({ addressId }, 201);
    }
    const update = /^\/me\/addresses\/(\d+)$/.exec(path);
    if (update && method === "PUT") {
      if (this.rejectNextUpdate) {
        this.rejectNextUpdate = false;
        return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ type: "urn:pliego:problem:P2010", title: "Dirección no disponible", status: 409, detail: "No pudimos guardar esta dirección ahora.", code: "P2010", traceId: "e2e" }) });
      }
      this.puts += 1;
      Object.assign(this.addresses.find((address) => address.addressId === update[1])!, body);
      return route.fulfill({ status: 204 });
    }
    if (update && method === "DELETE") {
      this.deletes += 1;
      this.addresses = this.addresses.filter((address) => address.addressId !== update[1]);
      return route.fulfill({ status: 204 });
    }
    if (method === "GET") return ok([]);
    return route.fulfill({ status: 204 });
  }
}

async function openAddresses(page: Page) {
  await page.goto("/account/addresses");
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña").fill("lectura-segura");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Direcciones" })).toBeVisible();
}

/** Evidence for visual review, kept with the run's output. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("address editing opens over the list, guards typed data and returns focus", async ({ page }) => {
  const api = new FakeAddresses();
  await api.install(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAddresses(page);
  await shot(page, "desktop-list");

  // Edit: the form is presented at once, inside the viewport, with the list still behind it.
  const editOffice = page.getByRole("button", { name: "Editar Oficina" });
  await editOffice.click();
  const editor = page.getByRole("dialog", { name: "Editar Oficina" });
  await expect(editor).toBeVisible();
  await expect(page.locator("#address-form-heading")).toBeFocused();
  await expect(page.locator("#address-form-heading")).toBeInViewport({ ratio: 1 });
  await expect(editor.getByRole("button", { name: "Guardar dirección" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("heading", { level: 3, name: "Casa" })).toBeVisible();
  await expect(editor.getByLabel("Ciudad")).toHaveValue("Quito");
  await shot(page, "desktop-edit");

  // Keyboard: focus stays inside the editor.
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);
  }

  // Escape without changes closes and returns focus to the control that opened it.
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(editOffice).toBeFocused();

  // Leaving typed data asks in its own dialog; staying keeps the draft and returns to the field in use.
  await editOffice.click();
  await editor.getByLabel("Ciudad").fill("Cuenca");
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", { name: "¿Descartar los cambios?" });
  await expect(discard).toBeVisible();
  await expect(discard).toContainText("«Oficina»");
  await expect(discard.getByRole("button", { name: "Seguir editando" })).toBeFocused();
  await shot(page, "desktop-discard");
  await page.keyboard.press("Tab");
  await expect(discard.getByRole("button", { name: "Descartar cambios" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(discard.getByRole("button", { name: "Seguir editando" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(discard).toBeHidden();
  await expect(editor.getByLabel("Ciudad")).toHaveValue("Cuenca");
  await expect(editor.getByLabel("Ciudad")).toBeFocused();
  // Cancelar and the close button ask too.
  await editor.getByRole("button", { name: "Cancelar" }).click();
  await discard.getByRole("button", { name: "Seguir editando" }).click();
  await expect(editor.getByLabel("Ciudad")).toHaveValue("Cuenca");
  // So does the veil.
  await expect(discard).toBeHidden();
  await page.mouse.click(40, 400);
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Seguir editando" }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cerrar sin guardar" }).click();
  await discard.getByRole("button", { name: "Descartar cambios" }).click();
  await expect(discard).toBeHidden();
  await expect(editor).toBeHidden();
  await expect(editOffice).toBeFocused();
  expect(api.puts).toBe(0);

  // The country list closes on Escape without closing the editor.
  await editOffice.click();
  await expect(editor.getByLabel("Ciudad")).toHaveValue("Quito");
  await editor.getByRole("combobox", { name: "País de entrega", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Buscar país de entrega" })).toBeVisible();
  await shot(page, "desktop-country");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Buscar país de entrega" })).toBeHidden();
  await page.waitForTimeout(400);
  await expect(editor).toBeVisible();

  // Validation errors stay in the editor and are recoverable.
  await editor.getByLabel("Ciudad").fill("");
  await editor.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(editor.getByLabel("Ciudad")).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByLabel("Ciudad")).toBeFocused();
  await shot(page, "desktop-validation");
  expect(api.puts).toBe(0);

  // A server rejection is shown in the editor; the data stays for another attempt.
  api.rejectNextUpdate = true;
  await editor.getByLabel("Ciudad").fill("Cuenca");
  await editor.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(editor.getByRole("alert")).toBeInViewport({ ratio: 1 });
  await expect(editor.getByLabel("Ciudad")).toHaveValue("Cuenca");
  await shot(page, "desktop-server-error");
  await editor.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText("Guardamos los cambios de la dirección.")).toBeFocused();
  await expect(page.getByText("Cuenca, Pichincha, Ecuador")).toBeVisible();
  expect(api.puts).toBe(1);

  // Add uses the same editor; discarding its draft returns focus to the tile.
  const add = page.getByRole("button", { name: "Agregar dirección" });
  await add.click();
  const creator = page.getByRole("dialog", { name: "Nueva dirección" });
  await expect(page.locator("#address-form-heading")).toBeFocused();
  await creator.getByLabel("Ciudad").fill("Loja");
  await shot(page, "desktop-add");
  await creator.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("dialog", { name: "¿Descartar los cambios?" }).getByRole("button", { name: "Descartar cambios" }).click();
  await expect(creator).toBeHidden();
  await expect(add).toBeFocused();

  await add.click();
  await expect(creator.getByLabel("Ciudad")).toHaveValue("");
  await creator.getByLabel("Nombre de la dirección").fill("Taller");
  await creator.getByLabel("Dirección", { exact: true }).fill("Calle Larga 8");
  await creator.getByLabel("Ciudad").fill("Cuenca");
  await creator.getByLabel("Provincia").fill("Azuay");
  await creator.getByLabel("Teléfono de contacto").fill("0991234567");
  await creator.getByRole("button", { name: "Guardar dirección" }).click();
  await expect(creator).toBeHidden();
  await expect(page.getByText("Guardamos la dirección. Ya puedes elegirla al finalizar una compra.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Taller" })).toBeVisible();
  expect(api.posts).toBe(1);
  await shot(page, "desktop-after-add");
});

for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "small-phone", width: 320, height: 640 }]) {
  test(`the address editor is a full-height sheet on a ${viewport.name}`, async ({ page }) => {
    const api = new FakeAddresses();
    await api.install(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openAddresses(page);
    await shot(page, `${viewport.name}-list`);
    await page.getByRole("button", { name: "Editar Oficina" }).click();
    const editor = page.getByRole("dialog", { name: "Editar Oficina" });
    await expect(page.locator("#address-form-heading")).toBeFocused();
    const box = await editor.boundingBox();
    expect(box!.width).toBeCloseTo(viewport.width, 0);
    expect(box!.height).toBeCloseTo(viewport.height, 0);
    await expect(editor.getByRole("button", { name: "Guardar dirección" })).toBeInViewport({ ratio: 1 });
    await expect(editor.getByRole("button", { name: "Cerrar sin guardar" })).toBeInViewport({ ratio: 1 });
    expect(await noPageOverflow(page)).toBe(true);
    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await shot(page, `${viewport.name}-edit`);

    await editor.getByLabel("Ciudad").fill("");
    await editor.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(editor.getByLabel("Ciudad")).toBeFocused();
    await expect(editor.getByLabel("Ciudad")).toBeInViewport({ ratio: 1 });
    await shot(page, `${viewport.name}-validation`);

    await editor.getByRole("combobox", { name: "País de entrega", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Buscar país de entrega" })).toBeVisible();
    await shot(page, `${viewport.name}-country`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(editor).toBeVisible();

    await editor.getByLabel("Ciudad").fill("Ambato");
    await editor.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByText("Ambato, Pichincha, Ecuador")).toBeVisible();
  });
}

test("the address editor stays usable at 200% text", async ({ page }) => {
  const api = new FakeAddresses();
  await api.install(page);
  // 1280×720 zoomed to 200% lays out as 640×360 CSS pixels.
  await page.setViewportSize({ width: 640, height: 360 });
  await openAddresses(page);
  await page.getByRole("button", { name: "Editar Oficina" }).click();
  const editor = page.getByRole("dialog", { name: "Editar Oficina" });
  await expect(page.locator("#address-form-heading")).toBeFocused();
  await expect(page.locator("#address-form-heading")).toBeInViewport({ ratio: 1 });
  expect(await noPageOverflow(page)).toBe(true);
  expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await shot(page, "zoom200-edit");
  // The action row is not pinned here, so the fields keep the height; every control is still reachable.
  const save = editor.getByRole("button", { name: "Guardar dirección" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport({ ratio: 1 });
  await shot(page, "zoom200-actions");

  // A phone with the text size doubled.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Editar Oficina" }).click();
  await expect(page.locator("#address-form-heading")).toBeFocused();
  expect(await noPageOverflow(page)).toBe(true);
  expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await shot(page, "phone-text200-edit");
});

test("deleting an address asks in a dialog that names it and returns focus when kept", async ({ page }) => {
  const api = new FakeAddresses();
  await api.install(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAddresses(page);
  const remove = page.getByRole("button", { name: "Eliminar Oficina" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "¿Eliminar «Oficina»?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Av. Amazonas 100, Quito");
  await expect(confirm).toContainText("Los pedidos anteriores conservan los datos de entrega");
  await expect(confirm.getByRole("button", { name: "Conservar dirección" })).toBeFocused();
  // Nothing about the confirmation lives inside the card any more.
  await expect(page.locator(".account-address-row").getByText("Los pedidos anteriores")).toHaveCount(0);
  await shot(page, "desktop-delete");
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(remove).toBeFocused();
  expect(api.deletes).toBe(0);

  await page.keyboard.press("Enter");
  await expect(confirm.getByRole("button", { name: "Conservar dirección" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Eliminar dirección" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Eliminamos la dirección.")).toBeFocused();
  await expect(page.getByRole("heading", { level: 3, name: "Oficina" })).toHaveCount(0);
  expect(api.deletes).toBe(1);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Eliminar Casa" }).click();
  const small = page.getByRole("dialog", { name: "¿Eliminar «Casa»?" });
  await expect(small.getByRole("button", { name: "Conservar dirección" })).toBeFocused();
  await expect(small.getByRole("button", { name: "Eliminar dirección" })).toBeInViewport({ ratio: 1 });
  expect(await noPageOverflow(page)).toBe(true);
  expect(await small.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await shot(page, "phone-text200-delete");
});

test("a small address collection sits centered and fills out as it grows", async ({ page }) => {
  const api = new FakeAddresses();
  api.addresses = api.addresses.slice(0, 1);
  await api.install(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAddresses(page);
  const objects = page.locator(".account-address-row, button[aria-label='Agregar dirección']");
  const offCenter = async () => {
    const boxes = await objects.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((box) => ({ left: box.left, right: box.right, top: box.top })));
    const firstRow = boxes.filter((box) => Math.abs(box.top - boxes[0].top) < 2);
    return { perRow: firstRow.length, delta: Math.abs((firstRow[0].left + firstRow.at(-1)!.right) / 2 - 640) };
  };
  await expect(objects).toHaveCount(2);
  expect(await offCenter()).toMatchObject({ perRow: 2 });
  expect((await offCenter()).delta).toBeLessThanOrEqual(1);
  await shot(page, "layout-one-address");

  for (const alias of ["Oficina", "Taller", "Estudio"]) {
    api.addresses.push({ ...api.addresses[0], addressId: String(30 + api.addresses.length), alias, primary: false });
  }
  // Leaving and returning reads the list again.
  for (const [name, url] of [["Perfil", /\/account$/], ["Direcciones", /\/account\/addresses$/]] as const) {
    await page.getByRole("button", { name: "Menú de cuenta" }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await expect(objects).toHaveCount(5);
  expect(await offCenter()).toMatchObject({ perRow: 3 });
  expect((await offCenter()).delta).toBeLessThanOrEqual(1);
  await shot(page, "layout-four-addresses");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await offCenter()).toMatchObject({ perRow: 1 });
  expect(await noPageOverflow(page)).toBe(true);
});
