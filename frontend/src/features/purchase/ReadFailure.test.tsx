import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/shared/api/errors";
import { renderPurchaseRoute } from "@/test/purchase";
import { ReadFailure } from "./CartPage";

describe("purchase read failure recovery", () => {
  it.each([
    [403, /No tienes permiso/],
    [404, /ya no está disponible/],
    [429, /Espera un momento/],
    [500, /servicio/],
    [503, /servicio/],
  ] as const)("explains HTTP %s without exposing implementation details", (status, message) => {
    renderPurchaseRoute([{ path: "/cart", element: <ReadFailure error={new ApiRequestError(status, "internal", "raw SQL error", "stack trace")} retrying={false} onRetry={() => {}} /> }], "/cart");
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/raw SQL|stack trace|internal/);
  });
  it("retains the focused recovery control while blocking another request during retry", () => {
    const retry = vi.fn();
    renderPurchaseRoute([{ path: "/cart", element: <ReadFailure retrying onRetry={retry} /> }], "/cart");
    const button = screen.getByRole("button", { name: "Consultando…" });
    button.focus();
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});
