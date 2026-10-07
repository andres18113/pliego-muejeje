import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { ChoicePicker } from "./ChoicePicker";

it("exposes a collapsed combobox and keyboard-controlled listbox state", async () => {
  const onChange = vi.fn();
  render(<PliegoThemeProvider><ChoicePicker label="Ordenar por" value="title"
    options={[{ value: "title", label: "Título" }, { value: "price", label: "Precio" }]} onChange={onChange} />
  </PliegoThemeProvider>);
  const trigger = screen.getByRole("combobox", { name: "Ordenar por" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  trigger.focus();
  const user = userEvent.setup();
  await user.keyboard("{ArrowDown}");
  const list = await screen.findByRole("listbox", { name: "Ordenar por" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", list.id);
  expect(trigger).toHaveFocus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onChange).toHaveBeenCalledWith("price");
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  expect(trigger).toHaveFocus();
});
