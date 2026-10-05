import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockStatus } from "./StockStatus";

describe("StockStatus", () => {
  it("exposes informative text and a decorative symbol without becoming a live region or tab stop", () => {
    const { container } = render(<MantineProvider><StockStatus available /></MantineProvider>);
    expect(screen.getByText("Disponible")).toBeVisible();
    expect(container.querySelector('.material-symbol')).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-stockstatus]')).not.toHaveAttribute("tabindex");
    expect(container.querySelector('[data-stockstatus]')).not.toHaveAttribute("role");
    expect(container.querySelector('[data-stockstatus]')).not.toHaveAttribute("aria-live");
  });

  it.each([true, false])("pairs semantic tone with text and a Material Symbol (available: %s)", (available) => {
    const { container } = render(<MantineProvider><StockStatus available={available} /></MantineProvider>);
    expect(container.querySelector('[data-stockstatus]')).toHaveAttribute("data-tone", available ? "success" : "danger");
    expect(screen.getByText(available ? "Disponible" : "No disponible")).toBeVisible();
    expect(container.querySelector('.material-symbol')).toHaveTextContent(available ? "check_circle" : "block");
  });

  it("supports a wrapping badge with the same accessible meaning and leaves explanations complete", () => {
    const { container } = render(<MantineProvider><StockStatus available={false} variant="badge" size="compact" unavailabilityReason="P2042" /></MantineProvider>);
    expect(container.querySelector('[data-stockstatus]')).toHaveAttribute("data-variant", "badge");
    expect(screen.getByText("No disponible")).toBeVisible();
    expect(screen.getByText("Esta edición ya no está a la venta.")).toBeVisible();
  });

  it("keeps quantity-specific meaning fully readable in compact presentation and usable as a description", () => {
    render(<MantineProvider>
      <p><StockStatus available={false} unavailabilityReason="P3002" size="compact" id="stock" /></p>
      <button aria-describedby="stock">Cantidad de Cien años de soledad</button>
    </MantineProvider>);
    expect(screen.getByText("No disponible")).toBeVisible();
    expect(screen.getByText("No hay existencias suficientes para esta cantidad.")).toBeVisible();
    expect(screen.getByRole("button")).toHaveAccessibleDescription("No disponible No hay existencias suficientes para esta cantidad.");
    expect(screen.queryByText("Agotado")).not.toBeInTheDocument();
  });

  it("renders both sizes with the same meaning without projecting a residual reason onto available stock", () => {
    render(<MantineProvider>
      <StockStatus available unavailabilityReason="P2042" size="compact" />
      <StockStatus available unavailabilityReason="P2042" />
    </MantineProvider>);
    expect(screen.getAllByText("Disponible")).toHaveLength(2);
    expect(screen.queryByText("Esta edición ya no está a la venta.")).not.toBeInTheDocument();
  });
});

it.each([true, false])("uses the approved quiet mark without altering accessible status (%s)", available => {
  const { container, rerender } = render(<MantineProvider><StockStatus available={available} variant="quiet" /></MantineProvider>);
  expect(screen.getByText(available ? "Disponible" : "No disponible")).toBeVisible();
  expect(container.querySelector('[data-stockstatus-mark]')).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector('.material-symbol')).toBeNull();
  rerender(<MantineProvider><StockStatus available={!available} variant="quiet" /></MantineProvider>);
  expect(screen.getByText(available ? "No disponible" : "Disponible")).toBeVisible();
  expect(container.querySelector('[data-stockstatus]')).toHaveAttribute("data-state", available ? "unavailable" : "available");
});
