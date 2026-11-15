import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage, FEEDBACK_LIFETIME_MS } from "./AccountPage";
import { json, problem, renderPurchaseRoute, stubApi } from "@/test/purchase";

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

it("keeps the email change to one helper line and shows the draft state with the fields, not the actions", async () => {
  renderProfile(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
  const form = screen.getByRole("form", { name: "Cambiar correo electrónico" });
  expect(screen.getByLabelText("Nuevo correo")).toHaveAccessibleDescription("Te enviaremos un enlace a esa dirección.");
  // No security essay before a simple action: no disclosure, no session or cancellation paragraphs.
  expect(form.querySelector("details")).toBeNull();
  expect(within(form).queryByText(/sesiones|Seguridad del cambio|correo actual sigue en uso/)).not.toBeInTheDocument();
  expect(within(form).queryByText("Cambios sin guardar")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Nuevo correo"), "nueva@example.invalid");
  expect(within(form).getAllByText("Cambios sin guardar")).toHaveLength(1);
  expect(within(form).getByRole("status")).toHaveTextContent("Cambios sin guardar");
  // Guardar/Cancelar keep their slot to themselves; the draft state closes the fields column.
  const actions = within(form).getByRole("group", { name: "Acciones de edición" });
  expect(within(actions).queryByText("Cambios sin guardar")).not.toBeInTheDocument();
  expect(within(actions).getAllByRole("button")).toHaveLength(2);
  expect(within(form).queryByText(/Conservamos tu borrador si sales/)).not.toBeInTheDocument();
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

describe("feedback lifecycle", () => {
  afterEach(() => { vi.useRealTimers(); });
  function renderWith(routes: Parameters<typeof stubApi>[0]) {
    stubApi({ "GET /api/v1/me": () => json(profile), "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }), ...routes });
    return renderPurchaseRoute([{ path: "/account", element: <AccountPage /> }], "/account");
  }

  it("lets a confirmation leave on its own after about twelve seconds, and waits while the pointer rests on it", async () => {
    renderWith({ "PATCH /api/v1/me": () => new Response(null, { status: 204 }) });
    fireEvent.click(await screen.findByRole("button", { name: "Editar nombres" }));
    fireEvent.change(screen.getByLabelText("Nombres"), { target: { value: "Ana María" } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const saved = await screen.findByText("Guardamos tus nombres.");
    expect(saved).toHaveAttribute("role", "status");
    await act(async () => vi.advanceTimersByTime(FEEDBACK_LIFETIME_MS - 2_000));
    expect(saved).toBeInTheDocument();
    fireEvent.pointerEnter(saved);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(saved).toBeInTheDocument();
    fireEvent.pointerLeave(saved);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(saved).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1_100));
    expect(saved).toHaveAttribute("data-leaving");
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByText("Guardamos tus nombres.")).not.toBeInTheDocument();
    // Focus stays on the action it returned to; nothing else on the sheet moved.
    expect(screen.getByRole("button", { name: "Editar nombres" })).toHaveFocus();
  });

  it("keeps an error until the person acts again", async () => {
    renderWith({ "POST /api/v1/auth/forgot-password": () => problem(429, "RATE_LIMITED", "Demasiadas solicitudes", "Espera.") });
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    const alert = await screen.findByRole("alert");
    await act(async () => vi.advanceTimersByTime(FEEDBACK_LIFETIME_MS * 5));
    expect(alert).toBeInTheDocument();
    expect(alert).not.toHaveAttribute("data-leaving");
  });

  it("keeps the password confirmation while its one-minute wait lasts, then lets it go", async () => {
    renderWith({ "POST /api/v1/auth/forgot-password": () => json({ message: "ok" }, 202) });
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    const sent = await screen.findByText(/podrás pedir otro enlace en un minuto/);
    await act(async () => vi.advanceTimersByTime(45_000));
    expect(sent).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(16_000));
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByText(/podrás pedir otro enlace en un minuto/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar contraseña" })).not.toHaveAttribute("aria-disabled");
  });
});
