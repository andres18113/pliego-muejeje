import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderPurchaseRoute, savedAddress, stubApi as stubPurchaseApi } from "@/test/purchase";
import { ADDRESS_TOAST_MS, AddressBookPage } from "./AddressBook";

/**
 * F03 and the Direcciones confirmations: a success is reported only after the server confirmed the requested
 * change, as one snackbar that leaves after ten seconds — never as a page banner, and never for a refused edit.
 */
const routes = [{ path: "/account/addresses", element: <AddressBookPage /> }];
const put = "PUT /api/v1/me/addresses/15";
const stubApi = (extra: Parameters<typeof stubPurchaseApi>[0] = {}) => stubPurchaseApi({
  "GET /api/v1/me/billing-identity": () => new Response(null, { status: 204 }),
  "GET /api/v1/me/addresses": () => json([savedAddress]),
  ...extra,
});
const toast = () => document.querySelector<HTMLElement>("[data-undo-toast]");

async function openEditor() {
  const user = userEvent.setup();
  renderPurchaseRoute(routes, "/account/addresses");
  await user.click(await screen.findByRole("button", { name: "Editar Casa" }));
  const editor = await screen.findByRole("dialog", { name: "Editar Casa" });
  const phone = within(editor).getByLabelText("Teléfono de contacto");
  await waitFor(() => expect(phone).toBeEnabled());
  return { user, editor, phone };
}

async function expectRefused(editor: HTMLElement, phone: HTMLElement, api: ReturnType<typeof stubApi>, description: string) {
  await userEvent.setup().click(within(editor).getByRole("button", { name: "Guardar dirección" }));
  await waitFor(() => expect(phone).toHaveFocus());
  expect(phone).toHaveAttribute("aria-invalid", "true");
  expect(phone).toHaveAccessibleDescription(description);
  expect(editor).toBeVisible();
  expect(api.count("PUT", "/api/v1/me/addresses")).toBe(0);
  expect(toast()).toBeNull();
  expect(screen.queryByText(/Guardamos|Dirección actualizada/)).not.toBeInTheDocument();
}

describe("Direcciones: phone edits and save feedback", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("F03: replacing the saved phone with letters blocks the save instead of keeping the old number", async () => {
    const api = stubApi({ [put]: () => new Response(null, { status: 204 }) });
    const { user, editor, phone } = await openEditor();
    expect(phone).toHaveValue("25550134");
    await user.clear(phone); await user.type(phone, "abc");
    expect(phone).toHaveValue("abc");
    await expectRefused(editor, phone, api, "Usa solo números.");
    // The draft is kept for correction; once corrected, the save carries the new number.
    await user.clear(phone); await user.type(phone, "991281194");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ phone: "+593991281194" });
  });

  it.each([
    ["a pasted number with a trunk zero", "0991281194", "Escríbelo sin el 0 inicial."],
    ["a pasted foreign number", "+44 20 7946 0018", "Solo se aceptan teléfonos de Ecuador (+593)."],
    ["a pasted extension", "991281194 ext 2", "Usa solo números."],
  ])("F03: %s over the saved phone blocks the save with its reason", async (_case, pasted, description) => {
    const api = stubApi();
    const { user, editor, phone } = await openEditor();
    await user.click(phone); await user.keyboard("{Control>}a{/Control}"); await user.paste(pasted);
    expect(phone).toHaveValue(pasted);
    await expectRefused(editor, phone, api, description);
  });

  it("F03: clearing the required phone asks for one instead of saving the previous number", async () => {
    const api = stubApi();
    const { user, editor, phone } = await openEditor();
    await user.clear(phone);
    await expectRefused(editor, phone, api, "Escribe un teléfono de contacto.");
  });

  it("confirms a saved change with one snackbar for ten seconds, never a banner, and returns focus to Editar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const updated = { ...savedAddress, phone: "+593991281194" };
    const api = stubApi({ "GET /api/v1/me/addresses": [() => json([savedAddress]), () => json([updated])], [put]: () => new Response(null, { status: 204 }) });
    const { user, editor, phone } = await openEditor();
    await user.clear(phone); await user.type(phone, "991281194");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(toast()).not.toBeNull());
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1);
    expect(toast()).toHaveTextContent("Dirección actualizada");
    expect(toast()!.closest("[role='status']")).toHaveTextContent("Dirección actualizada: Casa");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar Casa" })).not.toBeInTheDocument());
    expect(document.querySelector(".purchase-notice")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar Casa" })).toHaveFocus());
    expect(screen.getByText("+593 99 128 1194")).toBeInTheDocument();
    expect(ADDRESS_TOAST_MS).toBe(10_000);
    // The exact boundary is UndoToast's own test; here, the page gives it ten seconds (not the former five).
    expect(toast()!.style.getPropertyValue("--toast-duration")).toBe("10000ms");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(toast()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ADDRESS_TOAST_MS); });
    expect(toast()).toBeNull();
  });

  it("can be closed at once and a second save replaces the snackbar instead of stacking", async () => {
    const api = stubApi({ [put]: () => new Response(null, { status: 204 }) });
    const { user, editor, phone } = await openEditor();
    await user.clear(phone); await user.type(phone, "991281194");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(toast()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Editar Casa" }));
    const again = await screen.findByRole("dialog", { name: "Editar Casa" });
    const field = within(again).getByLabelText("Teléfono de contacto");
    await waitFor(() => expect(field).toBeEnabled());
    await user.clear(field); await user.type(field, "991281131");
    await user.click(within(again).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar Casa" })).not.toBeInTheDocument());
    expect(document.querySelectorAll("[data-undo-toast]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(toast()).toBeNull();
  });

  it("keeps a server-refused phone in the editor with the server's words and confirms nothing", async () => {
    const api = stubApi({ [put]: () => json({ code: "VALIDATION_ERROR", title: "Datos inválidos", detail: "Revisa los campos indicados.", status: 400, violations: [{ field: "phone", message: "Revisa los dígitos: ese número no corresponde a un celular o fijo válido de Ecuador." }] }, 400) });
    const { user, editor, phone } = await openEditor();
    await user.clear(phone); await user.type(phone, "991281194");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(phone).toHaveAccessibleDescription(/no corresponde a un celular o fijo válido/));
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1);
    expect(editor).toBeVisible();
    expect(toast()).toBeNull();
    expect(screen.queryByText(/Dirección actualizada|Guardamos/)).not.toBeInTheDocument();
  });

  it("reports an unconfirmed outcome as a problem, never as a saved change", async () => {
    stubApi({ [put]: () => problem(500, "INTERNAL_ERROR", "Error interno", "Inténtalo otra vez.") });
    const { user, editor, phone } = await openEditor();
    await user.clear(phone); await user.type(phone, "991281194");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("No pudimos confirmar si se guardaron los cambios.");
    expect(toast()).toBeNull();
  });

  it("closes without a request or a confirmation when nothing was changed", async () => {
    const api = stubApi({ [put]: () => new Response(null, { status: 204 }) });
    const { user, editor, phone } = await openEditor();
    await user.clear(phone); await user.type(phone, "25550134");
    await user.click(within(editor).getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar Casa" })).not.toBeInTheDocument());
    expect(api.count("PUT", "/api/v1/me/addresses")).toBe(0);
    expect(toast()).toBeNull();
    expect(document.querySelector(".purchase-notice")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar Casa" })).toHaveFocus());
  });

  it("confirms a new primary address with the same snackbar", async () => {
    const other = { ...savedAddress, addressId: "16", alias: "Trabajo", primary: false };
    let primary = "15";
    stubApi({
      "GET /api/v1/me/addresses": () => json([savedAddress, other].map((address) => ({ ...address, primary: address.addressId === primary }))),
      "PUT /api/v1/me/addresses/16/primary": () => { primary = "16"; return new Response(null, { status: 204 }); },
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account/addresses");
    await screen.findByRole("heading", { name: "Trabajo" });
    await user.click(screen.getByRole("button", { name: /^Usar como principal\s*Trabajo$/ }));
    await waitFor(() => expect(toast()).toHaveTextContent("Dirección principal actualizada"));
    expect(toast()!.closest("[role='status']")).toHaveTextContent("Dirección principal actualizada: Trabajo");
    expect(document.querySelector(".purchase-notice")).toBeNull();
    expect(screen.queryByText("Esta es ahora tu dirección principal.")).not.toBeInTheDocument();
  });

  it("reports a refused primary change as a problem on the page, never as a confirmation", async () => {
    const other = { ...savedAddress, addressId: "16", alias: "Trabajo", primary: false };
    stubApi({
      "GET /api/v1/me/addresses": () => json([savedAddress, other]),
      "PUT /api/v1/me/addresses/16/primary": () => problem(409, "P2010", "Dirección no disponible", "No pudimos usar esta dirección ahora."),
    });
    const user = userEvent.setup();
    renderPurchaseRoute(routes, "/account/addresses");
    await screen.findByRole("heading", { name: "Trabajo" });
    await user.click(screen.getByRole("button", { name: /^Usar como principal\s*Trabajo$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dirección no disponible. No pudimos usar esta dirección ahora.");
    expect(toast()).toBeNull();
    expect(document.querySelector(".purchase-notice--success")).toBeNull();
  });
});
