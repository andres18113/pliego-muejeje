import { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderPurchaseRoute, stubApi } from "@/test/purchase";
import { phoneError } from "@/shared/validation/person";
import { InternationalPhoneField } from "./InternationalPhoneField";
function example(initial?: string, props: { error?: string | null; hint?: string | null } = {}) {
 const changed=vi.fn();stubApi({});
 function Example(){const[value,setValue]=useState(initial);return <InternationalPhoneField id="test-phone" label="Teléfono" countryCode="EC" value={value} countries={[{code:"EC",name:"Ecuador"},{code:"CO",name:"Colombia"}]} onCountryChange={vi.fn()} onChange={next=>{changed(next);setValue(next);}} {...props}/>;}
 renderPurchaseRoute([{path:"/phone",element:<Example/>}],"/phone");return{input:screen.getByRole("textbox",{name:"Teléfono"}),changed};
}
it("caps national digits while typing and keeps Ecuador fixed",async()=>{
 const{input,changed}=example();await userEvent.setup().type(input,"99123456789");expect(input).toHaveValue("991234567");expect(input).toHaveAttribute("maxlength","9");expect(changed).toHaveBeenLastCalledWith("+593991234567");expect(screen.queryByRole("combobox")).not.toBeInTheDocument();expect(screen.getByText("+593")).toBeVisible();expect(document.querySelector('img[src*="EC.svg"]')).toBeInTheDocument();
});
it("rejects an oversized paste instead of truncating a different phone",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("99123456789");expect(input).toHaveValue("");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent("Usa como máximo 9 dígitos.");
});
it("rejects letters immediately without changing accepted digits",async()=>{
 const{input,changed}=example();await userEvent.setup().type(input,"99123a");expect(input).toHaveValue("99123");expect(changed).toHaveBeenLastCalledWith("+59399123");expect(screen.getByRole("status")).toHaveTextContent(/solo números/i);
});
it("accepts an explicit Ecuador paste and a valid eight-digit fixed line",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("+593 (99) 123-4567");expect(input).toHaveValue("991234567");expect(changed).toHaveBeenLastCalledWith("+593991234567");await user.clear(input);await user.type(input,"25550134");expect(input).toHaveValue("25550134");expect(changed).toHaveBeenLastCalledWith("+59325550134");
});
it("rejects foreign and trunk-zero pastes with a specific reason",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("+44 20 7946 0018");expect(input).toHaveValue("");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent(/Ecuador/i);await user.paste("0991234567");expect(input).toHaveValue("");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent("Escríbelo sin el 0 inicial.");
});
it("does not reinterpret a stored foreign phone with the fixed Ecuador prefix",()=>{
 const{input,changed}=example("+442079460018");expect(input).toHaveValue("");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent(/Ecuador/i);
});
it("allows explicitly clearing an incompatible stored phone without changing its country silently",async()=>{
 const{input,changed}=example("+442079460018");await userEvent.setup().click(screen.getByRole("button",{name:"Borrar número guardado"}));expect(input).toHaveValue("");expect(changed).toHaveBeenLastCalledWith(undefined);expect(input).toHaveAccessibleDescription(/991234567/);expect(input).toHaveFocus();expect(input).not.toHaveAttribute("aria-invalid", "true");
});
it("defends the cap when autofill dispatches an input change",()=>{
 const{input,changed}=example("+593991234567");fireEvent.change(input,{target:{value:"991234567123"}});expect(input).toHaveValue("991234567");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent("Usa como máximo 9 dígitos.");
});
it("does not silently clear a selected valid phone when a punctuation-only value is pasted",async()=>{
 const{input,changed}=example("+593991234567");const user=userEvent.setup();await user.click(input);await user.keyboard("{Control>}a{/Control}");await user.paste("()");expect(input).toHaveValue("991234567");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent(/solo números/i);
});

it("shows only the parent error and associates it with the input", () => {
 const { input } = example("+59399", { error: phoneError("+59399"), hint: "Ejemplo: 991234567." });
 expect(input).toHaveAttribute("aria-invalid", "true");
 expect(input).toHaveAccessibleDescription("Completa los 9 dígitos del celular.");
 expect(screen.queryByText(/Ejemplo:/)).not.toBeInTheDocument();
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
});

it("preserves an unknown server error verbatim in the single accessible slot", () => {
 const message = "No pudimos verificar tu teléfono. Inténtalo de nuevo.";
 const { input } = example("+593991234567", { error: message });
 expect(input).toHaveAttribute("aria-invalid", "true");
 expect(input).toHaveAccessibleDescription(message);
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
});

it("prioritizes rejected input over the parent error until an accepted edit", async () => {
 const { input, changed } = example("+59399", { error: "Completa los 9 dígitos del celular." });
 const user = userEvent.setup();
 await user.type(input, "a");
 expect(input).toHaveValue("99");
 expect(changed).not.toHaveBeenCalled();
 expect(input).toHaveAccessibleDescription(/solo números/i);
 expect(screen.queryByText("Completa los 9 dígitos del celular.")).not.toBeInTheDocument();
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
 await user.tab();
 expect(input).toHaveAccessibleDescription(/solo números/i);
 await user.type(input, "1");
 expect(input).toHaveValue("991");
 expect(input).toHaveAccessibleDescription("Completa los 9 dígitos del celular.");
});

it.each([undefined, null, "Ejemplo de fijo: 25550134."])("supports a contextual hint (%s) without additional helper text", (hint) => {
 const { input } = example(undefined, { hint });
 expect(input).not.toHaveAttribute("aria-invalid", "true");
 expect(input).toHaveAccessibleDescription(hint === undefined ? "Ejemplo: 991234567." : hint ?? "");
 expect(document.querySelectorAll(".field-help")).toHaveLength(hint === null ? 0 : 1);
 expect(document.querySelectorAll(".field-error")).toHaveLength(0);
});

it.each(["９９１２３４５６７", "٩٩١٢٣٤٥٦٧", "991234567 ext 2"])("rejects non-ASCII digits and extensions without changing the number: %s", async (pasted) => {
 const { input, changed } = example("+593991234567");
 const user = userEvent.setup();
 await user.click(input);
 await user.keyboard("{Control>}a{/Control}");
 await user.paste(pasted);
 expect(input).toHaveValue("991234567");
 expect(changed).not.toHaveBeenCalled();
 expect(input).toHaveAttribute("aria-invalid", "true");
 expect(input).toHaveAccessibleDescription(/solo números/i);
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
});
