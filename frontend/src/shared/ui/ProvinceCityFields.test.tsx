import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubApi } from "@/test/purchase";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { ProvinceCityFields } from "./ProvinceCityFields";

function Harness({ onChange, initial = { provinceId: "", cityId: "" } }: {
  onChange: (next: { provinceId: string; cityId: string }) => void; initial?: { provinceId: string; cityId: string };
}) {
  const [place, setPlace] = useState(initial);
  return <ProvinceCityFields idPrefix="address" provinceId={place.provinceId} cityId={place.cityId}
    onChange={(next) => { onChange(next); setPlace(next); }} />;
}

function renderFields(onChange = vi.fn(), initial?: { provinceId: string; cityId: string }) {
  stubApi({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PliegoThemeProvider><Harness onChange={onChange} initial={initial} /></PliegoThemeProvider></QueryClientProvider>);
  return onChange;
}

const province = () => screen.getByRole("combobox", { name: "Provincia" });
const city = () => screen.getByRole("combobox", { name: "Ciudad" });
const searchFor = (label: string) => screen.getByRole("combobox", { name: `Buscar ${label}` });
const expectActive = (label: string, name: string | RegExp) =>
  expect(searchFor(label)).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name }).id);

describe("province and city, keyboard first", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("types a province, then a city of that province, choosing each with Enter", async () => {
    const onChange = renderFields();
    const user = userEvent.setup();
    await waitFor(() => expect(province()).toBeEnabled());
    expect(city()).toBeDisabled();
    expect(city()).toHaveTextContent("Elige primero la provincia");
    province().focus();
    await user.keyboard("pich");
    await waitFor(() => expect(searchFor("provincia")).toHaveValue("pich"));
    expectActive("provincia", "Pichincha");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ provinceId: "17", cityId: "" });
    await waitFor(() => expect(city()).toBeEnabled());
    expect(city()).toHaveTextContent("Elige una ciudad");
    city().focus();
    // Accent-insensitive: "sangolqui" finds Sangolquí.
    await user.keyboard("SANGOLQUI");
    await waitFor(() => expect(searchFor("ciudad")).toHaveValue("SANGOLQUI"));
    expectActive("ciudad", /^Sangolquí/);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ provinceId: "17", cityId: "952" });
    expect(city()).toHaveTextContent("Sangolquí");
  });

  it("clears the city when another province is chosen, never when the same one is chosen again", async () => {
    const onChange = renderFields(vi.fn(), { provinceId: "17", cityId: "893" });
    const user = userEvent.setup();
    await waitFor(() => expect(city()).toHaveTextContent("Quito"));
    province().focus();
    await user.keyboard("pichincha");
    await waitFor(() => expect(searchFor("provincia")).toHaveValue("pichincha"));
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(city()).toHaveTextContent("Quito");
    await waitFor(() => expect(province()).toHaveFocus());
    await user.keyboard("gua");
    await waitFor(() => expect(searchFor("provincia")).toHaveValue("gua"));
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ provinceId: "9", cityId: "" });
    await waitFor(() => expect(city()).toHaveTextContent("Elige una ciudad"));
  });

  it("finds a place by its other name and says why the row is there; a city search never offers another province's places", async () => {
    renderFields(vi.fn(), { provinceId: "9", cityId: "" });
    const user = userEvent.setup();
    await waitFor(() => expect(city()).toBeEnabled());
    city().focus();
    await user.keyboard("bucay");
    await waitFor(() => expect(searchFor("ciudad")).toHaveValue("bucay"));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expectActive("ciudad", /^General Antonio Elizalde/);
    expect(screen.getByRole("option", { name: /General Antonio Elizalde/ })).toHaveTextContent("Bucay");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(city()).toHaveFocus());
    await user.keyboard("quito");
    await waitFor(() => expect(searchFor("ciudad")).toHaveValue("quito"));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No encontramos «quito»/)).toBeInTheDocument();
  });
});
