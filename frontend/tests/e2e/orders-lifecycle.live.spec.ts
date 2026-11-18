import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const env = process.env;
const fixtureJson = env.PLIEGO_ORDERS_LIVE_FIXTURE_JSON;
test.skip(!fixtureJson,"Set PLIEGO_ORDERS_LIVE_FIXTURE_JSON for a verified disposable PostgreSQL fixture.");
test.describe.configure({ mode: "serial" });
const apiOrigin = env.PLIEGO_API_BASE_URL ?? "http://127.0.0.1:8080";

interface Fixture {
  database: string;
  email: string;
  password: string;
  adminId: string;
  homeOrderId: string;
  cancelOrderId: string;
  pickupOrderId: string;
  pickupCancelOrderId: string;
  pickupCode: string;
}

function fixture(): Fixture {
  const result = JSON.parse(fixtureJson!) as Fixture;
  if (!result.database.startsWith("home_delivery_frontend_") || env.PGDATABASE !== result.database) {
    throw new Error("The live lifecycle gate requires its dedicated disposable database.");
  }
  return result;
}

function sql(statement: string) {
  execFileSync("psql",["-X","-v","ON_ERROR_STOP=1","-c",statement],{ env,stdio: "pipe" });
}

function sqlValue(statement: string) {
  return execFileSync("psql",["-X","-v","ON_ERROR_STOP=1","-At","-c",statement],{ env,stdio: "pipe" }).toString().trim();
}

/** The customer sees the public reference (ADR 0047), never the internal id; the row is found by its order link. */
function orderRow(page: import("@playwright/test").Page, orderId: string) {
  const reference = sqlValue(`SELECT referencia_publica FROM pliego.pedido WHERE pedido_id=${orderId}`);
  expect(reference).toMatch(/^PL-\d{4}-\d{4}$/);
  return { row: page.locator(`a[href="/orders/${orderId}"]`), reference };
}

test("Mis pedidos reads real home transitions, cutoff, pickup collection and cancellation",async ({ page }) => {
  const data = fixture();
  for (const value of [data.adminId,data.homeOrderId,data.cancelOrderId,data.pickupOrderId,data.pickupCancelOrderId]) {
    expect(value).toMatch(/^[1-9]\d*$/);
  }
  expect(data.pickupCode).toMatch(/^P-[2-9A-HJ-NP-Z]{6,8}$/);
  await page.route("**/api/v1/**",route => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${apiOrigin}${url.pathname}${url.search}` });
  });
  await page.route("https://www.openstreetmap.org/**",route => route.fulfill({ contentType: "text/html",body: "<html><body>Mapa</body></html>" }));
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") }));
  await page.goto("/sign-in?from=%2Forders");
  await page.getByLabel("Correo electrónico").fill(data.email);
  await page.getByLabel("Contraseña",{ exact: true }).fill(data.password);
  await page.getByRole("button",{ name: "Iniciar sesión",exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);

  for (const [minutes,label,cancel] of [[0,"En preparación",true],[3,"En camino",false],[2,"En reparto",false],[2,"Entregado",false]] as const) {
    if (minutes) sql(`UPDATE pliego.envio SET fecha_confirmacion=fecha_confirmacion-INTERVAL '${minutes} minutes',transito_desde=transito_desde-INTERVAL '${minutes} minutes',reparto_desde=reparto_desde-INTERVAL '${minutes} minutes',entrega_desde=entrega_desde-INTERVAL '${minutes} minutes' WHERE pedido_id=${data.homeOrderId}`);
    await page.goto("/orders"); // List snapshot can be behind; enrichment must invoke reconciliation.
    const { row, reference } = orderRow(page, data.homeOrderId);
    await expect(row).toBeVisible();
    await expect(row).toContainText(label);
    await expect(row).toContainText(`Pedido #${reference}`);
    await row.click();
    await expect(page.getByRole("heading",{ level: 2,name: label })).toBeVisible();
    if (label === "Entregado") {
      // Delivered reads as one completed state, not the five-step list (ShipmentTrack).
      await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
      await expect(page.getByRole("group",{ name: "Progreso del envío" })).toContainText("Entregado");
    } else {
      await expect(page.getByRole("list",{ name: "Progreso del envío" }).locator('[aria-current="step"]')).toContainText(label);
    }
    await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(cancel ? 1 : 0);
  }

  await page.goto(`/orders/${data.cancelOrderId}`);
  await expect(page.getByRole("heading",{ level: 2,name: "En preparación" })).toBeVisible();
  await page.getByRole("button",{ name: "Cancelar pedido" }).click();
  await page.getByRole("button",{ name: "Confirmar cancelación" }).click();
  await expect(page.getByRole("heading",{ level: 2,name: "Pedido cancelado" })).toBeVisible();
  await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);

  await page.goto("/orders");
  const { row: pickupRow, reference: pickupReference } = orderRow(page, data.pickupOrderId);
  await expect(pickupRow).toBeVisible();
  await expect(pickupRow).toContainText(`Pedido #${pickupReference}`);
  // ADR 0051: only a READY pickup can be handed over; the fixture must provide one (within its point's hours).
  expect(sqlValue(`SELECT pliego.fn_pickup_state(${data.pickupOrderId})`)).toBe("READY");
  await expect(pickupRow).toContainText("Listo para retirar");
  // V089: the counter confirms the customer's identity before handing over.
  sql(`CALL pliego.sp_pickup_collect(${data.adminId},${data.pickupOrderId},'${data.pickupCode}',TRUE)`);
  await pickupRow.click();
  await expect(page.getByRole("heading",{ level: 2,name: "Retirado" })).toBeVisible();
  await expect(page.getByRole("list",{ name: "Progreso del envío" })).toHaveCount(0);
  await expect(page.getByRole("button",{ name: "Cancelar pedido" })).toHaveCount(0);

  await page.goto(`/orders/${data.pickupCancelOrderId}`);
  await expect(page.getByRole("heading",{ level: 2,name: /^(?:En preparación|Listo para retirar)$/ })).toBeVisible();
  await page.getByRole("button",{ name: "Cancelar pedido" }).click();
  await page.getByRole("button",{ name: "Confirmar cancelación" }).click();
  await expect(page.getByRole("heading",{ level: 2,name: "Pedido cancelado" })).toBeVisible();
});
