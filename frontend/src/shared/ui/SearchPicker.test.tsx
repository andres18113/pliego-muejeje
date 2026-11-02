import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { rankOptions, SearchPicker, searchKey } from "./CountryPicker";

const provinces = ["Azuay", "Bolívar", "Cañar", "Carchi", "Chimborazo", "Cotopaxi", "El Oro", "Esmeraldas", "Galápagos", "Guayas",
  "Imbabura", "Loja", "Los Ríos", "Manabí", "Morona Santiago", "Napo", "Orellana", "Pastaza", "Pichincha", "Santa Elena",
  "Santo Domingo de los Tsáchilas", "Sucumbíos", "Tungurahua", "Zamora Chinchipe"].map((name, index) => ({ code: String(index + 1), name }));
const names = (query: string) => rankOptions(provinces, query).map(option => option.name);
const wording = { choose: "Elige una provincia", one: "provincia", many: "provincias", noMatch: "Prueba con otro nombre" };

function Harness({ onChange = () => {}, initial = "" }: { onChange?: (code: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PliegoThemeProvider>
    <SearchPicker id="province" label="Provincia" options={provinces} value={value} wording={wording} searchPlaceholder="Busca una provincia"
      onChange={(code) => { onChange(code); setValue(code); }} />
    <button type="button">Después</button>
  </PliegoThemeProvider>;
}

const search = () => screen.getByRole("combobox", { name: "Buscar provincia" });
/** The row the search's active descendant points at, by its accessible name (the check icon is aria-hidden). */
const expectActive = (name: string) => expect(search()).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name }).id);

describe("search ranking", () => {
  it("puts names that start with the text first, then word starts, then any containing name", () => {
    expect(names("or")).toEqual(["Orellana", "El Oro", "Chimborazo", "Morona Santiago", "Zamora Chinchipe"]);
  });

  it("ignores accents, case, punctuation and extra spaces", () => {
    expect(names("GALAPAGOS")).toEqual(["Galápagos"]);
    expect(names("cañ")).toEqual(["Cañar"]);
    expect(names("canar")).toEqual(["Cañar"]);
    expect(names("  santo   DOMINGO ")).toEqual(["Santo Domingo de los Tsáchilas"]);
    expect(names("los rios")).toEqual(["Los Ríos"]);
    expect(searchKey("+593")).toBe("593");
  });

  it("is deterministic: ties keep the catalog order, every time", () => {
    expect(names("sa")).toEqual(["Santa Elena", "Santo Domingo de los Tsáchilas", "Morona Santiago"]);
    expect(names("sa")).toEqual(names("sa"));
  });

  it("matches other names last and shows nothing for no match; an empty search keeps the list as given", () => {
    const cities = [{ code: "1", name: "Guayaquil" }, { code: "2", name: "General Antonio Elizalde" }];
    expect(rankOptions(cities, "bucay", city => (city.code === "2" ? "General Elizalde (Bucay) Bucay" : ""))).toEqual([cities[1]]);
    expect(rankOptions(provinces, "xyz")).toEqual([]);
    expect(rankOptions(provinces, "   ")).toBe(provinces);
  });
});

describe("keyboard-first search", () => {
  it("opens the search with the first key typed on the trigger, its best match active, and Enter chooses it", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Provincia" })).toHaveFocus();
    await user.keyboard("o");
    await waitFor(() => expect(search()).toHaveFocus());
    expect(search()).toHaveValue("o");
    await user.keyboard("r");
    expect(search()).toHaveValue("or");
    expectActive("Orellana");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("17");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Provincia" })).toHaveFocus());
    expect(screen.getByRole("combobox", { name: "Provincia" })).toHaveTextContent("Orellana");
  });

  it("keeps every key typed before the search takes focus, in order, including corrections", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    // Keys that land on the trigger in the same frame the panel opens.
    for (const key of ["p", "i", "x", "Backspace", "c"]) fireEvent.keyDown(trigger, { key });
    await waitFor(() => expect(search()).toHaveFocus());
    expect(search()).toHaveValue("pic");
    expectActive("Pichincha");
  });

  it("answers keys that land on the trigger before the search has focus: arrows move, Enter chooses the active row", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    // All three land in the same frame, before the panel's list has even mounted: none is lost or reordered.
    for (const key of ["g", "ArrowDown", "Enter"]) fireEvent.keyDown(trigger, { key });
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith("10"));
    await waitFor(() => expect(trigger).toHaveTextContent("Guayas"));
  });

  it("never chooses by accident: Enter on an open trigger without a search or arrows only closes it", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    // Opened without typing (as a tap does), then Enter before anything was searched or moved.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Elige una provincia");
  });

  it("closes only itself on Escape from the trigger, marked so window-level Escape handlers around it skip the event", async () => {
    const onChange = vi.fn();
    const around = vi.fn();
    const outer = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && (event.target as HTMLElement).getAttribute("data-mantine-stop-propagation") !== "true") around();
    };
    window.addEventListener("keydown", outer);
    try {
      render(<Harness onChange={onChange} />);
      const trigger = screen.getByRole("combobox", { name: "Provincia" });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "l" });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(around).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      // Closed, the trigger is an ordinary field again: Escape belongs to whatever surrounds it.
      expect(trigger).not.toHaveAttribute("data-mantine-stop-propagation");
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(around).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("moves with the arrows and never changes the value without Enter or a click (Escape, Tab)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="10" />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    await user.keyboard("g");
    await waitFor(() => expect(search()).toHaveFocus());
    expectActive("Galápagos");
    await user.keyboard("{ArrowDown}");
    expectActive("Guayas");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expectActive("Galápagos");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("Guayas");
    await user.keyboard("l");
    await waitFor(() => expect(search()).toHaveFocus());
    expect(search()).toHaveValue("l");
    await user.keyboard("{Tab}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Guayas");
  });

  it("says when nothing matches, and Enter then chooses nothing", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    screen.getByRole("combobox", { name: "Provincia" }).focus();
    await user.keyboard("x");
    await waitFor(() => expect(search()).toHaveFocus());
    await user.keyboard("yz{Enter}");
    expect(screen.getByText("No encontramos «xyz». Prueba con otro nombre.")).toBeInTheDocument();
    expect(screen.getByRole("listbox", { hidden: true })).not.toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Backspace}{Backspace}{Backspace}");
    expect(screen.getAllByRole("option")).toHaveLength(provinces.length);
  });

  it("starts each opening with a fresh search: a click shows the whole list on the current choice", async () => {
    render(<Harness initial="12" />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    await user.keyboard("z");
    await waitFor(() => expect(search()).toHaveValue("z"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(search()).toHaveValue(""));
    expect(screen.getAllByRole("option")).toHaveLength(provinces.length);
    expectActive("Loja");
    expect(screen.getByRole("option", { name: "Loja" })).toHaveAttribute("aria-selected", "true");
  });

  it("leaves shortcuts alone: Ctrl/Cmd combinations and Tab on the closed trigger do not open the search", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Provincia" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "c", ctrlKey: true });
    fireEvent.keyDown(trigger, { key: "v", metaKey: true });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Después" })).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
