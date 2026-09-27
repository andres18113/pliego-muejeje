import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CatalogFilters } from "./CatalogFilters";
import { readCatalogCriteria } from "./catalogUrl";

describe("CatalogFilters", () => {
  const filterOptions = { languages: ["en", "es"], minimumPrice: "7.25", maximumPrice: "38.00" };

  it("applies the selected minimum price from the database-backed range slider", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <CatalogFilters
        criteria={readCatalogCriteria("")}
        categories={[]}
        filterOptions={filterOptions}
        filterOptionsLoading={false}
        filterOptionsError=""
        pending={false}
        onApply={onApply}
        onSort={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const minimum = screen.getByLabelText("Precio mínimo");
    expect(minimum).toHaveAttribute("type", "range");
    expect(minimum).toHaveAttribute("value", "7.25");
    fireEvent.change(minimum, { target: { value: "10.50" } });
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ minPrice: "10.50" })));
  });

  it("mounts both controlled sliders on the displayed and announced bounds", () => {
    render(
      <CatalogFilters
        criteria={readCatalogCriteria("")}
        categories={[]}
        filterOptions={filterOptions}
        filterOptionsLoading={false}
        filterOptionsError=""
        pending={false}
        onApply={vi.fn()}
        onSort={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const minimum = screen.getByLabelText("Precio mínimo");
    const maximum = screen.getByLabelText("Precio máximo");
    const outputs = document.querySelectorAll<HTMLOutputElement>(".price-slider-values output");

    expect(minimum).toHaveValue("7.25");
    expect(maximum).toHaveValue("38");
    expect(minimum).toHaveAttribute("aria-valuetext", `Precio mínimo ${outputs[0].textContent}`);
    expect(maximum).toHaveAttribute("aria-valuetext", `Precio máximo ${outputs[1].textContent}`);
  });

  it("offers only database-backed languages as named dropdown options", async () => {
    const onApply = vi.fn();

    render(
      <CatalogFilters
        criteria={readCatalogCriteria("")}
        categories={[]}
        filterOptions={filterOptions}
        filterOptionsLoading={false}
        filterOptionsError=""
        pending={false}
        onApply={onApply}
        onSort={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const language = screen.getByRole("combobox", { name: "Idioma" });
    expect(language).toHaveDisplayValue("Todos los idiomas");
    expect(screen.getByRole("option", { name: "Inglés" })).toHaveValue("en");
    expect(screen.getByRole("option", { name: "Español" })).toHaveValue("es");
    fireEvent.change(language, { target: { value: "en" } });
    expect(language).toHaveValue("en");
    fireEvent.submit(document.querySelector(".filter-form")!);

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ language: "en" })));
  });

  it("keeps the pending submit button focusable without applying twice", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <CatalogFilters
        criteria={readCatalogCriteria("")}
        categories={[]}
        filterOptions={filterOptions}
        filterOptionsLoading={false}
        filterOptionsError=""
        pending
        onApply={onApply}
        onSort={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Aplicar filtros" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    submit.focus();
    await user.click(submit);

    expect(document.activeElement).toBe(submit);
    expect(onApply).not.toHaveBeenCalled();
  });
});
