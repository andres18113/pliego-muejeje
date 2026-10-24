import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountPage } from "./AccountPage";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";

const profile = { customerId: "2", email: "ana@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: "+593991234567", state: "ACTIVE", version: "0", emailVerified: true };
function renderProfile() {
  const api = stubApi({ "GET /api/v1/me": () => json(profile), "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }) });
  return { ...renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account"), api };
}
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it.each(["nombres", "apellidos"])("keeps rejected %s feedback on blur until an accepted edit or cancellation", async label => {
  const { api } = renderProfile(); const user = userEvent.setup();
  const editName = `Editar ${label}`;
  await user.click(await screen.findByRole("button", { name: editName }));
  const form = screen.getByRole("form", { name: editName });
  const input = within(form).getByRole("textbox");
  await user.clear(input); await user.type(input, "Ana1");
  expect(input).toHaveValue("Ana");
  const rejection = input.getAttribute("aria-describedby");
  expect(rejection).toBeTruthy();
  const message = document.getElementById(rejection!)!.textContent;
  await user.tab();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription(message!);
  await user.click(input); await user.type(input, " María");
  expect(input).not.toHaveAttribute("aria-invalid", "true");
  await user.type(input, "1");
  await user.click(within(form).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("form", { name: editName })).not.toBeInTheDocument();
  expect(api.count("PATCH", "/api/v1/me")).toBe(0);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: editName })).toHaveFocus());
  await user.click(screen.getByRole("button", { name: editName }));
  expect(screen.getByRole("form", { name: editName })).not.toHaveTextContent(message!);
});

it("still validates an incomplete name on blur and clears the error after a valid edit", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  const input = screen.getByLabelText("Nombres");
  await user.clear(input);
  expect(input).not.toHaveAttribute("aria-invalid", "true");
  await user.tab();
  expect(input).toHaveAttribute("aria-invalid", "true");
  await user.click(input); await user.type(input, "Ana");
  expect(input).not.toHaveAttribute("aria-invalid", "true");
});

it("removes the pending-change notice when the user restores the original value", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  const input = screen.getByLabelText("Nombres");
  fireEvent.change(input, { target: { value: "Ana María" } });
  const form = screen.getByRole("form", { name: "Editar nombres" });
  expect(within(form).getByRole("status")).toHaveTextContent("Cambios sin guardar");
  fireEvent.change(input, { target: { value: "Ana" } });
  expect(within(form).queryByRole("status")).not.toBeInTheDocument();
});

it("keeps email verification help brief and separates it from the unsaved state", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
  const form = screen.getByRole("form", { name: "Cambiar correo electrónico" });
  expect(within(form).getByText("Te enviaremos un enlace para verificar el nuevo correo.")).toBeInTheDocument();
  expect(within(form).queryByText(/sesiones anteriores|vence según su duración/)).not.toBeInTheDocument();
  expect(within(form).queryByText("Cambios sin guardar")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Nuevo correo"), "nueva@example.invalid");
  expect(within(form).getAllByText("Cambios sin guardar")).toHaveLength(1);
  expect(within(form).getByRole("status")).toHaveTextContent("Cambios sin guardar");
  const actions = within(form).getByRole("group", { name: "Acciones de edición" });
  expect(within(actions).getByText("Cambios sin guardar")).toBeInTheDocument();
  expect(within(form).queryByText(/Conservamos tu borrador si sales/)).not.toBeInTheDocument();
  const disclosure = within(form).getByText("Seguridad del cambio");
  expect(disclosure.closest("details")).not.toHaveAttribute("open");
  await user.click(disclosure);
  expect(disclosure.closest("details")).toHaveAttribute("open");
  expect(within(form).getByText(/Cuando tu sesión termine, tendrás que iniciar sesión de nuevo/)).toBeVisible();
});

it("does not show a length error on each phone keystroke, but validates when leaving", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar teléfono" }));
  const input = screen.getByLabelText("Teléfono");
  await user.clear(input); await user.type(input, "93141");
  expect(input).not.toHaveAttribute("aria-invalid", "true");
  await user.tab();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription(/9 dígitos/);
});

it("shows a rejected phone character without stacking the parent length error", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar teléfono" }));
  const input = screen.getByLabelText("Teléfono");
  await user.clear(input); await user.type(input, "93141");
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "93141a" } });
  const form = screen.getByRole("form", { name: "Editar teléfono" });
  expect(form.querySelectorAll(".field-error")).toHaveLength(1);
  expect(input).toHaveAccessibleDescription(/solo.*(dígitos|números)/i);
  expect(within(form).queryByText(/debe tener 9 dígitos/)).not.toBeInTheDocument();
});
