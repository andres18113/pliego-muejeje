import { expect, test } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

for (const width of [320, 1280]) {
  test(`profile name rejection keeps Cancel clickable and Save correct at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let profile = { customerId: "2", firstNames: "Ana", lastNames: "Pérez", email: "ana@example.invalid", phone: "+593991234567", state: "ACTIVE", version: "0", emailVerified: true };
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace("/api/v1", "");
      if (path === "/auth/refresh") return route.fulfill({ json: { accessToken: "synthetic-profile-feedback", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
      if (path === "/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
      if (path === "/me/billing-identity") return route.fulfill({ status: 204 });
      if (path === "/me" && request.method() === "PATCH") {
        const body = request.postDataJSON(); writes.push(body);
        profile = { ...profile, [body.field]: body.value, version: "1" };
        return route.fulfill({ status: 204 });
      }
      if (path === "/me") return route.fulfill({ json: profile });
      return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
    });

    await page.goto("/account");
    for (const [label, value] of [["nombres", "Ana"], ["apellidos", "Ana María"]]) {
      const edit = page.getByRole("button", { name: `Editar ${label}`, exact: true });
      await edit.click();
      const form = page.getByRole("form", { name: `Editar ${label}` }), input = form.getByRole("textbox");
      await input.fill(""); await input.pressSequentially(`${value}1`);
      await expect(input).toHaveValue(value);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(form.locator(".field-error:visible")).toHaveCount(1);
      // A real pointer click blurs the input before mouseup. Clearing its error
      // during blur used to move this button and swallow the click on mobile.
      await form.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(edit).toBeFocused();
      expect(writes).toHaveLength(0);
    }

    await page.getByRole("button", { name: "Editar apellidos", exact: true }).click();
    const surname = page.getByRole("form", { name: "Editar apellidos" });
    await expect(surname.getByRole("textbox")).toHaveValue("Pérez");
    await expect(surname.locator(".field-error")).toHaveCount(0);
    await expect(surname.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
    await surname.getByRole("button", { name: "Cancelar", exact: true }).click();

    await page.getByRole("button", { name: "Editar nombres", exact: true }).click();
    const form = page.getByRole("form", { name: "Editar nombres" }), input = form.getByRole("textbox");
    await expect(input).toHaveValue("Ana");
    await input.fill("Ana María");
    await input.press("End"); await input.pressSequentially("1");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.press("Tab");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Guardamos tus nombres." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar nombres", exact: true })).toBeFocused();
    expect(writes).toEqual([{ field: "firstNames", value: "Ana María", expectedVersion: "0" }]);
  });
}

for (const width of [320, 768, 1280]) for (const theme of ["light", "dark"]) {
  test(`profile feedback has one field error and distinct draft state at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem("mantine-color-scheme-value", value), theme);
    let profile = { customerId: "2", firstNames: "Ana", lastNames: "Pérez", email: "ana@example.invalid", phone: "+593991234567", state: "ACTIVE", version: "0", emailVerified: true };
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace("/api/v1", "");
      if (path === "/auth/refresh") return route.fulfill({ json: { accessToken: "synthetic-profile-feedback", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
      if (path === "/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
      if (path === "/me/billing-identity") return route.fulfill({ status: 204 });
      if (path === "/me/email" && request.method() === "PUT") {
        writes.push({ path, body: request.postDataJSON() });
        return route.fulfill({ status: 400, json: { code: "CURRENT_PASSWORD_INVALID", title: "Contraseña incorrecta", detail: "La contraseña actual no es correcta." } });
      }
      if (path === "/me" && request.method() === "PATCH") {
        const body = request.postDataJSON(); writes.push({ path, body });
        profile = { ...profile, [body.field]: body.value, version: "1" };
        return route.fulfill({ status: 204 });
      }
      if (path === "/me") return route.fulfill({ json: profile });
      if (path === "/cart") return route.fulfill({ json: { cartId: "1", state: "ACTIVE", items: [], requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, totalCurrent: "0.00", originalSubtotal: "0.00", savingsTotal: "0.00", currentSubtotal: "0.00", subtotal: "0.00", taxRate: "0.00", taxAmount: "0.00", shippingAmount: "0.00", total: "0.00" } });
      return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
    });

    await page.goto("/account");
    await page.getByRole("button", { name: "Editar correo electrónico", exact: true }).click();
    const email = page.getByRole("form", { name: "Cambiar correo electrónico" });
    await expect(email.getByText("Te enviaremos un enlace para verificar el nuevo correo.")).toBeVisible();
    await expect(email.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
    await email.getByLabel("Nuevo correo").fill("nueva@example.invalid");
    await email.getByLabel("Contraseña actual").fill("synthetic-incorrect-password");
    await email.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(email.getByLabel("Contraseña actual")).toHaveAttribute("aria-invalid", "true");
    await expect(email.locator(".field-error:visible")).toHaveCount(1);
    await expect(email.getByRole("group", { name: "Acciones de edición" }).getByRole("status")).toContainText("Cambios sin guardar");
    await expect(email.locator("details")).not.toHaveAttribute("open");
    await page.screenshot({ path: `/tmp/pliego-ihc-email-${width}-${theme}.png`, fullPage: true });
    await email.getByText("Seguridad del cambio", { exact: true }).click();
    await expect(email.getByText(/Cuando tu sesión termine/)).toBeVisible();
    await email.locator("summary").press("Enter");
    await expect(email.locator("details")).not.toHaveAttribute("open");
    expect(writes.filter(write => write.path === "/me/email")).toHaveLength(1);
    await email.getByRole("button", { name: "Cancelar", exact: true }).click();

    await page.getByRole("button", { name: "Editar teléfono", exact: true }).click();
    const phone = page.getByRole("form", { name: "Editar teléfono" }), number = phone.getByLabel("Teléfono", { exact: true });
    await number.fill("93141");
    await expect(number).not.toHaveAttribute("aria-invalid", "true");
    await number.press("Tab");
    await expect(number).toHaveAttribute("aria-invalid", "true");
    await number.fill("93141a");
    await expect(number).toHaveValue("93141");
    await expect(phone.locator(".field-error:visible")).toHaveCount(1);
    await expect(number).toHaveAccessibleDescription(/solo (dígitos|números)/);
    await expect(phone.getByText(/debe tener 9 dígitos/)).toHaveCount(0);
    await expect(phone.getByText(/Celular: 9 dígitos/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/pliego-ihc-phone-${width}-${theme}.png`, fullPage: true });
    await number.fill("998765432");
    await phone.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Guardamos tu teléfono." })).toBeVisible();
    expect(writes.filter(write => write.path === "/me")).toEqual([{ path: "/me", body: { field: "phone", value: "+593998765432", expectedVersion: "0" } }]);
  });
}
