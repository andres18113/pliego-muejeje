import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Waits until every real cover in `scope` has loaded and decoded (BookCover drops `.cover-image--loading`), within the
 * caller's timeout; a failure additionally records each cover still loading — whether the browser
 * finished the image and what the network did for it — so a slow CDN response is told apart from a cover that
 * loaded but never left its loading state.
 */
export async function expectCoversDecoded(scope: Page | Locator, timeout: number) {
  const loading = scope.locator(".cover-image--loading");
  try {
    // Rows can render after the caller's first pass (the popular row appends its "Más vendidos" titles when that read
    // answers): a lazy cover outside the viewport is never requested, so every new one is made eager while waiting.
    await expect.poll(async () => {
      await scope.locator("img[loading=lazy]").evaluateAll((images) => images.forEach((image) => { (image as HTMLImageElement).loading = "eager"; }));
      return loading.count();
    }, { timeout, intervals: [250, 500, 1000] }).toBe(0);
  } catch (error) {
    const stuck = await loading.evaluateAll((images) => images.map((node) => {
      const image = node as HTMLImageElement;
      const source = image.currentSrc || image.src;
      const timing = performance.getEntriesByName(source).at(-1) as PerformanceResourceTiming | undefined;
      const box = image.getBoundingClientRect();
      return {
        source, loading: image.loading, complete: image.complete, naturalWidth: image.naturalWidth,
        inViewport: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
        network: timing ? { startMs: Math.round(timing.startTime), durationMs: Math.round(timing.duration), status: timing.responseStatus, bytes: timing.transferSize || timing.encodedBodySize } : "no resource entry (request not finished)",
        pageAgeMs: Math.round(performance.now()),
      };
    }));
    await test.info().attach("covers-still-loading", { body: JSON.stringify(stuck, null, 2), contentType: "application/json" });
    const finished = stuck.filter((cover) => cover.complete && cover.naturalWidth > 0).length;
    throw new Error(`${stuck.length} cover(s) still loading after ${timeout} ms; ${finished} of them had already finished in the browser (see covers-still-loading).\n${(error as Error).message}`);
  }
}
