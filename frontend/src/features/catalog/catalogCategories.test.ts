import { describe, expect, it } from "vitest";
import { categoryGroups } from "@/features/catalog/catalogCategories";

describe("public category navigation", () => {
  it("keeps the full category hierarchy reachable", () => {
    const groups = categoryGroups([
      { slug: "books", name: "Libros", parentSlug: null },
      { slug: "fiction", name: "Ficción", parentSlug: "books" },
      { slug: "novel", name: "Novela", parentSlug: "fiction" },
    ]);
    expect(groups[0].children[0].children[0].category.slug).toBe("novel");
  });
  it("retains orphan categories and recovers cyclic data without hiding destinations", () => {
    const groups = categoryGroups([
      { slug: "orphan", name: "Huérfana", parentSlug: "missing" },
      { slug: "a", name: "A", parentSlug: "b" },
      { slug: "b", name: "B", parentSlug: "a" },
    ]);
    expect(groups.map((group) => group.category.slug)).toEqual(["orphan", "a"]);
    expect(groups[1].children[0].category.slug).toBe("b");
    expect(groups[1].children[0].children).toEqual([]);
  });
});
