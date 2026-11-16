import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

test.use({ reducedMotion: "reduce" });

/**
 * ADR 0054/0055 across tabs, against a synthetic server: an administrator's decision reaches every open Mi perfil
 * through the stream without a reload; closing the notice in one tab acknowledges it on the server and the other tab
 * follows. One browser holds one stream (Web Lock leader), and another tab takes over when the leader closes.
 */
async function synthetic(context: BrowserContext) {
  const pending = { id: "17", status: "PENDING", proposedType: "EC_CEDULA", proposedNumber: "1710034065", reasonCode: "DOCUMENT_TYPO",
    createdAt: "2026-10-25T17:00:00Z", dueAt: "2026-11-09T17:00:00Z", decidedAt: null, decisionReason: null };
  const state = {
    number: "0912345675",
    correction: pending as Record<string, unknown> | null,
    events: [] as { id: number; name: string }[],
    streamRequests: [] as { page: Page; resumed: boolean }[],
    delivered: new Map<Page, number>(),
    acknowledgments: 0,
  };
  const profile = { customerId: "2", firstNames: "Andrés", lastNames: "Ramírez", email: "lector@example.invalid", phone: null, state: "ACTIVE", version: "0", emailVerified: true };
  const push = (name: string) => state.events.push({ id: state.events.length + 1, name });
  await context.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/events") {
      // Playwright interception never sees the browser's Last-Event-ID header (Chrome keeps the cursor itself), so
      // the synthetic server tracks what it delivered to each tab: the first stream gets `resync`, later ones resume.
      const page = request.frame().page();
      const after = state.delivered.get(page);
      state.streamRequests.push({ page, resumed: after !== undefined });
      const head = state.events.length;
      const lines = ["retry: 250", ": heartbeat", ""];
      if (after === undefined) lines.push(`id: ${head}`, "event: resync", 'data: {"reason":"replay-unavailable"}', "");
      else for (const event of state.events.filter(event => event.id > after))
        lines.push(`id: ${event.id}`, `event: ${event.name}`, `data: {"resourceType":"billingIdentity","resourceId":"17"}`, "");
      state.delivered.set(page, head);
      // A short-lived stream: the browser reconnects after `retry`, as it does after the real 60s lifetime.
      return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }, body: lines.join("\n") + "\n" });
    }
    if (path === "/auth/refresh") return route.fulfill({ json: { accessToken: "synthetic-realtime", tokenType: "Bearer", expiresInSeconds: 1800, user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
    if (path === "/storefront/navigation") return route.fulfill({ json: storefrontNavigationFixture });
    if (path === "/me/billing-identity" && request.method() === "GET")
      return route.fulfill({ json: { type: "EC_CEDULA", number: state.number, used: true, correctionMode: "REQUEST", correctionRequest: state.correction } });
    if (path === "/me/billing-identity/correction-requests/17/acknowledgment" && request.method() === "POST") {
      state.acknowledgments++;
      state.correction = null;
      push("identity.correction.acknowledged");
      return route.fulfill({ status: 204 });
    }
    if (path === "/me") return route.fulfill({ json: profile });
    return route.fulfill({ json: { items: [], page: 0, pageSize: 20, totalCount: "0" } });
  });
  return {
    state,
    approve() {
      state.number = "1710034065";
      state.correction = { ...pending, status: "APPROVED", decidedAt: "2026-10-27T15:00:00Z" };
      push("identity.correction.decided");
    },
  };
}

const notice = (page: Page) => page.getByText(/Aprobamos tu corrección\. Tus próximas facturas/);

test("an approval reaches every open tab live, and closing it in one tab closes it in the other", async ({ context }, testInfo) => {
  const server = await synthetic(context);
  const first = await context.newPage(), second = await context.newPage();
  await first.goto("/account");
  await second.goto("/account");
  await expect(first.getByText("En revisión")).toBeVisible();
  await expect(second.getByText("En revisión")).toBeVisible();
  // One stream per browser: every stream request so far comes from the same (leader) tab.
  await expect.poll(() => server.state.streamRequests.length).toBeGreaterThan(1);
  const leaders = new Set(server.state.streamRequests.map(request => request.page));
  expect(leaders.size).toBe(1);
  const leader = [...leaders][0]!;
  const follower = leader === first ? second : first;
  // Only the first stream of the session starts over; every reconnect resumes.
  expect(server.state.streamRequests.filter(request => !request.resumed)).toHaveLength(1);

  server.approve();
  // No reload in either tab.
  await expect(notice(first)).toBeVisible({ timeout: 5_000 });
  await expect(notice(second)).toBeVisible({ timeout: 5_000 });
  // The approved number is the one in use, re-read from the server.
  await expect(follower.locator("li").filter({ hasText: "Cédula o RUC" })).toContainText("1710034065");
  await expect(follower.getByText("Aprobamos tu corrección de cédula o RUC.")).toBeAttached();
  await follower.screenshot({ fullPage: true, path: testInfo.outputPath("decision-notice-1280.png") });

  await follower.getByRole("button", { name: "Cerrar aviso de corrección aprobada" }).click();
  await expect(notice(follower)).toHaveCount(0);
  await expect(follower.getByRole("link", { name: "Corregir cédula o RUC" })).toBeFocused();
  // The other tab follows through the acknowledgment hint, again without a reload.
  await expect(notice(leader)).toHaveCount(0, { timeout: 5_000 });
  expect(server.state.acknowledgments).toBe(1);
  await expect(leader.getByText(/Corregida según/)).toHaveCount(0);

  // Hand-over: when the leader closes, the remaining tab takes the lock and connects.
  const before = server.state.streamRequests.length;
  await leader.close();
  await expect.poll(() => server.state.streamRequests.slice(before).some(request => request.page === follower), { timeout: 5_000 }).toBe(true);
});

for (const width of [320, 768]) {
  test(`the decision notice is accessible and fits at ${width}px, also at 200% text`, async ({ context }, testInfo) => {
    const server = await synthetic(context);
    server.approve();
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account");
    await expect(notice(page)).toBeVisible();
    const close = page.getByRole("button", { name: "Cerrar aviso de corrección aprobada" });
    const box = (await close.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) }))).toEqual([]);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`decision-notice-${width}.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(notice(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`decision-notice-${width}-text200.png`) });
  });
}
