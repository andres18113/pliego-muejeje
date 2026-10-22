import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { PasswordInput } from "./PasswordInput";

it("reveals and hides the password with one named eye button without moving focus", async () => {
  const user = userEvent.setup();
  render(<><label htmlFor="secret">Contraseña</label><PasswordInput id="secret" defaultValue="Lectura-segura-2026" /></>);
  const input = screen.getByLabelText("Contraseña");
  const eye = screen.getByRole("button", { name: "Mostrar contraseña" });
  expect(input).toHaveAttribute("type", "password");
  expect(eye).toHaveAttribute("aria-pressed", "false");
  expect(eye).toHaveAttribute("aria-controls", "secret");
  expect(eye).toHaveTextContent("visibility");
  await user.click(input);
  await user.click(eye);
  expect(input).toHaveAttribute("type", "text");
  expect(eye).toHaveAttribute("aria-pressed", "true");
  expect(eye).toHaveTextContent("visibility_off");
  expect(input).toHaveFocus();
  await user.click(eye);
  expect(input).toHaveAttribute("type", "password");
});

it("follows the field when it is disabled", () => {
  render(<PasswordInput id="secret" aria-label="Contraseña" disabled />);
  expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeDisabled();
});
