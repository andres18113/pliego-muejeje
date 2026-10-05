import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { AddressForm } from "./AddressForm";

describe("AddressForm collapsed error recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { label: "Piso, departamento u oficina", limit: 200 },
    { label: "Código postal", limit: 20 },
    { label: "Referencia para la entrega", limit: 300 },
  ])("reveals and focuses an invalid $label without losing the draft", async ({ label, limit }) => {
    const onSaved = vi.fn();
    const api = stubApi({ "PUT /api/v1/me/addresses/15": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={onSaved} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    const summary = screen.getByText(/Agregar detalles de entrega/);
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    await user.click(summary);
    expect(details.open).toBe(true);
    const input = screen.getByLabelText(label);
    await user.click(input); await user.paste("x".repeat(limit + 1));
    await user.click(summary);
    expect(details.open).toBe(false);
    screen.getByRole("button", { name: "Guardar dirección" }).focus();
    await user.keyboard("{Enter}");
    const error = await screen.findByText(`Usa como máximo ${limit} caracteres.`);
    expect(details.open).toBe(true);
    expect(input).toBeVisible(); expect(error).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleName(label);
    expect(input).toHaveAccessibleDescription(`Usa como máximo ${limit} caracteres.`);
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("x".repeat(limit + 1));
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(0);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.paste("12345");
    screen.getByRole("button", { name: "Guardar dirección" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("15"));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ alias: "Casa", line1: savedAddress.line1 });
  });

  it("preserves the existing first-error focus when optional details are already open", async () => {
    stubApi({});
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar dirección" })).toBeEnabled());
    await user.click(screen.getByText(/Agregar detalles de entrega/));
    await user.click(screen.getByLabelText("Código postal")); await user.paste("x".repeat(21));
    const name = screen.getByLabelText("Nombre de la dirección");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await screen.findByText("Escribe un nombre para la dirección.");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(name).toHaveFocus();
  });
});
