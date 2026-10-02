import type { Locator } from "@playwright/test";

/**
 * Shared directional contract for the reusable dropdown chevrons
 * (`.pliego-select-chevron`, `.country-picker-chevron`).
 *
 * Open-state feedback lives in `transform` (scale) on every open popup, so
 * `transform !== "none"` cannot tell up from down. Direction is exposed
 * through the independent `rotate` property instead: `none` while closed or
 * opening downward, `180deg` while opening upward.
 */
export function readChevronRotation(chevron: Locator) {
  return chevron.evaluate((element) => getComputedStyle(element).rotate !== "none");
}
