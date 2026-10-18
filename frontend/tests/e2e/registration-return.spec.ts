import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Request } from "@playwright/test";

/** Uses the real loopback backend/JDBC/outbox/worker and the local Mailtrap inbox.
 * Start backend/src/test/postgres18/registration_return_http_gate.py --serve first.
 * No real identities, provider credentials, email delivery or production writes.
 */
test.skip(process.env.PLIEGO_REGISTRATION_FIXTURE !== "true", "Explicit disposable registration fixture required");
test.use({ baseURL: "http://127.0.0.1:5176", trace: "off", actionTimeout: 15_000, navigationTimeout: 20_000 });

test.beforeAll(async ({ request }) => {
  await expect.poll(async () => {
    try { return (await request.get("http://127.0.0.1:18088/v3/api-docs")).status(); }
    catch { return 0; }
  }, { timeout: 30_000 }).toBe(200);
});

async function fillRegistration(page: Page, email: string, password: string, phone: boolean) {
  await page.getByLabel("Nombres", { exact: true }).fill("Ana María");
  await page.getByLabel("Apellidos", { exact: true }).fill("Pérez");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  if (phone) {
    await page.getByRole("button", { name: "Añadir teléfono (opcional)" }).click();
    await page.getByLabel("Teléfono (opcional)", { exact: true }).fill("991234567");
  }
}

for (const width of [320, 390, 1280]) {
  test(`Real registration proof and cart return with/without optional phone at ${width}px`, async ({ page, request, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    for (const phone of [false, true]) {
      await context.clearCookies();
      const email = `browser-${width}-${randomUUID()}@example.invalid`;
      const password = randomUUID();
      const destination = "/cart?source=registration#items";
      const from = new URLSearchParams({ from: destination }).toString();
      await page.goto(`/register?${from}`);
      await fillRegistration(page, email, password, phone);
      const created = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/register") && response.status() === 201);
      await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      await created;
      await expect(page.getByRole("heading", { name: "Revisa tu correo", exact: true })).toBeVisible();
      await expect(page.getByRole("status")).toContainText("Verifica tu correo");
      await expect(page.getByText(/Después de verificarlo/)).toContainText("volver a tu carrito");
      expect(new URL(page.url()).pathname).toBe("/register");
      expect(new URL(page.url()).searchParams.get("from")).toBe(destination);
      await expect(page.getByRole("link", { name: "Reenviar verificación", exact: true })).toHaveAttribute("href", `/reenviar-verificacion?${from}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`confirmation-${width}-${phone ? "phone" : "no-phone"}.png`), fullPage: true });

      // Duplicate rejection must be genuine and must not replace or authenticate the account.
      await page.goto(`/register?${from}`);
      await fillRegistration(page, email.toUpperCase(), password, phone);
      const duplicate = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/register") && response.status() === 409);
      await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      await duplicate;
      await expect(page.getByRole("alert")).toContainText("Correo ya registrado");
      await expect(page.getByRole("alert")).toContainText("Ya existe una cuenta");
      await expect(page.getByRole("alert")).toBeFocused();
      await page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
      await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(password);
      const denied = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login") && response.status() === 403);
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await denied;
      await expect(page.getByRole("alert")).toContainText("Verifica tu correo");
      await expect(page.getByRole("link", { name: "Solicitar enlace de verificación" })).toHaveAttribute("href", `/reenviar-verificacion?${from}`);

      let mail: { text: string; state: string; receiptMatches: boolean } | undefined;
      await expect.poll(async () => {
        const response = await request.get(`http://127.0.0.1:18439/__fixture__/mail?${new URLSearchParams({ email })}`);
        const messages = await response.json() as { text: string; state: string; receiptMatches: boolean }[];
        mail = messages.at(-1);
        return Boolean(mail?.state === "SENT" && mail.receiptMatches);
      }).toBe(true);
      const url = mail!.text.match(/http:\/\/127\.0\.0\.1:5176\/verificar-correo[^\s]+/)?.[0];
      expect(url).toBeTruthy();
      expect(new URL(url!).searchParams.get("from")).toBe(destination);
      // Opening the delivered link automatically verifies the account without a second confirmation.
      let verificationRequests = 0;
      const countVerification = (request: Request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/auth/verify-email") verificationRequests += 1;
      };
      page.on("request", countVerification);
      const verified = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/verify-email") && response.status() === 204);
      await page.goto(url!);
      await verified;
      await expect(page.getByRole("heading", { name: "Correo verificado", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Verificar correo", exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(`http://127.0.0.1:5176${destination}`);
      // The original cart intent survives; verification does not authenticate the customer.
      await expect(page.getByRole("heading", { name: /^Inicia sesión para / })).toBeVisible();
      expect(verificationRequests).toBe(1);
      page.off("request", countVerification);
      const signIn = page.getByRole("main").getByRole("link", { name: "Iniciar sesión", exact: true });
      await expect(signIn).toHaveAttribute("href", `/sign-in?${from}`);
      await signIn.click();
      await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
      await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`http://127.0.0.1:5176${destination}`);
      await expect(page.getByRole("heading", { name: "Tu carrito está vacío.", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`authorized-cart-${width}-${phone ? "phone" : "no-phone"}.png`), fullPage: true });
    }
  });
}
