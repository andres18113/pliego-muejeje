import { expect, type Locator, type Page } from "@playwright/test";

/** A small slice of the INEC catalog (ADR 0044), with the real ids of the seeded rows. */
export const geoProvinces = [{ id: "1", code: "01", name: "Azuay" }, { id: "9", code: "09", name: "Guayas" }, { id: "17", code: "17", name: "Pichincha" }];
export const geoCities: Record<string, { id: string; code: string; name: string; kind: "CABECERA_CANTONAL" | "PARROQUIA_RURAL"; cantonName: string }[]> = {
  "1": [{ id: "1", code: "0101", name: "Cuenca", kind: "CABECERA_CANTONAL", cantonName: "Cuenca" }],
  "9": [{ id: "432", code: "0901", name: "Guayaquil", kind: "CABECERA_CANTONAL", cantonName: "Guayaquil" }],
  "17": [
    { id: "899", code: "170156", name: "Conocoto", kind: "PARROQUIA_RURAL", cantonName: "Distrito Metropolitano de Quito" },
    { id: "903", code: "170160", name: "El Quinche", kind: "PARROQUIA_RURAL", cantonName: "Distrito Metropolitano de Quito" },
    { id: "893", code: "1701", name: "Quito", kind: "CABECERA_CANTONAL", cantonName: "Distrito Metropolitano de Quito" },
    { id: "952", code: "1705", name: "Sangolquí", kind: "CABECERA_CANTONAL", cantonName: "Rumiñahui" },
  ],
};
/** Catalog ids for a saved address in Quito, Pichincha. */
export const quitoIds = { provinceId: "17", cityId: "893", cityNeedsReview: false };

/** Serves the catalog slice. Register it after a spec's catch-all route so it takes precedence. */
export async function routeGeo(page: Page) {
  await page.route("**/api/v1/geo/provinces**", route => {
    const parts = new URL(route.request().url()).pathname.split("/");
    return route.fulfill({ json: parts.at(-1) === "cities" ? geoCities[parts.at(-2)!] ?? [] : geoProvinces });
  });
}

/** Chooses a province, then one of its places, from the pickers inside `scope`. */
export async function choosePlace(page: Page, scope: Locator, province = "Pichincha", city = "Quito") {
  await scope.getByRole("combobox", { name: "Provincia", exact: true }).click();
  await page.getByRole("option", { name: province, exact: true }).click();
  const cityTrigger = scope.getByRole("combobox", { name: "Ciudad", exact: true });
  await expect(cityTrigger).toBeEnabled();
  await cityTrigger.click();
  await page.getByRole("option", { name: new RegExp(`^${city}`) }).click();
  await expect(cityTrigger).toContainText(city);
}

/** What the server does with catalog ids: the address keeps the names, resolved from the catalog. */
export function withPlaceNames<T extends { provinceId?: string; cityId?: string }>(body: T) {
  const province = geoProvinces.find(item => item.id === body.provinceId);
  const city = body.provinceId ? geoCities[body.provinceId]?.find(item => item.id === body.cityId) : undefined;
  return { ...body, ...(province ? { province: province.name } : {}), ...(city ? { city: city.name, cityNeedsReview: false } : {}) };
}

/** Serves the catalog slice from inside a spec's own route handler; undefined when the path is not the catalog. */
export function geoResponse(path: string) {
  if (path === "/geo/provinces") return geoProvinces;
  const cities = /^\/geo\/provinces\/(\d+)\/cities$/.exec(path);
  return cities ? geoCities[cities[1]] ?? [] : undefined;
}
