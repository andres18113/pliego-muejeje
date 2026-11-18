import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UndoToast, type UndoToastMessage } from "./UndoToast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

let show: (message: string) => void = () => undefined;
function Host({ duration = 10_000, progress, onDismiss = vi.fn(), action }: { duration?: number; progress?: boolean; onDismiss?: () => void; action?: UndoToastMessage["action"] }) {
  const [toast, setToast] = useState<UndoToastMessage | null>(null);
  let key = 0;
  show = (message) => setToast({ key: Date.now() + ++key, message, detail: "Casa", action });
  return <>
    <button type="button">Fuera del aviso</button>
    <UndoToast toast={toast} duration={duration} progress={progress} onDismiss={() => { onDismiss(); setToast(null); }} />
  </>;
}
const toast = () => document.querySelector<HTMLElement>("[data-undo-toast]");
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

it("announces the message politely in one atomic live region, with its detail for assistive technology", () => {
  render(<Host />);
  act(() => show("Dirección actualizada"));
  const region = screen.getByRole("status");
  expect(region).toHaveAttribute("aria-live", "polite");
  expect(region).toHaveAttribute("aria-atomic", "true");
  expect(region).toHaveTextContent("Dirección actualizada: Casa");
  expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeVisible();
});

it("leaves on its own exactly when its duration ends", () => {
  const onDismiss = vi.fn();
  render(<Host onDismiss={onDismiss} />);
  act(() => show("Dirección actualizada"));
  advance(9_999);
  expect(toast()).not.toBeNull();
  expect(onDismiss).not.toHaveBeenCalled();
  advance(1);
  expect(toast()).toBeNull();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("closes at once with its close button or Escape, and never fires a late second dismissal", () => {
  const onDismiss = vi.fn();
  render(<Host onDismiss={onDismiss} />);
  act(() => show("Dirección actualizada"));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  expect(toast()).toBeNull();
  act(() => show("Dirección agregada"));
  fireEvent.keyDown(screen.getByRole("button", { name: "Cerrar aviso" }), { key: "Escape" });
  expect(toast()).toBeNull();
  advance(20_000);
  expect(onDismiss).toHaveBeenCalledTimes(2);
});

it("stops its time while hovered or focused and resumes where it stopped, not from the start", () => {
  render(<Host />);
  act(() => show("Dirección actualizada"));
  advance(6_000);
  fireEvent.mouseEnter(toast()!);
  expect(toast()).toHaveAttribute("data-paused");
  advance(60_000);
  expect(toast()).not.toBeNull();
  fireEvent.mouseLeave(toast()!);
  expect(toast()).not.toHaveAttribute("data-paused");
  advance(3_999);
  expect(toast()).not.toBeNull();
  advance(1);
  expect(toast()).toBeNull();

  act(() => show("Dirección agregada"));
  advance(2_000);
  act(() => screen.getByRole("button", { name: "Cerrar aviso" }).focus());
  advance(60_000);
  expect(toast()).not.toBeNull();
  act(() => screen.getByRole("button", { name: "Fuera del aviso" }).focus());
  advance(7_999);
  expect(toast()).not.toBeNull();
  advance(1);
  expect(toast()).toBeNull();
});

it("waits while its action is working", () => {
  render(<Host action={{ label: "Deshacer", busy: true, busyLabel: "Deshaciendo…", onPress: vi.fn() }} />);
  act(() => show("Quitado del carrito"));
  advance(60_000);
  expect(toast()).toHaveAttribute("data-paused");
  expect(screen.getByRole("button", { name: "Deshaciendo…" })).toHaveAttribute("aria-busy", "true");
});

it("holds one message: a new one replaces the current one and gets the whole window", () => {
  render(<Host />);
  act(() => show("Dirección actualizada"));
  advance(8_000);
  act(() => show("Dirección principal actualizada"));
  expect(document.querySelectorAll("[data-undo-toast]")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Dirección principal actualizada");
  expect(screen.getByRole("status")).not.toHaveTextContent("Dirección actualizada:");
  advance(9_999);
  expect(toast()).not.toBeNull();
  advance(1);
  expect(toast()).toBeNull();
});

it("draws the time left as a decorative line that runs for the duration and stops with the toast", () => {
  render(<Host />);
  act(() => show("Dirección actualizada"));
  const line = toast()!.querySelector("[data-undo-toast-progress]");
  expect(line).toHaveAttribute("aria-hidden", "true");
  expect(toast()!.style.getPropertyValue("--toast-duration")).toBe("10000ms");
  fireEvent.mouseEnter(toast()!);
  expect(toast()).toHaveAttribute("data-paused");
});

it("omits the line for a notice whose window is too long to read as a countdown", () => {
  render(<Host duration={600_000} progress={false} />);
  act(() => show("Hay una versión nueva de PLIEGO."));
  expect(toast()!.querySelector("[data-undo-toast-progress]")).toBeNull();
});
