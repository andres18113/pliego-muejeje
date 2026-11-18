import { describe, expect, it } from "vitest";
import { coverSizes, coverSrcSet } from "./coverSources";

const base = "https://covers.pliegolibros.com/covers/editions/responsive-v1/";
const published = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000441-83b9f60f16ba.webp";

describe("coverSrcSet", () => {
  it("offers the fixed-width variants of a published cover and keeps the original as the 720w candidate", () => {
    expect(coverSrcSet(published, base)).toBe([
      `${base}PLG-BK-000441-83b9f60f16ba-w160.webp 160w`,
      `${base}PLG-BK-000441-83b9f60f16ba-w240.webp 240w`,
      `${base}PLG-BK-000441-83b9f60f16ba-w360.webp 360w`,
      `${base}PLG-BK-000441-83b9f60f16ba-w480.webp 480w`,
      `${published} 720w`,
    ].join(", "));
  });

  it("keeps a single URL until the variants are published (no base configured)", () => {
    expect(coverSrcSet(published, undefined)).toBeUndefined();
    expect(coverSrcSet(published, "")).toBeUndefined();
    expect(coverSrcSet(published, "https://covers.pliegolibros.com/covers/editions/responsive-v1")).toBeUndefined();
  });

  it.each([
    ["another host", "https://images.example.com/covers/editions/v2/PLG-BK-000441-83b9f60f16ba.webp"],
    ["another path", "https://covers.pliegolibros.com/covers/editions/v1/PLG-BK-000441-83b9f60f16ba.webp"],
    ["a query", `${published}?v=2`],
    ["a fragment", `${published}#x`],
    ["credentials", "https://user@covers.pliegolibros.com/covers/editions/v2/PLG-BK-000441-83b9f60f16ba.webp"],
    ["plain http", published.replace("https:", "http:")],
    ["a short hash", "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000441-83b9f60f16b.webp"],
    ["no cover", null],
  ])("keeps a single URL for %s", (_, url) => {
    expect(coverSrcSet(url, base)).toBeUndefined();
  });

  it("lets lazy cards use their laid-out width, with a measured bound everywhere else", () => {
    expect(coverSizes("card", "lazy")).toBe("auto, (max-width: 479px) 96px, (max-width: 1279px) 140px, 200px");
    expect(coverSizes("detail", "eager")).toBe("(max-width: 1023px) 220px, 340px");
    expect(coverSizes("compact", "lazy")).toBe("80px");
  });

  it("never gives an eager image `auto`, which Chrome rejects in favour of 100vw (the full original)", () => {
    expect(coverSizes("card", "eager")).toBe("(max-width: 479px) 96px, (max-width: 1279px) 140px, 200px");
    expect(coverSizes("catalog", "eager").startsWith("auto")).toBe(false);
  });
});
