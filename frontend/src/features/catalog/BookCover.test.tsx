import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookCover } from "./BookCover";

describe("BookCover", () => {
  it("shows a per-image skeleton while an uncached cover is unloaded", () => {
    const { container } = render(<BookCover
      url="https://images.example.com/covers/uncached-skeleton.webp"
      license={null}
      attribution={null}
      title="Unloaded edition"
    />);

    expect(screen.getByTestId("cover-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".cover-frame")).toBeInTheDocument();
    expect(container.querySelector("img.cover-image")).toHaveAttribute("loading", "lazy");
  });

  it("removes the skeleton after the image loads and decodes", async () => {
    const { container } = render(<BookCover
      url="https://images.example.com/covers/loaded-skeleton.webp"
      license={null}
      attribution={null}
      title="Loaded edition"
    />);
    const image = container.querySelector("img.cover-image")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });

    fireEvent.load(image);

    await waitFor(() => expect(screen.queryByTestId("cover-skeleton")).not.toBeInTheDocument());
    expect(image).not.toHaveClass("cover-image--loading");
  });

  it.each([
    ["Apología de Sócrates", 371, 784, "contain"],
    ["Análisis matemático", 300, 450, "cover"],
    ["Análisis matemático I", 600, 800, "contain"],
    ["Análisis matemático II", 270, 353, "contain"],
    ["Anna Karénina", 777, 1200, "cover"],
    ["Cien años de soledad", 381, 588, "cover"],
    ["Don Quijote de la Mancha", 337, 500, "cover"],
    ["La genealogía de la moral", 656, 923, "cover"],
    ["Los miserables", 729, 1200, "contain"],
    ["Moby Dick", 359, 500, "cover"],
  ] as const)("chooses a non-distorting fit for %s (%sx%s)", async (title, width, height, fit) => {
    const { container } = render(<BookCover
      url={`https://images.example.com/covers/${encodeURIComponent(title)}.webp`}
      license={null}
      attribution={null}
      title={title}
    />);
    const image = container.querySelector("img.cover-image")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });

    fireEvent.load(image);

    await waitFor(() => {
      if (fit === "cover") expect(image).toHaveClass("cover-image--cover");
      else expect(image).not.toHaveClass("cover-image--cover");
      expect(screen.queryByTestId("cover-skeleton")).not.toBeInTheDocument();
    });
  });

  it("does not flash the skeleton when a decoded cover is remounted", async () => {
    const props = {
      url: "https://images.example.com/covers/remounted-cover.webp",
      license: null,
      attribution: null,
      title: "Remounted edition",
    };
    const first = render(<BookCover {...props} />);
    const image = first.container.querySelector("img.cover-image")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });
    fireEvent.load(image);
    await waitFor(() => expect(screen.queryByTestId("cover-skeleton")).not.toBeInTheDocument());
    first.unmount();

    const remounted = render(<BookCover {...props} />);

    expect(remounted.queryByTestId("cover-skeleton")).not.toBeInTheDocument();
    expect(remounted.container.querySelector("img.cover-image")).not.toHaveClass("cover-image--loading");
  });

  it("starts a loading state for a new URL after a different cover decoded", async () => {
    const first = render(<BookCover
      url="https://images.example.com/covers/first-url.webp"
      license={null}
      attribution={null}
      title="First edition"
    />);
    const firstImage = first.container.querySelector("img.cover-image")!;
    Object.defineProperty(firstImage, "naturalWidth", { configurable: true, value: 600 });
    fireEvent.load(firstImage);
    await waitFor(() => expect(screen.queryByTestId("cover-skeleton")).not.toBeInTheDocument());

    first.rerender(<BookCover
      url="https://images.example.com/covers/second-url.webp"
      license={null}
      attribution={null}
      title="Second edition"
    />);

    expect(screen.getByTestId("cover-skeleton")).toBeInTheDocument();
    expect(first.container.querySelector("img.cover-image")).toHaveAttribute(
      "src", "https://images.example.com/covers/second-url.webp",
    );
  });

  it("displays a manual cover with its explicit license and attribution", () => {
    const { container } = render(<BookCover
      url="https://images.example.com/covers/manual.jpg"
      license="CC_BY"
      attribution="Editorial Sur"
      title="Cien años de soledad"
    />);

    expect(container.querySelector("img.cover-image")).toHaveAttribute(
      "src", "https://images.example.com/covers/manual.jpg",
    );
    expect(screen.getByText("Editorial Sur · Licencia: CC_BY")).toBeInTheDocument();
    expect(container.querySelector("img.cover-image")).toHaveAttribute("loading", "lazy");
    expect(container.querySelector("img.cover-image")).toHaveAttribute("decoding", "async");
  });

  it("uses the local PLIEGO fallback when no cover is available", () => {
    const { container } = render(<BookCover
      url={null}
      license={null}
      attribution={null}
      title="El libro de las preguntas"
    />);

    expect(screen.getByRole("img", { name: "Portada no disponible de El libro de las preguntas" }))
      .toBeInTheDocument();
    expect(container.querySelector("img.cover-image")).not.toBeInTheDocument();
  });

  it("renders a prepared CDN cover while license and provenance remain unresolved", () => {
    const coverUrl = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";
    const { container } = render(<BookCover
      url={coverUrl}
      license={null}
      attribution={null}
      title="Don Quijote de la Mancha"
    />);

    expect(container.querySelector("img.cover-image")).toHaveAttribute("src", coverUrl);
    expect(screen.queryByText(/Licencia:/)).not.toBeInTheDocument();
    expect(container.querySelector("figcaption")).not.toBeInTheDocument();
  });

  it("falls back after a manual image request fails", () => {
    const { container } = render(<BookCover
      url="https://images.example.com/covers/manual.jpg"
      license="CC_BY"
      attribution="Editorial Sur"
      title="Cien años de soledad"
    />);
    const image = container.querySelector("img.cover-image");

    fireEvent.error(image!);

    expect(screen.getByRole("img", { name: "Portada no disponible de Cien años de soledad" }))
      .toBeInTheDocument();
    expect(container.querySelector("img.cover-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cover-skeleton")).not.toBeInTheDocument();
  });

  it.each([
    ["javascript:alert(1)", "CC_BY"],
    ["http://images.example.com/cover.jpg", "CC_BY"],
    ["https://127.0.0.1/covers/manual.jpg", "CC_BY"],
    ["https://localhost/covers/manual.jpg", null],
    [null, "CC_BY"],
  ] as const)("falls back for an unsafe or unlicensed manual cover", (url, license) => {
    const { container } = render(<BookCover
      url={url}
      license={license}
      attribution={null}
      title="Test edition"
    />);

    expect(container.querySelector("img.cover-image")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Portada no disponible de Test edition" })).toBeInTheDocument();
  });
});
