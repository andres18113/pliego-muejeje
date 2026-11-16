import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { verifyRegisteredEmail } from "./shared/verified-registration";

/**
 * ADR 0054/0055 against the real stack (disposable PostgreSQL 18 + backend + Vite): what an administrator does reaches
 * every open tab through the server-sent stream, with no reload — a new correction request, its approval, a payment
 * approval — and closing the decision notice in one tab acknowledges it on the server and closes it in the other.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";
const fixtureScript = fileURLToPath(new URL("../../../backend/src/test/postgres18/realtime_live_fixture.py", import.meta.url));
const fixture = <T,>(...args: string[]): T =>
  JSON.parse(execFileSync("python3", [fixtureScript, ...args], { env: { ...process.env, CHECKOUT_BASE_URL: api.replace(/\/api\/v1$/, "") }, stdio: ["ignore", "pipe", "pipe"] }).toString()) as T;

const cedulaRow = (page: Page) => page.locator("li").filter({ hasText: "Cédula o RUC" });

test("an administrator's decisions reach every open tab live, and one acknowledgment closes both", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const email = `realtime-${Date.now()}@pliego.local`;
  const password = "Lectura-segura-2026";
  expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Viva" } })).status()).toBe(201);
  verifyRegisteredEmail(email, api);
  const { orderId } = fixture<{ cedula: string; orderId: string }>("prepare", email);

  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto("/account");
  await first.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await first.getByLabel("Correo electrónico").fill(email);
  await first.getByLabel("Contraseña", { exact: true }).fill(password);
  await first.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(first.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  const second = await context.newPage();
  await second.goto(`/orders/${orderId}`);
  await expect(second.getByRole("heading", { level: 1, name: "Detalle del pedido" })).toBeVisible();
  const pendingHeadline = (await second.getByRole("heading", { level: 2 }).first().textContent())?.trim() ?? "";
  expect(pendingHeadline).not.toBe("");

  // 1. The customer's own request, filed elsewhere, appears in Mi perfil without a reload.
  const { requestId } = fixture<{ requestId: string }>("request", email);
  await expect(cedulaRow(first).getByText("En revisión")).toBeVisible({ timeout: 10_000 });

  // 2. A payment approval moves the open order page without a reload (the server decides the new state).
  fixture("approve-payment", orderId);
  await expect(second.getByRole("heading", { level: 2 }).first()).not.toHaveText(pendingHeadline, { timeout: 10_000 });

  // 3. The approval reaches both tabs; Mi perfil in the second tab too.
  await second.goto("/account");
  fixture("decide", requestId, "APPROVED");
  await expect(first.getByText(/Aprobamos tu corrección\. Tus próximas facturas/)).toBeVisible({ timeout: 10_000 });
  await expect(second.getByText(/Aprobamos tu corrección\. Tus próximas facturas/)).toBeVisible({ timeout: 10_000 });
  await expect(first.getByText(/Corregida según/)).toHaveCount(0);

  // 4. Closing it in one tab acknowledges it on the server; the other tab follows through the stream.
  await second.getByRole("button", { name: "Cerrar aviso de corrección aprobada" }).click();
  await expect(second.getByText(/Aprobamos tu corrección/)).toHaveCount(0);
  await expect(first.getByText(/Aprobamos tu corrección\. Tus próximas/)).toHaveCount(0, { timeout: 10_000 });

  // 5. A reload keeps it closed (durable acknowledgment), and the decision email was queued once.
  await first.reload();
  await expect(cedulaRow(first)).toBeVisible();
  await expect(first.getByText(/Aprobamos tu corrección/)).toHaveCount(0);
  const evidence = fixture<{ acknowledgments: number; decisionMails: number; customerEvents: string[] }>("evidence", email, requestId);
  expect(evidence.acknowledgments).toBe(1);
  expect(evidence.decisionMails).toBe(1);
  expect(evidence.customerEvents).toEqual(expect.arrayContaining(["identity.correction.created", "identity.correction.decided", "identity.correction.acknowledged", "order.changed"]));
  await context.close();
});
