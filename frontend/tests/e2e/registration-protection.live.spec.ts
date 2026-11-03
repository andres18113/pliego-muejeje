import { expect, test } from "@playwright/test";

/**
 * PPA-05 / ADR 0056 against the real stack: registration answers the same for a new and an existing address, and the
 * sixth attempt for one address within the hour is paused by the server (429 + Retry-After) — the page says when it
 * can be tried again, keeps what was typed and never says whether the address has an account.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";

test("registration is neutral for existing addresses and pauses after five attempts for one address", async ({ page, request }) => {
  const email = `registration-${Date.now()}@pliego.local`;
  const body = { email, password: "Lectura-segura-2026", firstNames: "Lectora", lastNames: "Protegida" };
  // The first attempt creates the account; the next four (an existing address) answer exactly the same.
  const answers = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request.post(`${api}/auth/register`, { data: body });
    answers.push({ status: response.status(), body: await response.json() });
  }
  expect(answers.every(answer => answer.status === 201)).toBe(true);
  expect(new Set(answers.map(answer => JSON.stringify(answer.body))).size).toBe(1);
  expect(answers[0].body).toEqual({ state: "PENDING_VERIFICATION" });

  await page.goto("/register");
  await page.getByLabel("Nombres", { exact: true }).fill(body.firstNames);
  await page.getByLabel("Apellidos", { exact: true }).fill(body.lastNames);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(body.password);
  const registration = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/register"));
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  const limited = await registration;
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);

  const notice = page.getByRole("alert");
  await expect(notice).toContainText("Demasiados intentos");
  await expect(notice).toContainText("Por seguridad pausamos la creación de cuentas desde aquí. Podrás volver a intentarlo");
  await expect(notice).not.toContainText(/ya (existe|tiene)|registrad/i);
  const paused = page.getByRole("button", { name: "En pausa" });
  await expect(paused).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Correo electrónico")).toHaveValue(email);
  // Pressing it again sends nothing while paused (forced: Playwright never clicks an aria-disabled control itself).
  let sent = 0;
  page.on("request", outgoing => { if (outgoing.url().endsWith("/api/v1/auth/register")) sent++; });
  await paused.click({ force: true });
  // The press brings the explanation back into focus instead of sending.
  await expect(notice).toBeFocused();
  await expect(notice).toContainText("Demasiados intentos");
  expect(sent).toBe(0);
});
