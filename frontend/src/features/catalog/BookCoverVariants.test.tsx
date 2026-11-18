import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const base = "https://covers.pliegolibros.com/covers/editions/responsive-v1/";
const published = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000441-83b9f60f16ba.webp";

// The variants base is read when coverSources loads, so each test imports BookCover after stubbing it.
async function loadBookCover() {
  vi.resetModules();
  vi.stubEnv("VITE_COVER_VARIANTS_BASE", base);
  return (await import("./BookCover")).BookCover;
}

describe("BookCover with published responsive variants", () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("lets the browser choose a variant sized for the jacket's rendered width", async () => {
    const BookCover = await loadBookCover();
    const { container } = render(<BookCover url={published} license={null} attribution={null} title="Variantes" size="detail" loading="eager" />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", published);
    expect(image.getAttribute("srcset")).toContain(`${base}PLG-BK-000441-83b9f60f16ba-w240.webp 240w`);
    expect(image.getAttribute("srcset")).toContain(`${published} 720w`);
    expect(image).toHaveAttribute("sizes", "(max-width: 1023px) 220px, 340px");
  });

  it("falls back to the original URL once when a variant fails, and only then reads as unavailable", async () => {
    const BookCover = await loadBookCover();
    const { container } = render(<BookCover url={published} license={null} attribution={null} title="Respaldo" />);
    fireEvent.error(container.querySelector("img")!);
    const original = container.querySelector("img")!;
    expect(original).toHaveAttribute("src", published);
    expect(original).not.toHaveAttribute("srcset");
    expect(original).not.toHaveAttribute("sizes");

    fireEvent.error(original);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Portada no disponible de Respaldo" })).toBeVisible();
  });

  it("sizes an eager card from its measured bounds, never `auto` (Chrome would fall back to 100vw)", async () => {
    const BookCover = await loadBookCover();
    const lazy = render(<BookCover url={published} license={null} attribution={null} title="Perezosa" size="card" decorative />);
    expect(lazy.container.querySelector("img")).toHaveAttribute("sizes", "auto, (max-width: 479px) 96px, (max-width: 1279px) 140px, 200px");
    lazy.unmount();
    // The Home hero's stand-in jacket is an eager card.
    const { container } = render(<BookCover url={published} license={null} attribution={null} title="Primera" size="card" decorative loading="eager" />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("sizes", "(max-width: 479px) 96px, (max-width: 1279px) 140px, 200px");
  });

  it("keeps a single URL for covers outside the published set", async () => {
    const BookCover = await loadBookCover();
    const { container } = render(<BookCover url="https://images.example.com/covers/manual.webp" license={null} attribution={null} title="Manual" />);
    expect(container.querySelector("img")).not.toHaveAttribute("srcset");
  });
});
