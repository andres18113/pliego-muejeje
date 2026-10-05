import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountPage } from "./AccountPage";
import { json, renderPurchaseRoute, stubApi } from "@/test/purchase";
const profile = { customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez", phone: null, state: "ACTIVE", version: "0" };
const routes = [{ path: "/account", element: <AccountPage /> }, { path: "/orders", element: <h1>Mis pedidos</h1> }];
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
it("restores an unsaved profile draft after leaving and returning", async () => {
  stubApi({ "GET /api/v1/me": () => json(profile) });
  const { router } = renderPurchaseRoute(routes, "/account");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Ana María");
  await act(async () => { await router.navigate("/orders"); });
  await screen.findByRole("heading", { name: "Mis pedidos" });
  await act(async () => { await router.navigate("/account"); });
  expect(await screen.findByLabelText("Nombres")).toHaveValue("Ana María");
  expect(screen.getByRole("status")).toHaveTextContent(/borrador|sin guardar/i);
});
it("preserves typing during save and saves the next edit against the new version", async () => {
  let release!: (response: Response) => void;
  let current = profile;
  const api = stubApi({ "GET /api/v1/me": () => json(current), "PATCH /api/v1/me": [() => new Promise<Response>((resolve) => { release = resolve; }), () => {
    current = { ...profile, firstNames: "Ana María Isabel", version: "2" }; return new Response(null, { status: 204 });
  }] });
  renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  const input = screen.getByLabelText("Nombres");
  await user.clear(input); await user.type(input, "Ana María");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(api.count("PATCH", "/api/v1/me")).toBe(1));
  await user.type(input, " Isabel"); current = { ...profile, firstNames: "Ana María", version: "1" };
  await act(async () => { release(new Response(null, { status: 204 })); });
  expect(screen.getByLabelText("Nombres")).toHaveValue("Ana María Isabel"); expect(screen.getByLabelText("Nombres")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(api.calls.filter(c => c.method === "PATCH")[1]?.body).toEqual({ field: "firstNames", value: "Ana María Isabel", expectedVersion: "1" }));
  await waitFor(() => expect(screen.queryByLabelText("Nombres")).not.toBeInTheDocument());
});

it("retains the draft's old version after navigation instead of silently overwriting a concurrent edit", async () => {
  let current = profile;
  const api = stubApi({ "GET /api/v1/me": () => json(current), "PATCH /api/v1/me": () => json({ code: "P1104", title: "Tu perfil cambió", detail: "Revisa el dato actual", status: 409 }, 409) });
  const { router } = renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Ana María");
  await act(async () => { await router.navigate("/orders"); });
  current = { ...profile, firstNames: "Ana Isabel", version: "1" };
  await act(async () => { await router.navigate("/account"); });
  await user.click(await screen.findByRole("button", { name: "Guardar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos lo que escribiste.");
  expect(screen.getByLabelText("Nombres")).toHaveValue("Ana María");
  expect(api.calls.find(c => c.method === "PATCH")?.body).toMatchObject({ expectedVersion: "0" });
});

it("updates a restored draft's version when an earlier in-flight save completes", async () => {
  let release!: (response: Response) => void;
  let current = profile;
  const api = stubApi({ "GET /api/v1/me": () => json(current), "PATCH /api/v1/me": [() => new Promise<Response>(resolve => { release = resolve; }), () => new Response(null, { status: 204 })] });
  const { router } = renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  await user.clear(screen.getByLabelText("Nombres")); await user.type(screen.getByLabelText("Nombres"), "Ana María");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.type(screen.getByLabelText("Nombres"), " Isabel");
  await act(async () => { await router.navigate("/orders"); await router.navigate("/account"); });
  expect(await screen.findByLabelText("Nombres")).toHaveValue("Ana María Isabel");
  expect(screen.getByRole("button", { name: /Guardando/ })).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("button", { name: /Guardando/ }));
  expect(api.count("PATCH", "/api/v1/me")).toBe(1);
  current = { ...profile, firstNames: "Ana María", version: "1" };
  await act(async () => { release(new Response(null, { status: 204 })); });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardamos el dato enviado."));
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(api.calls.filter(c => c.method === "PATCH")[1]?.body).toMatchObject({ value: "Ana María Isabel", expectedVersion: "1" }));
});

it("retains newer email and password input during save without storing the password", async () => {
  let release!: (response: Response) => void;
  let current = profile;
  stubApi({ "GET /api/v1/me": () => json(current), "PUT /api/v1/me/email": () => new Promise<Response>(resolve => { release = resolve; }) });
  renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar correo electrónico" }));
  await user.type(screen.getByLabelText("Nuevo correo"), "nueva@example.com");
  await user.type(screen.getByLabelText("Contraseña actual"), "Clave-enviada");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.clear(screen.getByLabelText("Nuevo correo")); await user.type(screen.getByLabelText("Nuevo correo"), "otra@example.com");
  await user.clear(screen.getByLabelText("Contraseña actual")); await user.type(screen.getByLabelText("Contraseña actual"), "Clave-nueva");
  current = { ...profile, email: "nueva@example.com", version: "1" };
  await act(async () => { release(json({ email: "nueva@example.com" })); });
  expect(screen.getByLabelText("Nuevo correo")).toHaveValue("otra@example.com");
  expect(screen.getByLabelText("Contraseña actual")).toHaveValue("Clave-nueva");
  const stored = sessionStorage.getItem("pliego-profile-draft:2:email");
  expect(stored).toContain("otra@example.com"); expect(stored).not.toContain("Clave-");
});

it("retains phone text and country choice when navigating away", async () => {
  stubApi({ "GET /api/v1/me": () => json(profile), "GET /api/v1/reference/countries": () => json([{ code: "EC", name: "Ecuador" }, { code: "CO", name: "Colombia" }]) });
  const { router } = renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
  await user.click(await screen.findByRole("combobox", { name: /^Prefijo internacional$/ }));
  await user.click(await screen.findByRole("option", { name: /Colombia/ }));
  await user.type(screen.getByLabelText("Teléfono", { exact: true }), "3001234567");
  const value = (screen.getByLabelText("Teléfono", { exact: true }) as HTMLInputElement).value;
  await act(async () => { await router.navigate("/orders"); await router.navigate("/account"); });
  expect(await screen.findByLabelText("Teléfono", { exact: true })).toHaveValue(value);
  expect(screen.getByRole("combobox", { name: /^Prefijo internacional$/ })).toHaveTextContent("+57");
});

it("lets Escape explicitly discard a draft and recover focus", async () => {
  stubApi({ "GET /api/v1/me": () => json(profile) });
  const { router } = renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
  await user.type(screen.getByLabelText("Nombres"), " nueva"); await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar nombres" })).toHaveFocus());
  await act(async () => { await router.navigate("/orders"); await router.navigate("/account"); });
  expect(screen.queryByLabelText("Nombres")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("pliego-profile-draft:2:firstNames")).toBeNull();
});

it("restores invalid phone text exactly so the reader can correct it", async () => {
  stubApi({ "GET /api/v1/me": () => json(profile), "GET /api/v1/reference/countries": () => json([{ code: "EC", name: "Ecuador" }]) });
  const { router } = renderPurchaseRoute(routes, "/account"); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Agregar teléfono" }));
  fireEvent.change(screen.getByLabelText("Teléfono", { exact: true }), { target: { value: "123abc" } });
  const before = (screen.getByLabelText("Teléfono", { exact: true }) as HTMLInputElement).value;
  expect(before).toContain("abc");
  await act(async () => { await router.navigate("/orders"); await router.navigate("/account"); });
  expect(await screen.findByLabelText("Teléfono", { exact: true })).toHaveValue(before);
});
