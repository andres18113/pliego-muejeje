import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPurchaseRoute, savedAddress, stubApi } from "@/test/purchase";
import { AddressForm } from "./AddressForm";

describe("AddressForm collapsed error recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Ecuador fixed and validates phone length on blur with one prioritized message", async () => {
    const api = stubApi({});
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    const country = screen.getByLabelText("País de entrega");
    expect(country).toHaveValue("Ecuador");
    expect(country).toHaveAttribute("readonly");
    expect(country.closest(".form-field")?.querySelector("img")).toHaveAttribute("src", expect.stringContaining("EC.svg"));
    const phone = screen.getByLabelText("Teléfono de contacto");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.clear(phone); await user.type(phone, "99");
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/991234567/);
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/9 dígitos/);
    const field = phone.closest(".form-field")!;
    expect(field.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
    await user.type(phone, "a");
    expect(phone).toHaveValue("99");
    expect(phone).toHaveAccessibleDescription(/solo números/i);
    expect(phone).not.toHaveAccessibleDescription(/9 dígitos/);
    expect(field.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
    await user.tab();
    expect(phone).toHaveAccessibleDescription(/solo números/i);
    await user.type(phone, "1");
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(0);
  });

  it("focuses an invalid phone on submit and preserves the address draft through correction", async () => {
    const onSaved = vi.fn();
    const api = stubApi({ "PUT /api/v1/me/addresses/15": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={onSaved} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const user = userEvent.setup();
    const phone = screen.getByLabelText("Teléfono de contacto");
    await waitFor(() => expect(phone).toBeEnabled());
    await user.clear(phone);
    await user.type(phone, "99");
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(phone).toHaveFocus());
    expect(phone).toHaveAccessibleDescription(/9 dígitos/);
    expect(phone.closest(".form-field")!.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(0);
    await user.clear(phone);
    await user.paste("+593991234567");
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("15"));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ phone: "+593991234567", line1: savedAddress.line1 });
  });

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
    // Bypass the browser limit to retain validation/recovery coverage for injected invalid state.
    fireEvent.change(input, { target: { value: "x".repeat(limit + 1) } });
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
    fireEvent.change(screen.getByLabelText("Código postal"), { target: { value: "x".repeat(21) } });
    const name = screen.getByLabelText("Nombre de la dirección");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await screen.findByText("Escribe un nombre para la dirección.");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(name).toHaveFocus();
  });

  it("takes the province first, then only that province's places, and sends catalog ids", async () => {
    const api = stubApi({ "PUT /api/v1/me/addresses/15": () => new Response(null, { status: 204 }) });
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const province = await screen.findByRole("combobox", { name: "Provincia" });
    const city = screen.getByRole("combobox", { name: "Ciudad" });
    // The saved address reads back by name; province comes before city in the form.
    await waitFor(() => expect(city).toHaveTextContent("Quito"));
    expect(province).toHaveTextContent("Pichincha");
    expect(province.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(city);
    const places = within(await screen.findByRole("listbox", { name: "Ciudad" }));
    expect(places.getAllByRole("option").map(option => option.textContent?.replace("check", ""))).toEqual(["El QuincheQuito", "Quito", "SangolquíRumiñahui"]);
    expect(places.queryByRole("option", { name: /Guayaquil/ })).not.toBeInTheDocument();
    // The canton finds its seat: "Rumiñahui" is Sangolquí.
    fireEvent.change(screen.getByRole("combobox", { name: "Buscar ciudad" }), { target: { value: "rumiñahui" } });
    expect(places.getAllByRole("option").map(option => option.textContent?.replace("check", ""))).toEqual(["SangolquíRumiñahui"]);
    fireEvent.click(places.getByRole("option", { name: /Sangolquí/ }));
    await waitFor(() => expect(city).toHaveTextContent("Sangolquí"));
    // Another province clears a city that belongs to the previous one.
    fireEvent.click(province);
    fireEvent.click(await screen.findByRole("option", { name: "Guayas" }));
    await waitFor(() => expect(city).toHaveTextContent("Elige una ciudad"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(city).toHaveAccessibleDescription("Elige la ciudad."));
    await waitFor(() => expect(city).toHaveFocus());
    expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(0);
    fireEvent.click(city);
    fireEvent.click(await screen.findByRole("option", { name: /Guayaquil/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar dirección" }));
    await waitFor(() => expect(api.count("PUT", "/api/v1/me/addresses/15")).toBe(1));
    const body = api.calls.find(call => call.method === "PUT")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ provinceId: "9", cityId: "432" });
    expect(body).not.toHaveProperty("city");
    expect(body).not.toHaveProperty("province");
  });

  it("asks an older address whose city is not in the catalog to choose it, without calling it an error", async () => {
    stubApi({});
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={{ ...savedAddress, city: "Quito Norte", cityId: null, cityNeedsReview: true }} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const city = await screen.findByRole("combobox", { name: "Ciudad" });
    await waitFor(() => expect(city).toBeEnabled());
    expect(city).toHaveTextContent("Elige una ciudad");
    expect(city).toHaveAccessibleDescription("Elige tu ciudad de la lista para actualizar esta dirección.");
    expect(city).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("combobox", { name: "Provincia" })).toHaveTextContent("Pichincha");
  });

  it("finds a place by the common name the INEC records for it, without a second row", async () => {
    stubApi({});
    renderPurchaseRoute([{ path: "/address", element: <AddressForm address={savedAddress} firstAddress={false}
      onSaved={async () => undefined} onUncertain={async () => undefined} onSessionExpired={() => undefined} /> }], "/address");
    const province = await screen.findByRole("combobox", { name: "Provincia" });
    await waitFor(() => expect(province).toBeEnabled());
    fireEvent.click(province);
    fireEvent.click(await screen.findByRole("option", { name: "Guayas" }));
    const city = screen.getByRole("combobox", { name: "Ciudad" });
    await waitFor(() => expect(city).toBeEnabled());
    fireEvent.click(city);
    const places = within(await screen.findByRole("listbox", { name: "Ciudad" }));
    const rows = () => places.getAllByRole("option").map(option => option.textContent?.replace("check", ""));
    // Unsearched, a row names only its canton when its own name does not: Guayaquil's urban parishes stay quiet.
    expect(rows()).toEqual(expect.arrayContaining(["General Antonio Elizalde", "General VillamilPlayas", "Guayaquil"]));
    // A search that matches only another INEC name shows that name, so the row says why it is there; never a second row.
    const search = screen.getByRole("combobox", { name: "Buscar ciudad" });
    fireEvent.change(search, { target: { value: "bucay" } });
    expect(rows()).toEqual(["General Antonio ElizaldeBucay"]);
    fireEvent.change(search, { target: { value: "chongon" } });
    expect(rows()).toEqual(["GuayaquilChongón"]);
    fireEvent.change(search, { target: { value: "bucay" } });
    fireEvent.click(places.getByRole("option", { name: /General Antonio Elizalde/ }));
    await waitFor(() => expect(city).toHaveTextContent("General Antonio Elizalde"));
  });
});
