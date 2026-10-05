import { expect, test } from "@playwright/test";

test("registration preserves invalid names/phone and maps server errors to their exact controls", async ({page}) => {
  let posts=0;
  await page.route("**/api/v1/auth/refresh",route => route.fulfill({status:204}));
  await page.route("**/api/v1/auth/register",route => {
    posts++;
    return route.fulfill({status:400,contentType:"application/problem+json",body:JSON.stringify({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa los campos indicados.",
      violations:[{field:"password",message:"Usa una contraseña distinta para esta prueba."},{field:"lastNames",message:"Revisa tus apellidos antes de continuar."}]})});
  });
  await page.goto("/register");
  const first=page.getByLabel("Nombres",{exact:true}), last=page.getByLabel("Apellidos",{exact:true});
  await first.fill("Gat1n"); await last.fill("O’Connor-Pérez");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  const password=page.getByLabel("Contraseña",{exact:true}); await password.fill("lecturaSegura123");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(first).toHaveAccessibleDescription("Tus nombres solo pueden contener letras, espacios, apóstrofes y guiones.");
  await expect(first).toHaveValue("Gat1n"); await expect(first).toBeFocused(); expect(posts).toBe(0);
  await first.fill("Ána");
  await page.getByRole("button",{name:"Añadir teléfono (opcional)"}).click();
  const phone=page.getByLabel(/Teléfono/); await phone.fill("0991234567");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(phone).toHaveAccessibleDescription("Incluye el prefijo internacional, por ejemplo +593 99 123 4567.");
  await expect(phone).toHaveValue("0991234567"); expect(posts).toBe(0);
  await phone.fill("+593 (99) 123-4567");
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(last).toHaveAccessibleDescription("Revisa tus apellidos antes de continuar.");
  await expect(password).toHaveAccessibleDescription("Usa una contraseña distinta para esta prueba.");
  await expect(password).toHaveValue("lecturaSegura123");
  await expect(last).toHaveValue("O’Connor-Pérez"); await expect(last).toBeFocused(); expect(posts).toBe(1);
});

test("profile preserves a pasted extension and address recipient errors reveal a recovery control", async ({page}) => {
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
      if(addresses===1) return json({code:"VALIDATION_ERROR",title:"Datos inválidos",detail:"Revisa el destinatario.",violations:[{field:"recipient",message:"Revisa quién recibirá el pedido."}]},400);
      return json({addressId:"15"},201);
    }
    return route.fulfill({status:404});
  });
  await page.goto("/account");
  await page.getByRole("button",{name:"Agregar teléfono"}).click();
  const phone=page.getByLabel("Teléfono",{exact:true});
  await phone.fill("+593 99 123 4567 ext 5");
  await page.getByRole("button",{name:"Guardar",exact:true}).click();
  await expect(phone).toHaveValue("+593 99 123 4567 ext 5");
  await expect(phone).toHaveAccessibleDescription("Usa solo dígitos, espacios, paréntesis, puntos o guiones; no incluyas letras ni extensiones.");
  expect(patches).toBe(0);
  await page.goto("/account/addresses");
  await page.getByRole("button",{name:"Agregar dirección"}).click();
  await page.getByLabel("Dirección",{exact:true}).fill("Calle 1"); await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Provincia").fill("Pichincha"); await page.getByLabel("Teléfono de contacto").fill("0991234567");
  await page.getByRole("button",{name:"Guardar dirección"}).click();
  const recipient=page.getByLabel("Quién recibe el pedido");
  await expect(recipient).toHaveValue(`${first} ${last}`); await expect(recipient).toBeFocused();
  await expect(recipient).toHaveAccessibleDescription("Revisa quién recibirá el pedido.");
  await expect(page.getByLabel("Dirección",{exact:true})).toHaveValue("Calle 1");
  await recipient.fill("Ana Pérez"); await page.getByRole("button",{name:"Guardar dirección"}).click();
  await expect.poll(()=>addresses).toBe(2);
});
