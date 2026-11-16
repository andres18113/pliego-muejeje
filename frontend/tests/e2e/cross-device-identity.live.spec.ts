import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, expect, test as base, type BrowserContext, type Page, type Request } from "@playwright/test";
import { verifyRegisteredEmail } from "./shared/verified-registration";

/**
 * Real PG18/API regression for mobile ADMIN → desktop CUSTOMER (ADR 0054/0055).
 * Run with PLIEGO_E2E_LIVE=1 and the PostgreSQL / PLIEGO_JWT_SECRET fixture environment.
 * Requires a desktop display (Linux CI: xvfb-run). The customer uses an isolated native Chromium and
 * connectOverCDP(noDefaults), because Playwright's normal focus emulation makes background tabs visible.
 * No patched dependencies, mocked business responses, synthetic visibility events, or fixture decisions.
 */
const env = process.env;
const api = (env.PLIEGO_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "") + "/api/v1";
const fixtureScript = fileURLToPath(new URL("../../../backend/src/test/postgres18/realtime_live_fixture.py", import.meta.url));
const fixture = <T,>(...args: string[]): T => JSON.parse(execFileSync("python3", [fixtureScript, ...args], {
  env: { ...env, CHECKOUT_BASE_URL: api.replace(/\/api\/v1$/, "") }, stdio: ["ignore", "pipe", "pipe"],
}).toString()) as T;
type Credentials = { email: string; password: string };
type Scenario = Credentials & { cedula: string; requestId: string; proposedNumber: string };
type Hint = { page: Page; event: string; data: string };

/** Count real HTTP requests until completion/cancellation, across ALL tabs, retaining every peak/URL. */
class StreamMonitor {
  readonly active = new Set<Request>();
  readonly urls: string[] = [];
  readonly hints: Hint[] = [];
  readonly history: { event: string; url: string; active: number }[] = [];
  peak = 0;
  constructor(context: BrowserContext) {
    context.on("request", request => {
      if (request.resourceType() !== "eventsource") return;
      this.urls.push(request.url());
      this.active.add(request);
      this.peak = Math.max(this.peak, this.active.size);
      this.history.push({ event: "request", url: request.url(), active: this.active.size });
    });
    const finish = (request: Request) => {
      if (this.active.delete(request)) this.history.push({ event: "finished-or-cancelled", url: request.url(), active: this.active.size });
    };
    context.on("requestfinished", finish);
    context.on("requestfailed", finish);
  }
  async observe(context: BrowserContext, page: Page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.eventSourceMessageReceived", message => {
      this.hints.push({ page, event: message.eventName, data: message.data });
    });
    return cdp;
  }
  async decided(requestId: string) {
    await expect.poll(() => this.hints.some(hint => hint.event === "identity.correction.decided"
      && JSON.parse(hint.data).resourceId === requestId), { timeout: 20_000, message: "the real decided SSE frame must arrive" }).toBe(true);
  }
}

const test = base.extend<{ customer: BrowserContext; streams: StreamMonitor; scenario: Scenario; mobileAdmin: Page }>({
  customer: async ({ baseURL }, use) => {
    const profile = mkdtempSync(join(tmpdir(), "pliego-cross-device-"));
    const native = spawn(chromium.executablePath(), ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
      "--disable-background-networking", "--window-size=1440,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const exited = new Promise<void>(resolve => native.once("exit", () => resolve()));
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    try {
      const portFile = join(profile, "DevToolsActivePort");
      await expect.poll(() => existsSync(portFile), { timeout: 20_000, message: "native desktop Chromium must start (requires DISPLAY)" }).toBe(true);
      const port = readFileSync(portFile, "utf8").split("\n")[0];
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
      const context = browser.contexts()[0];
      // connectOverCDP preserves real focus/visibility. Apply only navigation and assertion essentials.
      context.setDefaultTimeout(15_000);
      // Native contexts have no baseURL option; customer navigation below uses absolute URLs.
      expect(baseURL).toBeTruthy();
      await use(context);
    } finally {
      if (browser) await browser.close();
      native.kill("SIGTERM");
      await exited;
      rmSync(profile, { recursive: true, force: true });
    }
  },
  streams: async ({ customer }, use, testInfo) => {
    const monitor = new StreamMonitor(customer);
    await use(monitor);
    await testInfo.attach("customer-events-requests", { body: JSON.stringify({ peak: monitor.peak, urls: monitor.urls,
      history: monitor.history, hints: monitor.hints.map(({ event, data }) => ({ event, data })) }, null, 2), contentType: "application/json" });
    expect(monitor.urls.length, "exercise at least one real SSE request").toBeGreaterThan(0);
    expect(monitor.urls.every(url => url.endsWith("/api/v1/auth/events")), "every stream URL uses the complete API path").toBe(true);
    expect(monitor.peak, "at most one events HTTP request in flight per customer context throughout").toBe(1);
  },
  scenario: async ({ request }, use) => {
    const email = `cross-device-${crypto.randomUUID()}@pliego.local`;
    const password = `Disposable-${crypto.randomUUID()}`;
    expect((await request.post(`${api}/auth/register`, { data: { email, password, firstNames: "Lectora", lastNames: "Dispositivos" } })).status()).toBe(201);
    verifyRegisteredEmail(email, api);
    const { cedula } = fixture<{ cedula: string }>("prepare", email);
    const correction = fixture<{ requestId: string; proposedNumber: string }>("request", email);
    await use({ email, password, cedula, ...correction });
  },
  mobileAdmin: async ({ browser, baseURL }, use) => {
    const credentials = fixture<Credentials>("admin-login");
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    try {
      const page = await context.newPage();
      await login(page, credentials, new URL("/admin/correcciones", baseURL).href);
      // The real login deliberately lands administrators on their area overview.
      await page.getByRole("link", { name: "Correcciones de identificación", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Correcciones de identificación" })).toBeVisible();
      await use(page);
    } finally { await context.close(); }
  },
});

test.skip(!env.PLIEGO_E2E_LIVE, "Set PLIEGO_E2E_LIVE=1 to run against PostgreSQL and the live API.");
test.setTimeout(120_000);

async function login(page: Page, credentials: Credentials, destination: string) {
  await page.goto(destination);
  await page.getByRole("main").getByRole("link", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Correo electrónico").fill(credentials.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

async function profile(context: BrowserContext, streams: StreamMonitor, scenario: Scenario, baseURL: string) {
  const page = await context.newPage();
  await streams.observe(context, page);
  await login(page, scenario, new URL("/account", baseURL).href);
  await pending(page);
  await expect.poll(() => streams.hints.some(hint => hint.page === page && hint.event === "resync"), { timeout: 15_000 }).toBe(true);
  return page;
}
const identityRow = (page: Page) => page.locator("li").filter({ hasText: "Cédula o RUC" });
async function pending(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  await expect(identityRow(page).getByText("En revisión", { exact: true })).toBeVisible();
}
async function sameDocument(page: Page) {
  // A native object survives SPA updates but cannot survive a reload, even to the same URL.
  const handle = await page.evaluateHandle(() => document);
  return async () => {
    expect(await handle.evaluate(documentBefore => documentBefore === document), "the original customer document is preserved").toBe(true);
    await handle.dispose();
  };
}
const reason = "La documentación no permite confirmar este cambio. Presenta una copia legible de tu cédula.";
async function decide(admin: Page, scenario: Scenario, decision: "APPROVE" | "REJECT") {
  const card = admin.getByRole("listitem").filter({ hasText: scenario.email });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: decision === "APPROVE" ? "Aprobar" : "Rechazar", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: decision === "APPROVE" ? /¿Aprobar la corrección/ : /¿Rechazar la solicitud/ });
  await expect(dialog).toBeVisible();
  if (decision === "REJECT") await dialog.getByLabel("Motivo del rechazo").fill(reason);
  const response = admin.waitForResponse(r => r.url().endsWith(`/admin/billing-identity-corrections/${scenario.requestId}/decision`) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: decision === "APPROVE" ? "Aprobar corrección" : "Rechazar solicitud", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(admin.getByRole("status").filter({ hasText: decision === "APPROVE" ? "Aprobaste la corrección" : "Rechazaste la solicitud" })).toBeVisible();
}
async function approved(page: Page, scenario: Scenario) {
  await expect(page.getByText(/Aprobamos tu corrección\. Tus próximas facturas/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => identityRow(page).locator("p").first().evaluate(p => p.firstChild?.textContent?.trim())).toBe(scenario.proposedNumber);
  await expect(identityRow(page)).not.toContainText(scenario.cedula);
  await expect(identityRow(page).getByText("En revisión", { exact: true })).toHaveCount(0);
}
async function rejected(page: Page, scenario: Scenario) {
  await expect(page.getByText(/No aplicamos tu corrección a/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => identityRow(page).locator("p").first().evaluate(p => p.firstChild?.textContent?.trim())).toBe(scenario.cedula);
  await expect(identityRow(page).getByText("En revisión", { exact: true })).toHaveCount(0);
}

test("mobile ADMIN approves in the real UI; separate desktop Mi perfil shows notice and new number without reload", async ({ customer, streams, scenario, mobileAdmin, baseURL }) => {
  const page = await profile(customer, streams, scenario, baseURL!);
  const unchanged = await sameDocument(page);
  await page.bringToFront();
  await decide(mobileAdmin, scenario, "APPROVE");
  await streams.decided(scenario.requestId);
  await approved(page, scenario);
  await unchanged();
});

test("mobile ADMIN rejects with a reason; Mi perfil and the open identity request become the live rejection outcome", async ({ customer, streams, scenario, mobileAdmin, baseURL }) => {
  const page = await profile(customer, streams, scenario, baseURL!);
  const identity = await customer.newPage();
  await streams.observe(customer, identity);
  await identity.goto(new URL("/account/identity", baseURL).href);
  await expect(identity.getByRole("heading", { level: 2, name: "Solicitud de corrección", exact: true })).toBeVisible();
  const profileUnchanged = await sameDocument(page);
  const identityUnchanged = await sameDocument(identity);
  await decide(mobileAdmin, scenario, "REJECT");
  await streams.decided(scenario.requestId);
  await rejected(page, scenario);
  await expect(identity.getByRole("heading", { level: 2, name: "Revisamos tu solicitud", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(identity.getByText(reason, { exact: true })).toBeVisible();
  await expect(identity.getByRole("heading", { name: "Solicitud de corrección", exact: true })).toHaveCount(0);
  await profileUnchanged();
  await identityUnchanged();
});

test("Mi perfil receives the mobile decision while genuinely hidden behind another focused customer tab", async ({ customer, streams, scenario, mobileAdmin, baseURL }) => {
  const page = await profile(customer, streams, scenario, baseURL!);
  const unchanged = await sameDocument(page);
  const foreground = await customer.newPage();
  await foreground.goto("about:blank");
  await foreground.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
  await expect.poll(() => foreground.evaluate(() => document.hasFocus())).toBe(true);
  await decide(mobileAdmin, scenario, "APPROVE");
  await streams.decided(scenario.requestId);
  await approved(page, scenario);
  // Do not foreground the profile to trigger a refetch before verifying the decision.
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
  await unchanged();
});

test("a CDP-frozen SSE leader yields to visible Mi perfil, which updates from the mobile decision BEFORE thaw", async ({ customer, streams, scenario, mobileAdmin, baseURL }) => {
  const leader = await profile(customer, streams, scenario, baseURL!);
  const cdp = await customer.newCDPSession(leader);
  const follower = await customer.newPage();
  await streams.observe(customer, follower);
  await follower.goto(new URL("/account", baseURL).href);
  await pending(follower);
  const unchanged = await sameDocument(follower);
  await follower.bringToFront();
  await expect.poll(() => leader.evaluate(() => document.visibilityState)).toBe("hidden");
  expect(streams.active.size).toBe(1);
  expect([...streams.active][0].frame().page()).toBe(leader);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  try {
    await expect.poll(() => streams.hints.some(hint => hint.page === follower && hint.event === "resync"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => streams.active.size === 1 && [...streams.active][0].frame().page() === follower).toBe(true);
    expect(await follower.evaluate(() => document.visibilityState)).toBe("visible");
    await decide(mobileAdmin, scenario, "APPROVE");
    await streams.decided(scenario.requestId);
    await approved(follower, scenario);
    expect(await follower.evaluate(() => document.visibilityState)).toBe("visible");
    await unchanged();
  } finally {
    // Every decision/UI assertion above runs while the original leader remains frozen.
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
  }
  await approved(leader, scenario);
});

test("customer tabs keep at most one correctly pathed events request through online bursts and a mobile rejection", async ({ customer, streams, scenario, mobileAdmin, baseURL }) => {
  const leader = await profile(customer, streams, scenario, baseURL!);
  const follower = await customer.newPage();
  await streams.observe(customer, follower);
  await follower.goto(new URL("/account", baseURL).href);
  await pending(follower);
  const unchanged = await sameDocument(follower);
  // Waiting tabs must not bypass their lock when multiple online callbacks run.
  await Promise.all([leader, follower].map(page => page.evaluate(() => {
    for (let index = 0; index < 5; index++) window.dispatchEvent(new Event("online"));
  })));
  await expect.poll(() => streams.active.size).toBe(1);
  expect([...streams.active][0].frame().page()).toBe(leader);
  await decide(mobileAdmin, scenario, "REJECT");
  await streams.decided(scenario.requestId);
  await rejected(follower, scenario);
  await unchanged();
});
