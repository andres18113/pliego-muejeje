import type { Page } from "@playwright/test";
export const editions = [
  {
    editionId: "42", bookId: "17", title: "Cien años de soledad", authors: "Gabriel García Márquez",
    publisher: "Editorial Sur", isbn13: "9780306406157", price: "18.50", coverUrl: null,
    coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: true,
  },
  {
    editionId: "43", bookId: "18", title: "La casa de los espíritus", authors: "Isabel Allende",
    publisher: "Editorial Sur", isbn13: "9780306406158", price: "22.00", coverUrl: null,
    coverLicense: null, coverAttribution: null, format: "HARDCOVER", language: "es", available: false,
  },
];

export async function mockFavoritesApi(page: Page, initialSaved: string[] = []) {
  const saved = new Set<string>(initialSaved);
  let cartQuantity = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/auth/refresh" && request.method() === "POST") return route.fulfill({ status: 204 });
    if (path === "/auth/login" && request.method() === "POST") return json({
      accessToken: "test-token", tokenType: "Bearer", expiresInSeconds: 1800,
      user: { userId: "100", email: "lectora@example.invalid", role: "CUSTOMER" },
    });
    if (path === "/catalog/categories") return json({ items: [{ slug: "narrativa", name: "Narrativa", parentSlug: null }] });
    if (path === "/catalog/filter-options") return json({ languages: ["es"], minimumPrice: "18.50", maximumPrice: "22.00" });
    if (path === "/catalog/editions") return json({ items: editions, page: 0, pageSize: 20, totalCount: "2" });
    if (path === "/catalog/editions/42") return json({
      ...editions[0], subtitle: null, synopsis: "Una familia en Macondo.",
      authors: [{ authorId: "9", name: editions[0].authors, order: 1 }],
      categories: [], publisher: { publisherId: "5", name: editions[0].publisher }, sku: "PLG-LIT-042",
      pageCount: 496, publicationDate: "1967-05-30", coverSourceUrl: null,
    });
    if (path === "/me/favorites/status") return json(url.searchParams.getAll("editionIds").map((editionId) => ({
      editionId,
      favorite: saved.has(editionId),
    })));
    if (path === "/me/favorites" && request.method() === "GET") {
      const items = editions.filter((edition) => saved.has(edition.editionId)).map((edition) => ({
        ...edition,
        favoritedAt: "2026-09-29T12:00:00Z",
      }));
      return json({ items, page: Number(url.searchParams.get("page") || 0), pageSize: 20, totalCount: String(items.length) });
    }
    if (path.startsWith("/me/favorites/") && request.method() === "PUT") {
      saved.add(path.split("/").at(-1) ?? "");
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/me/favorites/") && request.method() === "DELETE") {
      saved.delete(path.split("/").at(-1) ?? "");
      return route.fulfill({ status: 204 });
    }
    if (path === "/me" && request.method() === "GET") return json({
      customerId: "87", email: "lectora@example.invalid", firstNames: "Ana", lastNames: "Lectora",
      phone: null, state: "ACTIVE", version: "0",
    });
    if (path === "/cart" && request.method() === "GET") return json({
      cartId: "7", state: "ACTIVE", requiresPhysicalFulfillment: cartQuantity > 0, physicalItemCount: cartQuantity > 0 ? 1 : 0, digitalItemCount: 0,
      items: cartQuantity ? [{
        cartItemId: "501", editionId: "42", title: editions[0].title, authors: editions[0].authors,
        sku: "PLG-LIT-042", coverUrl: null, requiresPhysicalFulfillment: true, quantityEditable: true, quantity: cartQuantity, currentPrice: "18.50",
        currentSubtotal: `${(18.5 * cartQuantity).toFixed(2)}`, available: true, unavailabilityReason: null,
      }] : [],
      totalCurrent: (18.5 * cartQuantity).toFixed(2),
    });
    if (path === "/cart/items" && request.method() === "POST") {
      cartQuantity += 1;
      return json({ cartId: "7", cartItemId: "501", quantity: cartQuantity });
    }
    return json({ code: "NOT_FOUND", title: "No encontrado", detail: path }, 404);
  });
  return { saved };
}
