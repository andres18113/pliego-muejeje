import { expect, test, type Page, type Route } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

const token = "x".repeat(43);
async function installApi(page: Page, verify?: (route: Route) => Promise<void>) {
  const calls: { path: string; body: unknown }[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") return route.fulfill({ status: 204 });
    if (path.startsWith("/api/v1/auth/")) {
      calls.push({ path, body: request.postDataJSON() });
      if (path.endsWith("verify-email") && verify) return verify(route);
      if (path.endsWith("/register")) return route.fulfill({ status: 201, json: { userId: "1", customerId: "1", state: "PENDING_VERIFICATION" } });
      if (path.endsWith("resend-verification") || path.endsWith("forgot-password")) {
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ message: "Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir." }) });
      }
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    if (path.endsWith("/filter-options")) return route.fulfill({ json: { languages: [], minimumPrice: null, maximumPrice: null } });
    if (path.endsWith("/categories")) return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/catalog/editions/42") return route.fulfill({ json: {
      editionId: "42", bookId: "1", title: "El libro que buscabas", authors: [{ name: "Ana", order: 1 }],
      publisher: { name: "Editorial" }, isbn13: null, sku: "RETURN-42", price: "10.00", coverUrl: null,
      coverLicense: null, coverAttribution: null, coverSourceUrl: null, format: "PAPERBACK", language: "es",
      available: true, categories: [], pageCount: 100, subtitle: null, synopsis: null, publicationDate: null,
    } });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  return calls;
}

test("opening the verification link automatically returns to the guarded profile without signing in", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const calls = await installApi(page, async route => {
    await pending;
    await route.fulfill({ status: 204 });
  });
  const from = new URLSearchParams({ from: "/account" }).toString();
  await page.goto(`/verificar-correo?${from}#token=${token}`);
  await expect.poll(() => calls.length).toBe(1);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("heading", { name: "Verificando tu correo", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Estamos comprobando el enlace");
  await expect(page.getByRole("button", { name: "Verificar correo", exact: true })).toHaveCount(0);
  expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
  await page.waitForTimeout(1400);
  expect(new URL(page.url()).pathname).toBe("/verificar-correo");
  release();
  await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new URL("/account", page.url()).href);
  await expect(page.getByRole("heading", { name: /^Inicia sesión para / })).toBeVisible();
  expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
  const signIn = page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true });
  await expect(signIn).toHaveAttribute("href", `/sign-in?${from}`);
  await signIn.click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?${from}$`));
  expect(calls).toHaveLength(1);
});

for (const destination of [
  "/",
  "/catalog?que=historia&category=historia&language=es&minPrice=5.00&maxPrice=30.00&sort=PRICE_ASC&page=2#resultados",
  "/catalog/editions/42?from=%2Fcatalog%3Fque%3Dhistoria#descripcion",
]) {
  test(`successful verification automatically returns to ${destination}`, async ({ page }) => {
    const calls = await installApi(page);
    await page.goto(`/verificar-correo?${new URLSearchParams({ from: destination })}#token=${token}`);
    await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    await expect(page.getByRole("main")).toBeVisible();
    if (destination.startsWith("/catalog/editions/")) {
      await expect(page.getByRole("heading", { name: "El libro que buscabas", exact: true })).toBeVisible();
    }
    expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
  });
}

for (const destination of [undefined, "https://example.invalid/catalog", "//example.invalid/catalog", "/admin", "/sign-in?from=%2Faccount", "/verificar-correo", "/recuperar-contrasena"]) {
  test(`verification falls back to home for ${destination ?? "a missing destination"}`, async ({ page }) => {
    const calls = await installApi(page);
    const query = destination === undefined ? "" : `?${new URLSearchParams({ from: destination })}`;
    await page.goto(`/verificar-correo${query}#token=${token}`);
    await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL("/", page.url()).href);
    expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
  });
}

for (const destination of [
  "/catalog?que=historia&language=es&sort=PRICE_ASC#resultados",
  "/catalog/editions/42?from=%2Fcatalog%3Fque%3Dhistoria#descripcion",
]) {
  test(`header sign-in, registration and email request preserve ${destination}`, async ({ page }) => {
    const calls = await installApi(page);
    await page.goto(destination);
    const headerSignIn = page.getByTestId("site-header").getByRole("link", { name: "Iniciar sesión", exact: true });
    await expect(headerSignIn).toHaveAttribute("href", `/sign-in?${new URLSearchParams({ from: destination })}`);
    await headerSignIn.click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Crear cuenta", exact: true }).click();
    await page.getByLabel("Nombres", { exact: true }).fill("Ana María");
    await page.getByLabel("Apellidos", { exact: true }).fill("Pérez");
    await page.getByLabel("Correo electrónico", { exact: true }).fill("ana@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-registration-42");
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Revisa tu correo", exact: true })).toBeVisible();
    expect(calls[0]).toMatchObject({ path: "/api/v1/auth/register", body: { returnTo: destination } });
    await page.getByRole("main").getByRole("link", { name: "Reenviar verificación", exact: true }).click();
    await page.getByRole("button", { name: "Solicitar enlace de verificación", exact: true }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toEqual({ path: "/api/v1/auth/resend-verification", body: { email: "ana@example.invalid", returnTo: destination } });
    await page.goto(`/verificar-correo?${new URLSearchParams({ from: destination })}#token=${token}`);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    expect(calls.map(call => call.path)).toEqual(["/api/v1/auth/register", "/api/v1/auth/resend-verification", "/api/v1/auth/verify-email"]);
  });
}

test("verification returns to the guarded cart while preserving the sign-in intent", async ({ page }) => {
  const calls = await installApi(page);
  const destination = "/cart?source=verification#items";
  const from = new URLSearchParams({ from: destination }).toString();
  await page.goto(`/verificar-correo?${from}#token=${token}`);
  await expect(page).toHaveURL(new URL(destination, page.url()).href);
  await expect(page.getByRole("heading", { name: /^Inicia sesión para / })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true })).toHaveAttribute("href", `/sign-in?${from}`);
  expect(calls).toEqual([{ path: "/api/v1/auth/verify-email", body: { token } }]);
});

test("an expired verification link offers another link without automatic retries", async ({ page }) => {
  const calls = await installApi(page, route => route.fulfill({
    status: 400,
    contentType: "application/problem+json",
    body: JSON.stringify({ status: 400, title: "Enlace no válido", detail: "El enlace venció o ya fue utilizado.", code: "EMAIL_ACTION_INVALID" }),
  }));
  const from = new URLSearchParams({ from: "/account" }).toString();
  await page.goto(`/verificar-correo?${from}#token=${token}`);
  await expect(page.getByRole("heading", { name: "Este enlace ya no está disponible", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("El enlace venció o ya fue utilizado.");
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.waitForTimeout(1400);
  expect(new URL(page.url()).pathname).toBe("/verificar-correo");
  await page.getByRole("link", { name: "Solicitar otro enlace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reenviar verificación", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("from")).toBe("/account");
  expect(calls).toHaveLength(1);
});

test("a malformed verification link never submits a verification command", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto("/verificar-correo#token=incompleto");
  await expect(page.getByRole("heading", { name: "Falta el enlace del correo", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("link", { name: "Solicitar otro enlace", exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
});

for (const completion of ["earlier-first", "latest-first"] as const) {
  test(`a newer verification link survives the previous pending request (${completion})`, async ({ page }) => {
    const latestToken = "y".repeat(43);
    let releaseEarlier!: () => void;
    let releaseLatest!: () => void;
    const earlierPending = new Promise<void>(resolve => { releaseEarlier = resolve; });
    const latestPending = new Promise<void>(resolve => { releaseLatest = resolve; });
    const calls = await installApi(page, async route => {
      if (route.request().postDataJSON().token === token) {
        await earlierPending;
        await route.fulfill({ status: 204 });
      } else {
        await latestPending;
        await route.fulfill({ status: 204 });
      }
    });
    await page.goto(`/verificar-correo#token=${token}`);
    await expect.poll(() => calls.length).toBe(1);
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    // Simulate another mail link entering the existing SPA while the first request is pending.
    await page.evaluate(nextToken => {
      window.history.pushState({}, "", `/verificar-correo?from=%2Faccount#token=${nextToken}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, latestToken);
    await expect.poll(() => calls.length).toBe(2);
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    const earlierFinished = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/verify-email") && response.request().postDataJSON().token === token);
    if (completion === "earlier-first") {
      releaseEarlier();
      await earlierFinished;
      await expect(page.getByRole("heading", { name: "Verificando tu correo", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Este enlace ya no está disponible", exact: true })).toHaveCount(0);
      await page.waitForTimeout(1400);
      expect(new URL(page.url()).pathname).toBe("/verificar-correo");
      releaseLatest();
    } else {
      releaseLatest();
      await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
      releaseEarlier();
      await earlierFinished;
    }
    await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL("/account", page.url()).href);
    await expect(page.getByRole("heading", { name: /^Inicia sesión para / })).toBeVisible();
    expect(calls).toEqual([
      { path: "/api/v1/auth/verify-email", body: { token } },
      { path: "/api/v1/auth/verify-email", body: { token: latestToken } },
    ]);
  });
}

test("an older successful response cannot redirect away from the current invalid link", async ({ page }) => {
  const latestToken = "w".repeat(43);
  let releaseEarlier!: () => void;
  const pending = new Promise<void>(resolve => { releaseEarlier = resolve; });
  const calls = await installApi(page, async route => {
    if (route.request().postDataJSON().token === token) {
      await pending;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 400, contentType: "application/problem+json", body: JSON.stringify({ status: 400, title: "Enlace no válido", code: "EMAIL_ACTION_INVALID" }) });
  });
  await page.goto(`/verificar-correo?from=%2Fcatalog#token=${token}`);
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(nextToken => {
    window.history.pushState({}, "", `/verificar-correo?from=%2Faccount#token=${nextToken}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, latestToken);
  await expect(page.getByRole("heading", { name: "Este enlace ya no está disponible", exact: true })).toBeVisible();
  const earlierFinished = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/verify-email") && response.request().postDataJSON().token === token);
  releaseEarlier();
  await earlierFinished;
  await page.waitForTimeout(1400);
  expect(new URL(page.url()).pathname).toBe("/verificar-correo");
  await expect(page.getByRole("heading", { name: "Este enlace ya no está disponible", exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
});

test("reopening an uncertain verification link after another link never replays its command", async ({ page }) => {
  const nextToken = "z".repeat(43);
  const calls = await installApi(page, route => route.fulfill({
    status: 503,
  }));
  await page.goto(`/verificar-correo?from=%2Faccount#token=${token}`);
  await expect(page.getByRole("heading", { name: "No sabemos si se completó", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");

  await page.evaluate(candidate => {
    window.history.pushState({}, "", `/verificar-correo?from=%2Faccount#token=${candidate}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, nextToken);
  await expect.poll(() => calls.length).toBe(2);
  await expect(page.getByRole("heading", { name: "No sabemos si se completó", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");

  await page.evaluate(candidate => {
    window.history.pushState({}, "", `/verificar-correo?from=%2Faccount#token=${candidate}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, token);
  await expect(page.getByRole("heading", { name: "No sabemos si se completó", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("link", { name: "Solicitar otro enlace", exact: true })).toHaveAttribute("href", "/reenviar-verificacion?from=%2Faccount");
  await page.waitForTimeout(1400);
  expect(new URL(page.url()).pathname).toBe("/verificar-correo");
  expect(calls).toEqual([
    { path: "/api/v1/auth/verify-email", body: { token } },
    { path: "/api/v1/auth/verify-email", body: { token: nextToken } },
  ]);
});

test("sign-in exposes neutral resend and password recovery flows", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Reenviar verificación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reenviar verificación", exact: true })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByRole("button", { name: "Solicitar enlace de verificación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Si la cuenta cumple los requisitos" })).toBeVisible();
  await page.getByRole("link", { name: "Iniciar sesión", exact: true }).last().click();
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar contraseña", exact: true })).toBeVisible();
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByRole("button", { name: "Solicitar recuperación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Si la cuenta cumple los requisitos" })).toBeVisible();
  expect(calls.map(call => call.path)).toEqual(["/api/v1/auth/resend-verification", "/api/v1/auth/forgot-password"]);
});

test("recovery fragment leads to password reset without automatic sign-in", async ({ page }) => {
  const calls = await installApi(page);
  await page.goto(`/restablecer-contrasena#token=${token}`);
  await page.getByLabel("Nueva contraseña").fill("lecturaSegura123");
  await page.getByLabel("Confirma tu contraseña").fill("lecturaSegura123");
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await expect(page.getByRole("heading", { name: "Contraseña actualizada", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Inicia sesión con tu nueva contraseña.");
  expect(calls).toEqual([{ path: "/api/v1/auth/reset-password", body: { token, password: "lecturaSegura123" } }]);
});
