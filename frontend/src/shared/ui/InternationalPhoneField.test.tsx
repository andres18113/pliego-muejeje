import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderPurchaseRoute, stubApi } from "@/test/purchase";
import { InternationalPhoneField } from "./InternationalPhoneField";

it("does not treat a country-picker search as phone input", async () => {
  const changed=vi.fn(); stubApi({});
  function Example() {
    const [country,setCountry]=useState("EC");
    const [value,setValue]=useState<string | undefined>("+593991234567");
    return <InternationalPhoneField id="test-phone" label="Teléfono" countryCode={country} value={value}
      countries={[{code:"EC",name:"Ecuador"},{code:"CO",name:"Colombia"}]}
      onCountryChange={setCountry} onChange={(next) => {changed(next);setValue(next);}} />;
  }
  renderPurchaseRoute([{path:"/phone",element:<Example />}],"/phone");
  const user=userEvent.setup();
  await user.click(screen.getByRole("combobox",{name:"Prefijo internacional"}));
  const search=await screen.findByRole("combobox",{name:"Buscar prefijo internacional"});
  await user.type(search,"Colom");
  expect(search).toHaveValue("Colom");
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("option",{name:/Colombia/})).toBeInTheDocument();
});
