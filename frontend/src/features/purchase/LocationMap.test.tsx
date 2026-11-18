import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationMap, visibleTiles } from "./LocationMap";

const PUCE = { latitude: -0.21, longitude: -78.4914 };

beforeEach(() => {
  // jsdom has no layout or image pipeline: give the frame a size, and keep every tile "in flight" until a test settles it.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 220, top: 0, left: 0, right: 600, bottom: 220, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

const frame = () => document.querySelector<HTMLElement>("[data-location-map]")!;
const tiles = (zoom: number) => [...document.querySelectorAll<HTMLImageElement>("[data-location-map] img")].filter((img) => img.src.includes(`.org/${zoom}/`));
const settle = (images: HTMLImageElement[], outcome: "load" | "error" = "load") => images.forEach((img) => (outcome === "load" ? fireEvent.load(img) : fireEvent.error(img)));

it("requests only the visible OSM tiles, with the exact point's tile among them", () => {
  const visible = visibleTiles(PUCE.latitude, PUCE.longitude, 16, 600, 220, 0.5);
  expect(visible.length).toBeGreaterThanOrEqual(3);
  expect(visible.length).toBeLessThanOrEqual(8);
  expect(visible.map((tile) => tile.url)).toContain("https://tile.openstreetmap.org/16/18478/32806.png");
  // Every tile overlaps the 600×220 frame.
  for (const tile of visible) {
    expect(tile.left).toBeLessThan(600); expect(tile.left + 256).toBeGreaterThan(0);
    expect(tile.top).toBeLessThan(220); expect(tile.top + 256).toBeGreaterThan(0);
  }
});

it("stays a quiet loading field, with no marker, until its tiles arrive; then shows map and marker together", () => {
  render(<LocationMap {...PUCE} label="PUCE" />);
  expect(screen.getByRole("img", { name: "Mapa de PUCE" })).toBeInTheDocument();
  expect(frame()).toHaveAttribute("data-state", "loading");
  expect(frame()).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Cargando mapa…")).toBeInTheDocument();
  expect(frame().querySelector(".material-symbol")).toBeNull();
  expect(screen.queryByRole("button", { name: "Acercar el mapa" })).not.toBeInTheDocument();

  const first = tiles(16);
  settle(first.slice(0, -1));
  expect(frame()).toHaveAttribute("data-state", "loading"); // one tile still in flight: not yet
  settle(first.slice(-1));

  expect(frame()).toHaveAttribute("data-state", "ready");
  expect(screen.queryByText("Cargando mapa…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Acercar el mapa" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /© OpenStreetMap/ })).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  expect(screen.getByRole("link", { name: /Ver ubicación en el mapa/ })).toHaveAttribute("href", expect.stringContaining("mlat=-0.21&mlon=-78.4914"));
});

it("keeps the shown zoom level until the next one has loaded, and never blanks", async () => {
  const user = userEvent.setup();
  render(<LocationMap {...PUCE} label="PUCE" />);
  settle(tiles(16));
  await user.click(screen.getByRole("button", { name: "Acercar el mapa" }));

  const next = tiles(17);
  expect(next.length).toBeGreaterThan(0);
  expect(tiles(16)[0].closest("[data-shown]")).not.toBeNull();
  expect(next[0].closest("[data-shown]")).toBeNull();
  expect(screen.getByRole("button", { name: "Acercar el mapa" })).toHaveAttribute("aria-disabled", "true");

  settle(next);
  expect(tiles(17)[0].closest("[data-shown]")).not.toBeNull();
  expect(tiles(16)).toHaveLength(0);
});

it("says so when the map cannot load, and keeps the link to the full map", () => {
  render(<LocationMap {...PUCE} label="PUCE" />);
  settle(tiles(16), "error");
  expect(frame()).toHaveAttribute("data-state", "failed");
  expect(screen.getByText(/No pudimos cargar el mapa/)).toBeInTheDocument();
  expect(screen.queryByText("Cargando mapa…")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ver ubicación en el mapa/ })).toBeInTheDocument();
});

it("shows a partly loaded map rather than hiding it, and reports a zoom level that fails without losing the current one", async () => {
  const user = userEvent.setup();
  render(<LocationMap {...PUCE} label="PUCE" />);
  const first = tiles(16);
  settle(first.slice(1)); settle(first.slice(0, 1), "error");
  expect(frame()).toHaveAttribute("data-state", "ready");

  await user.click(screen.getByRole("button", { name: "Alejar el mapa" }));
  settle(tiles(15), "error");
  expect(screen.getByRole("status")).toHaveTextContent("No pudimos cargar ese nivel del mapa.");
  expect(tiles(16)[1].closest("[data-shown]")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Alejar el mapa" })).not.toHaveAttribute("aria-disabled");
});

it("stops at its zoom limits with focusable, aria-disabled controls", async () => {
  const user = userEvent.setup();
  render(<LocationMap {...PUCE} label="PUCE" />);
  settle(tiles(16));
  for (const level of [17, 18]) {
    await user.click(screen.getByRole("button", { name: "Acercar el mapa" }));
    settle(tiles(level));
  }
  const zoomIn = screen.getByRole("button", { name: "Acercar el mapa" });
  expect(zoomIn).toHaveAttribute("aria-disabled", "true");
  await user.click(zoomIn);
  expect(tiles(19)).toHaveLength(0);
});
