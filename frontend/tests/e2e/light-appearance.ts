import { expect, test, type Page } from "@playwright/test";

/**
 * PLIEGO has one appearance: its light paper scheme, whatever the system or browser prefers. These checks replace the
 * former dark-scheme expectations without losing their regression value: the page must be light (scheme, colour
 * properties and measured readability), and a dark system preference must not change a single rendered pixel.
 */
export async function expectLightAppearance(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "light");
  const look = await page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const transparent = (value: string) => value === "transparent" || /rgba\(.*,\s*0\)$/.test(value);
    const background = transparent(body.backgroundColor) ? root.backgroundColor : body.backgroundColor;
    return { scheme: root.colorScheme, background: luminance(rgb(background)), ink: luminance(rgb(body.color)) };
  });
  expect(look.scheme, "root color-scheme").toContain("light");
  expect(look.scheme, "root color-scheme").not.toContain("dark");
  // Paper ground and ink text: light background, readable at AAA contrast.
  expect(look.background, "page background luminance").toBeGreaterThan(0.8);
  expect((look.background + 0.05) / (look.ink + 0.05), "text contrast on the page ground").toBeGreaterThanOrEqual(7);
}

/**
 * Renders the current view under a light, then a dark, then again a light system preference. The dark capture must be
 * identical to the light one. Two light captures that differ mean the page itself was still changing (a late image
 * decode, a transition), not that the preference did: that bracket is retried, and a page that never settles fails on
 * its own message. Every failure attaches its captures.
 */
export async function expectUnchangedByDarkPreference(page: Page, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const capture = async (colorScheme: "light" | "dark") => {
    await page.emulateMedia({ colorScheme, reducedMotion }); await settle();
    return page.screenshot({ animations: "disabled", caret: "hide" });
  };
  const attach = async (name: string, body: Buffer) => test.info().attach(name, { body, contentType: "image/png" });
  for (let attempt = 1; ; attempt++) {
    const before = await capture("light"), dark = await capture("dark"), after = await capture("light");
    if (before.equals(after)) {
      if (!dark.equals(before)) { await attach("light", before); await attach("dark", dark); }
      expect(dark.equals(before), "a dark system preference changed PLIEGO's rendering").toBe(true);
      break;
    }
    if (attempt === 3) {
      await attach("light-before", before); await attach("light-after", after);
      expect(before.equals(after), "the page kept changing under one light preference, so the dark comparison could not be made").toBe(true);
    }
    await page.waitForTimeout(500);
  }
  await expectLightAppearance(page);
}
