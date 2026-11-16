import { expect, test } from "@playwright/test";
import { storefrontNavigationFixture } from "../../src/test/storefrontFixture";

// ADR 0058: an open catalog re-reads its prices when an offer ends — no reload, no browser wall clock.
test("a catalog card drops an ended offer on its own, at the server's transition, without a reload", async ({ page }) => {
  const opened = Date.now();
  const endsAt = opened + 3_000;
  let ended = false;
  const requests: string[] = [];
  const offer = { offerId: "501", originalPrice: "18.95", discountAmount: "2.84", effectivePrice: "16.11", savingsAmount: "2.84", savingsPercent: "15.00",
    startsAt: new Date(opened - 86_400_000).toISOString(), endsAt: new Date(endsAt).toISOString(), daysRemaining: 0, endingSoon: true, offerCopy: null, terms: null };
  const edition = (onOffer: boolean) => ({ editionId: "42", bookId: "17", title: "En la ciudad", authors: "Gil Solares, Luis Fernando", publisher: "Editorial Sur", isbn13: null,
    price: onOffer ? "16.11" : "18.95", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true, offer: onOffer ? offer : null });

  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/refresh") return route.fulfill({ status: 204 });
    if (url.pathname === "/api/v1/storefront/navigation") return json(storefrontNavigationFixture);
    if (url.pathname === "/api/v1/catalog/offer-refresh") {
      // The server's own clock: before the end it names it; afterwards the next transition is far away.
      const now = Date.now();
      if (now >= endsAt) ended = true;
      return json({ serverTime: new Date(now).toISOString(), nextTransitionAt: ended ? new Date(now + 86_400_000).toISOString() : new Date(endsAt).toISOString(), revalidateAfterSeconds: 60 });
    }
    if (url.pathname === "/api/v1/catalog/categories") return json({ items: [] });
    if (url.pathname === "/api/v1/catalog/filter-options") return json({ languages: ["es"], formats: ["PAPERBACK"], minimumPrice: "9.00", maximumPrice: "40.00" });
    if (url.pathname === "/api/v1/catalog/editions") return json({ items: [edition(!ended && Date.now() < endsAt)], page: 0, pageSize: 24, totalCount: "1" });
    return route.fulfill({ status: 404, contentType: "application/problem+json", body: JSON.stringify({ code: "NOT_FOUND", title: "Recurso no disponible" }) });
  });

  await page.goto("/catalog?productType=PHYSICAL");
  const card = page.locator("[data-bookcard]");
  await expect(card.locator("[data-bookcard-price]")).toHaveText(/16,11/);
  await expect(card.getByText(/Ahorras \$\s*2,84/)).toBeVisible();
  await page.evaluate(() => { (window as unknown as { samePage: boolean }).samePage = true; });

  // Just after the end (plus the half-second margin) the card reads the base price, with no offer chips.
  await expect(card.locator("[data-bookcard-price]")).toHaveText(/18,95/, { timeout: 8_000 });
  await expect(card.locator("[data-bookcard-offer]")).toHaveCount(0);
  await expect(card.locator("s")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
  // The clock is asked before the shelf is read, then again at the transition.
  expect(requests.indexOf("/api/v1/catalog/offer-refresh")).toBeLessThan(requests.indexOf("/api/v1/catalog/editions"));
  expect(requests.filter(path => path === "/api/v1/catalog/offer-refresh").length).toBeGreaterThanOrEqual(2);
});
