import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { pickupSnapshot } from "@/test/pickup";
import { PickupDetails } from "./PickupDetails";

const tenMinuteSnapshot = { ...pickupSnapshot, preparationMinutes: 10, pickupCode: "P-WU7RCGC3" };
const rule = /Estará listo unos 10 minutos después de aprobarse el pago, en horario de atención: si el punto está cerrado, al abrir\./;

it("explains the ten-minute rule only for snapshots taken under it, and only while preparing", () => {
  const { rerender } = render(<PickupDetails pickup={tenMinuteSnapshot} state="PENDING" />);
  expect(screen.getByText(rule)).toBeInTheDocument();
  // Older orders keep their own time without an invented explanation.
  rerender(<PickupDetails pickup={pickupSnapshot} state="PENDING" />);
  expect(screen.queryByText(rule)).toBeNull();
  rerender(<PickupDetails pickup={tenMinuteSnapshot} state="READY" />);
  expect(screen.queryByText(rule)).toBeNull();
  expect(screen.getByText(/Al retirar, muestra tu código de retiro y tu documento de identidad\./)).toBeInTheDocument();
});

it("leads with the whole pickup code as a pass while usable, and keeps it as a quiet record afterwards", () => {
  const { rerender } = render(<PickupDetails pickup={tenMinuteSnapshot} state="READY" />);
  const code = screen.getByText("P-WU7RCGC3");
  expect(code).toHaveAttribute("translate", "no");
  const row = code.closest("div")!;
  expect(row).toHaveAttribute("data-usable");
  // First fact in the list: the thing to show at the counter.
  expect(row.parentElement!.firstElementChild).toBe(row);
  rerender(<PickupDetails pickup={tenMinuteSnapshot} state="COLLECTED" collectedAt="2026-11-02T00:42:49Z" />);
  expect(screen.getByText("P-WU7RCGC3").closest("div")).not.toHaveAttribute("data-usable");
  expect(screen.queryByText(/Al retirar, muestra tu código/)).toBeNull();
});
