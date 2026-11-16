import { expect, test, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const profile = { customerId: "87", email: "lectora@example.invalid", firstNames: "Ana", lastNames: "Lectora", phone: null, state: "ACTIVE", version: "0" };
const article = { slug: "ebooks", categorySlug: "ebooks", title: "eBooks", summary: "Lectura digital", position: 1, applicability: "EBOOK", body: "Tus libros digitales." };
type State = { authenticated?: boolean; emailVerified?: boolean | null; anotherResource?: boolean };
async function mockStateApi(page: Page, state: State) {
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/auth/refresh") return state.authenticated
      ? json({ accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "100", email: profile.email, role: "CUSTOMER" } })
      : route.fulfill({ status: 204 });
    if (path === "/storefront/navigation") return json(storefrontNavigationFixture);
    if (path === "/me") return json({ ...profile, emailVerified: state.emailVerified });
    if (path === "/orders") return json({ items: [], page: 0, pageSize: 10, totalCount: "0" });
    if (path === "/cart") return json({ cartId: "7", state: "ACTIVE", requiresPhysicalFulfillment: false, physicalItemCount: 0, digitalItemCount: 0, items: [], totalCurrent: "0.00" });
    if (path === "/help/categories") return json({ items: [{ slug: "ebooks", title: "eBooks", position: 1, applicability: "EBOOK" }] });
    if (path === "/help/articles/ebooks") return json(article);
    if (path === "/help/articles") {
      const items = state.anotherResource ? [article, { ...article, slug: "descargas", title: "Descargar eBooks" }] : [article];
      return json({ items, page: 0, pageSize: Number(url.searchParams.get("pageSize") ?? 20), totalCount: String(items.length) });
    }
    return route.fulfill({ status: 404, json: {} });
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`PUB-02 an article closes on the other published topics at ${width}px`, async ({ page }) => {
    const state: State = { anotherResource: false };
    await mockStateApi(page, state);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ayuda/ebooks");
    await expect(page.getByRole("heading", { level: 1, name: "eBooks" })).toBeVisible();
    // The topic repeats the title, so it is not shown; with no other article there is nothing to list.
    await expect(page.getByRole("main").getByRole("link", { name: "eBooks", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Otros temas de Ayuda" })).toHaveCount(0);
    state.anotherResource = true;
    await page.reload();
    const onward = page.getByRole("navigation", { name: "Otros temas de Ayuda" });
    await expect(onward.getByRole("link", { name: "eBooks", exact: true })).toHaveCount(0);
    await onward.getByRole("link", { name: "Descargar eBooks" }).click();
    await expect(page).toHaveURL(/\/ayuda\/descargas$/);
    await page.screenshot({ path: test.info().outputPath(`related-help-${width}.png`), fullPage: true });
  });

  test(`Account verification follows explicit current-email state at ${width}px`, async ({ page }) => {
    const state: State = { authenticated: true };
    await mockStateApi(page, state);
    await page.setViewportSize({ width, height: 900 });
    for (const emailVerified of [true, false, undefined, null]) {
      state.emailVerified = emailVerified;
      await page.goto("/account");
      await page.reload();
      await expect(page.getByRole("region", { name: "Perfil y datos personales" })).toBeVisible();
      const resend = page.getByRole("link", { name: "Reenviar verificación de correo" });
      if (emailVerified === false) {
        await expect(resend).toBeVisible();
        await expect(resend).toHaveAttribute("href", "/reenviar-verificacion");
      } else await expect(resend).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`account-${String(emailVerified)}-${width}.png`), fullPage: true });
    }
  });

  test(`Orders empty surface is white and preserves its original geometry at ${width}px`, async ({ page }) => {
    await mockStateApi(page, { authenticated: true, emailVerified: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/orders");
    const empty = page.locator(".orders-empty");
    await expect(page.getByRole("heading", { name: "Aún no tienes pedidos." })).toBeVisible();
    const measure = () => empty.evaluate(element => {
      const style = getComputedStyle(element), heading = element.querySelector("h2")!, action = element.querySelector("a")!;
      const rect = element.getBoundingClientRect(), button = action.getBoundingClientRect();
      return { background: style.backgroundColor, padding: style.padding, gap: style.gap, radius: style.borderRadius,
        headingFont: getComputedStyle(heading).font, actionColor: getComputedStyle(action).backgroundColor,
        geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        action: { x: button.x, y: button.y, width: button.width, height: button.height } };
    });
    // Reproduce only the original declaration, then remove it; no source mutation.
    const original = await page.addStyleTag({ content: ".orders-empty { background: var(--acc-mist) !important; }" });
    const before = await measure();
    expect(before.background).not.toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: test.info().outputPath(`orders-original-${width}.png`), fullPage: true });
    await original.evaluate(element => element.parentNode?.removeChild(element));
    const after = await measure();
    expect(after.background).toBe("rgb(255, 255, 255)");
    expect({ ...after, background: before.background }).toEqual(before);
    await expect(empty.getByRole("link", { name: "Explorar el catálogo" })).toHaveAttribute("href", "/catalog");
    console.log("Orders surface", { width, originalBackground: before.background, correctedBackground: after.background });
    await page.screenshot({ path: test.info().outputPath(`orders-white-${width}.png`), fullPage: true });
  });
}
