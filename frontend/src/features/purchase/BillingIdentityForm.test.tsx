import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { expect, it, vi } from "vitest";
import { checkoutBillingSchema, type CheckoutBilling } from "@/shared/api/billing";
import { BillingIdentityForm } from "./BillingIdentityForm";
import { billingFixturePayload } from "./billingTestFixtures";

function Example({ onSubmit = vi.fn(), disabled = false }: { onSubmit?: (value: CheckoutBilling) => void; disabled?: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<CheckoutBilling>({
    resolver: zodResolver(checkoutBillingSchema),
    mode: "onChange",
    defaultValues: { ...billingFixturePayload, buyerName: "", billingIdentity: { type: "EC_CEDULA", number: "0123456782" }, billingAddress: { ...billingFixturePayload.billingAddress, countryCode: "EC" } },
  });
  return <form onSubmit={handleSubmit(onSubmit)}>
    <BillingIdentityForm register={register} errors={errors} disabled={disabled} />
    <button type="submit">Comprobar datos</button>
  </form>;
}

it("explains a rejected digit in the buyer error slot and clears it on a valid edit", async () => {
  const submitted = vi.fn();
  render(<Example onSubmit={submitted} />);
  const user = userEvent.setup();
  const input = screen.getByLabelText("Nombre para la factura");
  await user.type(input, "Ana7");
  expect(input).toHaveValue("Ana");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute("aria-describedby", "billing-buyer-error");
  expect(input).toHaveAccessibleDescription("Usa solo letras, espacios, apóstrofes y guiones.");
  expect(document.querySelectorAll("#billing-buyer-error")).toHaveLength(1);
  await user.type(input, " María O’Connor-Pérez");
  await waitFor(() => expect(input).not.toHaveAttribute("aria-invalid", "true"));
  expect(screen.queryByText("Usa solo letras, espacios, apóstrofes y guiones.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Comprobar datos" }));
  await waitFor(() => expect(submitted).toHaveBeenCalled());
  expect(submitted.mock.calls[0][0]).toMatchObject({ buyerName: "Ana María O’Connor-Pérez", billingIdentity: { type: "EC_CEDULA", number: "0123456782" } });
});

it("replaces a validation error with the current rejection instead of stacking messages", async () => {
  render(<Example />);
  const user = userEvent.setup();
  const input = screen.getByLabelText("Nombre para la factura");
  await user.click(screen.getByRole("button", { name: "Comprobar datos" }));
  await waitFor(() => expect(input).toHaveAccessibleDescription("Escribe tus nombres."));
  await user.type(input, "7");
  expect(input).toHaveValue("");
  expect(input).toHaveAccessibleDescription("Usa solo letras, espacios, apóstrofes y guiones.");
  expect(document.querySelectorAll("#billing-buyer-error")).toHaveLength(1);
  expect(screen.queryByText("Escribe tus nombres.")).not.toBeInTheDocument();
  await user.type(input, "Ana");
  await waitFor(() => expect(input).not.toHaveAttribute("aria-invalid", "true"));
});

it("explains rejected paste and length limits while preserving the accepted name", async () => {
  render(<Example />);
  const user = userEvent.setup();
  const input = screen.getByLabelText("Nombre para la factura");
  await user.type(input, "Ana");
  await user.paste("12");
  expect(input).toHaveValue("Ana");
  expect(input).toHaveAccessibleDescription("Usa solo letras, espacios, apóstrofes y guiones.");
  fireEvent.change(input, { target: { value: "Á".repeat(120) } });
  await waitFor(() => expect(input).not.toHaveAttribute("aria-invalid", "true"));
  fireEvent.change(input, { target: { value: "Á".repeat(121) } });
  expect(input).toHaveValue("Á".repeat(120));
  expect(input).toHaveAccessibleDescription("No puedes escribir más de 120 caracteres.");
});

it("preserves disabled fields, billing purpose and the academic warning", () => {
  render(<Example disabled />);
  for (const label of ["Nombre para la factura", "Cédula", "Dirección de facturación", "Ciudad de facturación", "Provincia de facturación"]) {
    expect(screen.getByLabelText(label)).toBeDisabled();
  }
  expect(screen.getByText(/La dirección de facturación es independiente de la entrega/)).toBeInTheDocument();
  expect(screen.getByText("SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA")).toBeInTheDocument();
});
