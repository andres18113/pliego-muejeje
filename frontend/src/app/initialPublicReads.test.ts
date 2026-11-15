import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let releaseClock: () => void = () => undefined;
vi.mock("./realtime/offerRefresh", () => ({
  offerClockSettled: () => new Promise<void>(resolve => { releaseClock = resolve; }),
}));
const navigation = vi.fn(() => Promise.resolve());
vi.mock("@/features/storefront/storefrontQuery", () => ({ prefetchStorefrontNavigation: () => navigation() }));

const { prefetchInitialPublicReads } = await import("./initialPublicReads");

function keysPrefetched(path: string, search = "") {
  const client = new QueryClient();
  const prefetch = vi.spyOn(client, "prefetchQuery").mockResolvedValue(undefined);
  const done = prefetchInitialPublicReads(client, { pathname: path, search });
  return { prefetch, done };
}

describe("prefetchInitialPublicReads", () => {
  beforeEach(() => { navigation.mockClear(); });

  it("starts nothing that carries prices before the server has answered the offer clock (ADR 0058)", async () => {
    const { prefetch, done } = keysPrefetched("/catalog");
    await Promise.resolve();
    expect(prefetch).not.toHaveBeenCalled();
    expect(navigation).not.toHaveBeenCalled();
    releaseClock();
    await done;
    expect(navigation).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledTimes(3);
  });

  it("reads the catalog page's own queries for its URL", async () => {
    const { prefetch, done } = keysPrefetched("/catalog/", "?productType=EBOOK&q=mar");
    releaseClock(); await done;
    const keys = prefetch.mock.calls.map(([options]) => (options as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(["public-catalog", "categories", "EBOOK"]);
    expect(keys).toContainEqual(["public-catalog", "filter-options", "EBOOK"]);
    expect(keys.find(key => key[1] === "editions")?.[2]).toMatchObject({ productType: "EBOOK" });
  });

  it("reads a valid edition on its page and nothing for an invalid id", async () => {
    const valid = keysPrefetched("/catalog/editions/373");
    releaseClock(); await valid.done;
    expect(valid.prefetch.mock.calls.map(([options]) => (options as { queryKey: unknown[] }).queryKey)).toEqual([["public-catalog", "edition", "373"]]);

    const invalid = keysPrefetched("/catalog/editions/abc");
    releaseClock(); await invalid.done;
    expect(invalid.prefetch).not.toHaveBeenCalled();
  });

  it("skips the storefront projection where no storefront header is shown", async () => {
    for (const path of ["/cart", "/checkout", "/admin/retiros"]) {
      const { done } = keysPrefetched(path);
      releaseClock(); await done;
    }
    expect(navigation).not.toHaveBeenCalled();
    const home = keysPrefetched("/");
    releaseClock(); await home.done;
    expect(navigation).toHaveBeenCalledTimes(1);
    expect(home.prefetch).not.toHaveBeenCalled();
  });
});
