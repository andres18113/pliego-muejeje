import type { PublicCategory } from "@/shared/api/catalog";
export interface CategoryGroup { category: PublicCategory; children: CategoryGroup[] }
export function categoryGroups(categories: PublicCategory[]): CategoryGroup[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const children = new Map<string, PublicCategory[]>();
  const visited = new Set<string>();
  for (const category of bySlug.values()) if (category.parentSlug) children.set(category.parentSlug, [...(children.get(category.parentSlug) ?? []), category]);
  function visit(category: PublicCategory): CategoryGroup {
    visited.add(category.slug);
    return { category, children: (children.get(category.slug) ?? []).filter((child) => !visited.has(child.slug)).map(visit) };
  }
  const roots = [...bySlug.values()].filter((category) => !category.parentSlug || !bySlug.has(category.parentSlug));
  const groups = roots.map(visit);
  for (const category of bySlug.values()) if (!visited.has(category.slug)) groups.push(visit(category));
  return groups;
}
