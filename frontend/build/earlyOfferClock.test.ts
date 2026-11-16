import { describe, expect, it, vi } from "vitest";
import { EARLY_OFFER_CLOCK_MARKER, earlyOfferClock, earlyOfferClockHtml } from "./earlyOfferClock";

const scriptOf = (html: string) => /<script>([\s\S]*)<\/script>/.exec(html)![1];

describe("early offer clock (index.html)", () => {
  it("asks the configured API origin, warms its credentialed connection and never sends credentials itself", () => {
    const html = earlyOfferClockHtml("https://api.pliegolibros.com");
    expect(html).toContain('<link rel="preconnect" href="https://api.pliegolibros.com" crossorigin="use-credentials" />');
    expect(scriptOf(html)).toContain('"https://api.pliegolibros.com/api/v1/catalog/offer-refresh"');
    expect(scriptOf(html)).toContain('"credentials":"omit"');
    expect(scriptOf(html)).toContain('"cache":"no-store"');
  });

  it("stays same-origin without a preconnect when the API is relative", () => {
    for (const base of [undefined, "/api/v1", ""]) {
      const html = earlyOfferClockHtml(base);
      expect(html).not.toContain("preconnect");
      expect(scriptOf(html)).toContain('fetch("/api/v1/catalog/offer-refresh"');
    }
  });

  it("leaves the answer as text with its arrival time, or null when the request fails", async () => {
    const run = async (fetchImpl: () => Promise<Response>) => {
      const win: { __pliegoOfferClock?: Promise<unknown> } = {};
      new Function("window", "fetch", "performance", scriptOf(earlyOfferClockHtml("https://api.example")))(win, vi.fn(fetchImpl), { now: () => 42 });
      return win.__pliegoOfferClock;
    };
    await expect(run(async () => new Response('{"a":1}', { status: 200 }))).resolves.toEqual({ ok: true, status: 200, body: '{"a":1}', receivedAt: 42 });
    await expect(run(async () => { throw new TypeError("network"); })).resolves.toBeNull();
  });

  it("fails the build when index.html lost its marker", () => {
    const plugin = earlyOfferClock();
    (plugin.configResolved as (config: unknown) => void)({ env: { VITE_API_BASE_URL: "https://api.example" } });
    const { handler } = plugin.transformIndexHtml as { handler: (html: string) => string };
    expect(handler(`<head>${EARLY_OFFER_CLOCK_MARKER}</head>`)).toContain("https://api.example/api/v1/catalog/offer-refresh");
    expect(() => handler("<head></head>")).toThrow(/early-offer-clock/);
  });
});
