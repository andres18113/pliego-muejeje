import { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, type Mock } from "vitest";
import { renderPurchaseRoute, stubApi } from "@/test/purchase";
import { phoneError } from "@/shared/validation/person";
import { InternationalPhoneField } from "./InternationalPhoneField";
function example(initial?: string, props: { error?: string | null; hint?: string | null } = {}) {
 const changed=vi.fn();stubApi({});
 function Example(){const[value,setValue]=useState(initial);return <InternationalPhoneField id="test-phone" label="Teléfono" countryCode="EC" value={value} countries={[{code:"EC",name:"Ecuador"},{code:"CO",name:"Colombia"}]} onCountryChange={vi.fn()} onChange={next=>{changed(next);setValue(next);}} {...props}/>;}
 renderPurchaseRoute([{path:"/phone",element:<Example/>}],"/phone");return{input:screen.getByRole("textbox",{name:"Teléfono"}),changed};
}
/** The form receives a value its own validation refuses for the same reason the field shows: never a stale valid number. */
function expectReportedInvalid(changed: Mock, reason: RegExp | string) {
 const reported = changed.mock.lastCall?.[0];
 expect(reported).toEqual(expect.any(String));
 expect(phoneError(reported)).not.toBeNull();
 expect(screen.getByRole("status")).toHaveTextContent(reason);
}
it("keeps Ecuador fixed and extra typed digits visible and invalid instead of dropping them at a cap",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.type(input,"991234567");expect(input).toHaveValue("991234567");expect(changed).toHaveBeenLastCalledWith("+593991234567");expect(input).not.toHaveAttribute("maxlength");expect(screen.queryByRole("combobox")).not.toBeInTheDocument();expect(screen.getByText("+593")).toBeVisible();expect(document.querySelector('img[src*="EC.svg"]')).toBeInTheDocument();
 await user.type(input,"89");expect(input).toHaveValue("99123456789");expect(input).toHaveAttribute("aria-invalid","true");expectReportedInvalid(changed,"Usa como máximo 9 dígitos.");
});
it("keeps a fast-typed trunk zero and every digit after it, so removing the zero leaves the intended number",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.type(input,"0991234567");expect(input).toHaveValue("0991234567");expectReportedInvalid(changed,"Escríbelo sin el 0 inicial.");
 await user.type(input,"{Home}{Delete}");expect(input).toHaveValue("991234567");expect(changed).toHaveBeenLastCalledWith("+593991234567");
});
it("keeps an oversized paste whole and invalid instead of truncating it into a different phone",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("99123456789");expect(input).toHaveValue("99123456789");expect(input).toHaveAttribute("aria-invalid","true");expectReportedInvalid(changed,"Usa como máximo 9 dígitos.");
});
it("shows typed letters as an invalid draft until they are removed",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.type(input,"99123a");expect(input).toHaveValue("99123a");expect(input).toHaveAttribute("aria-invalid","true");expectReportedInvalid(changed,/solo números/i);
 await user.type(input,"{Backspace}");expect(input).toHaveValue("99123");expect(changed).toHaveBeenLastCalledWith("+59399123");expect(input).not.toHaveAttribute("aria-invalid","true");expect(screen.getByRole("status")).not.toHaveTextContent(/solo números/i);
});
it("replacing a saved number with letters reports the letters, never the previous number",async()=>{
 const{input,changed}=example("+593991281194");const user=userEvent.setup();await user.click(input);await user.keyboard("{Control>}a{/Control}");await user.keyboard("abc");
 expect(input).toHaveValue("abc");expect(input).toHaveAttribute("aria-invalid","true");expect(input).toHaveAccessibleDescription("Usa solo números.");
 expectReportedInvalid(changed,"Usa solo números.");expect(changed).not.toHaveBeenCalledWith("+593991281194");
});
it("replacing a saved number through a single fill (autofill, automation) behaves the same",()=>{
 const{input,changed}=example("+593991281194");fireEvent.change(input,{target:{value:"abc"}});expect(input).toHaveValue("abc");expectReportedInvalid(changed,"Usa solo números.");
});
it("clearing a saved number reports no phone and no error, leaving the form to say whether one is required",async()=>{
 const{input,changed}=example("+593991281194");const user=userEvent.setup();await user.clear(input);expect(input).toHaveValue("");expect(changed).toHaveBeenLastCalledWith(undefined);expect(input).not.toHaveAttribute("aria-invalid","true");expect(input).toHaveAccessibleDescription("Ejemplo: 991234567.");
});
it("accepts an explicit Ecuador paste and a valid eight-digit fixed line",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("+593 (99) 123-4567");expect(input).toHaveValue("991234567");expect(changed).toHaveBeenLastCalledWith("+593991234567");await user.clear(input);await user.type(input,"25550134");expect(input).toHaveValue("25550134");expect(changed).toHaveBeenLastCalledWith("+59325550134");
});
it("absorbs a typed +593 prefix instead of flagging the country while it is being written",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.type(input,"+593");expect(input).toHaveValue("+593");expect(screen.getByRole("status")).toHaveTextContent("el prefijo +593 ya está incluido");expect(screen.getByRole("status")).not.toHaveTextContent(/Solo se aceptan/);
 await user.type(input,"9");expect(input).toHaveValue("9");expect(changed).toHaveBeenLastCalledWith("+5939");
});
it("keeps foreign and trunk-zero pastes visible with a specific reason",async()=>{
 const{input,changed}=example();const user=userEvent.setup();await user.click(input);await user.paste("+44 20 7946 0018");expect(input).toHaveValue("+44 20 7946 0018");expectReportedInvalid(changed,/Ecuador/i);
 await user.clear(input);await user.paste("0991234567");expect(input).toHaveValue("0991234567");expectReportedInvalid(changed,"Escríbelo sin el 0 inicial.");
});
it("shows a stored +593 number with an extension after its prefix, explained and correctable in place",async()=>{
 const{input,changed}=example("+593 99 123 4567 ext 5");expect(input).toHaveValue("99 123 4567 ext 5");expect(input).toHaveAttribute("aria-invalid","true");expect(input).toHaveAccessibleDescription("Usa solo números.");expect(changed).not.toHaveBeenCalled();
 expect(screen.queryByRole("button",{name:"Borrar número guardado"})).not.toBeInTheDocument();
 const user=userEvent.setup();await user.click(input);for(let i=0;i<5;i++)await user.keyboard("{End}{Backspace}");expect(input).toHaveValue("991234567");expect(changed).toHaveBeenLastCalledWith("+593991234567");expect(input).not.toHaveAttribute("aria-invalid","true");
});
it("does not reinterpret a stored foreign phone with the fixed Ecuador prefix",()=>{
 const{input,changed}=example("+442079460018");expect(input).toHaveValue("");expect(changed).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent(/Ecuador/i);
});
it("allows explicitly clearing an incompatible stored phone without changing its country silently",async()=>{
 const{input,changed}=example("+442079460018");await userEvent.setup().click(screen.getByRole("button",{name:"Borrar número guardado"}));expect(input).toHaveValue("");expect(changed).toHaveBeenLastCalledWith(undefined);expect(input).toHaveAccessibleDescription(/991234567/);expect(input).toHaveFocus();expect(input).not.toHaveAttribute("aria-invalid", "true");
});
it("keeps an over-long autofill whole and invalid",()=>{
 const{input,changed}=example("+593991234567");fireEvent.change(input,{target:{value:"991234567123"}});expect(input).toHaveValue("991234567123");expectReportedInvalid(changed,"Usa como máximo 9 dígitos.");
});
it("does not silently clear a selected valid phone when a punctuation-only value is pasted",async()=>{
 const{input,changed}=example("+593991234567");const user=userEvent.setup();await user.click(input);await user.keyboard("{Control>}a{/Control}");await user.paste("()");expect(input).toHaveValue("()");expect(changed).not.toHaveBeenCalledWith(undefined);expectReportedInvalid(changed,/solo números/i);
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

it("prioritizes the draft's own reason over the parent error until the draft is corrected", async () => {
 const { input, changed } = example("+59399", { error: "Completa los 9 dígitos del celular." });
 const user = userEvent.setup();
 await user.type(input, "a");
 expect(input).toHaveValue("99a");
 expect(input).toHaveAccessibleDescription(/solo números/i);
 expect(screen.queryByText("Completa los 9 dígitos del celular.")).not.toBeInTheDocument();
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
 expect(phoneError(changed.mock.lastCall?.[0])).not.toBeNull();
 await user.tab();
 expect(input).toHaveAccessibleDescription(/solo números/i);
 await user.click(input);
 await user.type(input, "{Backspace}1");
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

it.each(["９９１２３４５６７", "٩٩١٢٣٤٥٦٧", "991234567 ext 2"])("keeps non-ASCII digits and extensions visible and invalid: %s", async (pasted) => {
 const { input, changed } = example("+593991234567");
 const user = userEvent.setup();
 await user.click(input);
 await user.keyboard("{Control>}a{/Control}");
 await user.paste(pasted);
 expect(input).toHaveValue(pasted);
 expect(input).toHaveAttribute("aria-invalid", "true");
 expect(input).toHaveAccessibleDescription(/solo números/i);
 expect(changed).not.toHaveBeenCalledWith("+593991234567");
 expectReportedInvalid(changed, /solo números/i);
 expect(document.querySelectorAll(".field-error, .field-help")).toHaveLength(1);
});
