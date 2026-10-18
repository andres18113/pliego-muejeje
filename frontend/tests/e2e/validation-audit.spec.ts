import { expect, test } from "@playwright/test";

test("registration rejects invalid edits without changing accepted data and maps server errors to exact controls", async ({page}) => {
  let posts=0;
  await page.route("**/api/v1/auth/refresh",route => route.fulfill({status:204}));
  await page.route("**/api/v1/auth/register",route => {
    posts++;
    expect(route.request().postDataJSON()).toMatchObject({ firstNames: "Ána", lastNames: "O’Connor-Pérez", phone: "+593991234567" });
    return route.fulfill({status:400,contentType:"application/problem+json",body:JSON.stringify({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa los campos indicados.",
      violations:[{field:"password",message:"Usa una contraseña distinta para esta prueba."},{field:"lastNames",message:"Revisa tus apellidos antes de continuar."}]})});
  });
  await page.goto("/register");
  const first=page.getByLabel("Nombres",{exact:true}), last=page.getByLabel("Apellidos",{exact:true});
  await first.fill("Gat"); await first.pressSequentially("1");
  await expect(first).toHaveValue("Gat");
  await expect(first).toHaveAccessibleDescription("Usa solo letras, espacios, apóstrofes y guiones.");
  await expect(first).toBeFocused(); expect(posts).toBe(0);
  await first.fill(""); await last.fill("O’Connor-Pérez");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  const password=page.getByLabel("Contraseña",{exact:true}); await password.fill("lecturaSegura123");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(first).toHaveAccessibleDescription("Escribe tus nombres.");
  await expect(first).toHaveValue(""); await expect(first).toBeFocused(); expect(posts).toBe(0);
  await first.fill("Ána");
  await page.getByRole("button",{name:"Añadir teléfono (opcional)"}).click();
  const phone=page.getByLabel("Teléfono (opcional)", {exact:true});
  await phone.fill("9912");
  await phone.fill("0991234567");
  await expect(phone).toHaveValue("9912");
  await expect(phone).toHaveAccessibleDescription("Escríbelo sin el 0 inicial.");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(phone).toHaveAccessibleDescription("Escríbelo sin el 0 inicial.");
  await expect(page.locator("#register-phone-input-status.field-error")).toHaveCount(1);
  await expect(phone).toHaveValue("9912"); expect(posts).toBe(0);
  await phone.fill("991234567");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(last).toHaveAccessibleDescription("Revisa tus apellidos antes de continuar.");
  await expect(password).toHaveAccessibleDescription("Usa una contraseña distinta para esta prueba.");
  await expect(password).toHaveValue("lecturaSegura123");
  await expect(last).toHaveValue("O’Connor-Pérez"); await expect(last).toBeFocused(); expect(posts).toBe(1);
});

test("profile rejects a pasted extension and address recipient errors reveal a recovery control", async ({page}) => {
  const first="A".repeat(120), last="B".repeat(120);
  let patches=0, addresses=0;
  await page.route("**/api/v1/**", route => {
    const request=route.request(),path=new URL(request.url()).pathname;
    const json=(body:unknown,status=200)=>route.fulfill({status,contentType:status>=400?"application/problem+json":"application/json",body:JSON.stringify(body)});
    if(path==="/api/v1/auth/refresh") return json({accessToken:"test",expiresInSeconds:1800,user:{userId:"2",email:"ana@example.com",role:"CUSTOMER"}});
    if(path==="/api/v1/me" && request.method()==="GET") return json({customerId:"2",email:"ana@example.com",firstNames:first,lastNames:last,phone:null,state:"ACTIVE",version:"0"});
    if(path==="/api/v1/reference/countries") return json([{code:"EC",name:"Ecuador"}]);
    if(path==="/api/v1/cart") return json({cartId:null,state:null,items:[],totalCurrent:"0.00"});
    if(path==="/api/v1/me" && request.method()==="PATCH") {patches++;return route.fulfill({status:204});}
    if(path==="/api/v1/me/addresses" && request.method()==="GET") return json([]);
    if(path==="/api/v1/me/addresses" && request.method()==="POST") {
      addresses++;
      expect(request.postDataJSON()).toMatchObject({ countryCode: "EC", phone: "+593991234567" });
      if(addresses===1) return json({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa el destinatario.",violations:[{field:"recipient",message:"Revisa quién recibirá el pedido."}]},400);
      return json({addressId:"15"},201);
    }
    return route.fulfill({status:404});
  });
  await page.goto("/account");
  await page.getByRole("button",{name:"Agregar teléfono"}).click();
  const phone=page.getByLabel("Teléfono",{exact:true});
  await phone.fill("991234567");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("+593 99 123 4567 ext 5"));
  await phone.press("ControlOrMeta+A"); await phone.press("ControlOrMeta+V");
  await expect(phone).toHaveValue("991234567");
  await expect(phone).toHaveAccessibleDescription("Usa solo números.");
  await expect(page.locator("#profile-phone-input-input-status.field-error")).toHaveCount(1);
  expect(patches).toBe(0);
  await page.goto("/account/addresses");
  await page.getByRole("button",{name:"Agregar dirección"}).click();
  await page.getByLabel("Dirección",{exact:true}).fill("Calle 1"); await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha"); await page.getByLabel("Teléfono de contacto").fill("991234567");
  await page.getByRole("button",{name:"Guardar dirección"}).click();
  const recipient=page.getByLabel("Quién recibe el pedido");
  await expect(recipient).toHaveValue(`${first} ${last}`); await expect(recipient).toBeFocused();
  await expect(recipient).toHaveAccessibleDescription("Revisa quién recibirá el pedido.");
  await expect(page.getByLabel("Dirección",{exact:true})).toHaveValue("Calle 1");
  await recipient.fill("Ana Pérez"); await page.getByRole("button",{name:"Guardar dirección"}).click();
  await expect.poll(()=>addresses).toBe(2);
});


test("an incompatible saved phone is preserved until explicitly replaced", async ({ page }) => {
  const legacyPhone = "+593 99 123 4567 ext 5";
  let profile = { customerId: "2", email: "ana@example.invalid", firstNames: "Ana", lastNames: "Pérez", phone: legacyPhone,
    state: "ACTIVE", version: "0", emailVerified: true };
  const patches: unknown[] = [];
  await page.route("**/api/v1/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") return route.fulfill({ json: { accessToken: "test", expiresInSeconds: 1800,
      user: { userId: "2", email: profile.email, role: "CUSTOMER" } } });
    if (path === "/api/v1/me" && request.method() === "PATCH") {
      const body = request.postDataJSON(); patches.push(body);
      profile = { ...profile, phone: body.value, version: "1" };
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/me") return route.fulfill({ json: profile });
    if (path === "/api/v1/me/billing-identity") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/account");
  await expect(page.getByText(/\+593.*ext.*5/)).toBeVisible();
  await page.getByRole("button", { name: "Editar teléfono", exact: true }).click();
  const phone = page.getByLabel("Teléfono", { exact: true });
  await expect(phone).toHaveValue("");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toHaveAccessibleDescription("Usa solo números.");
  await expect(page.getByRole("button", { name: "Borrar número guardado" })).toBeVisible();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(phone).toBeFocused();
  expect(patches).toHaveLength(0);
  expect(profile.phone).toBe(legacyPhone);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByText(/\+593.*ext.*5/)).toBeVisible();
  await page.getByRole("button", { name: "Editar teléfono", exact: true }).click();
  await page.getByRole("button", { name: "Borrar número guardado" }).click();
  await expect(phone).toBeFocused();
  await phone.fill("998765432");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardamos tu teléfono." })).toBeVisible();
  expect(patches).toEqual([{ field: "phone", value: "+593998765432", expectedVersion: "0" }]);
});
