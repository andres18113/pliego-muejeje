import { ChevronDown } from "lucide-react";
import type { SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { PublicCategory } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";

interface CategoryNavigationProps {
  categories: PublicCategory[];
  selectedSlug: string;
  criteria: CatalogCriteria;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

export function CategoryNavigation({
  categories,
  selectedSlug,
  criteria,
  loading,
  error,
  onRetry,
}: CategoryNavigationProps) {
  const roots = categories.filter((category) => category.parentSlug === null);
  const childrenByParent = new Map<string, PublicCategory[]>();

  for (const category of categories) {
    if (category.parentSlug) {
      const children = childrenByParent.get(category.parentSlug) || [];
      children.push(category);
      childrenByParent.set(category.parentSlug, children);
    }
  }

  return (
    <section className="category-section page-frame" aria-labelledby="category-heading">
      <div className="section-heading category-heading-row">
        <h2 id="category-heading">Explora por categoría</h2>
        {selectedSlug && (
          <Link
            className="text-link category-clear"
            to={catalogHref({ ...criteria, category: "", page: 0 })}
          >
            Ver todo el catálogo
          </Link>
        )}
      </div>

      {loading && categories.length === 0 ? (
        <p className="category-message" role="status" aria-live="polite">Cargando categorías…</p>
      ) : error ? (
        <div className="category-error" role="alert">
          <p>{error}</p>
          <Button variant="text" type="button" onClick={onRetry}>
            Volver a intentar
          </Button>
        </div>
      ) : roots.length === 0 ? (
        <p className="category-message">Todavía no hay categorías con ediciones publicadas.</p>
      ) : (
        <nav aria-label="Categorías del catálogo">
          <ul className="category-roots">
            {roots.map((root) => {
              const children = childrenByParent.get(root.slug) || [];
              const rootIsSelected = selectedSlug === root.slug;
              const childIsSelected = children.some((child) => child.slug === selectedSlug);
              const nextRoot = { ...criteria, category: root.slug, page: 0 };

              return (
                <li className={`category-root${rootIsSelected || childIsSelected ? " category-root-selected" : ""}`} key={root.slug}>
                  <Link
                    className="category-root-link"
                    to={catalogHref(nextRoot)}
                    aria-current={rootIsSelected ? "true" : undefined}
                  >
                    {root.name}
                  </Link>
                  {children.length > 0 && (
                    <details
                      className="subcategory-disclosure"
                      open={childIsSelected}
                      onToggle={positionSubcategoryMenu}
                    >
                      <summary aria-label={`Ver subcategorías de ${root.name}`}>
                        <ChevronDown aria-hidden="true" size={16} />
                      </summary>
                      <ul className="subcategory-list">
                        {children.map((child) => {
                          const nextChild = { ...criteria, category: child.slug, page: 0 };
                          return (
                            <li key={child.slug}>
                              <Link
                                to={catalogHref(nextChild)}
                                aria-current={selectedSlug === child.slug ? "true" : undefined}
                              >
                                {child.name}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                  {rootIsSelected && <span className="visually-hidden">Categoría seleccionada</span>}
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </section>
  );
}

function positionSubcategoryMenu(event: SyntheticEvent<HTMLDetailsElement>) {
  const disclosure = event.currentTarget;
  if (!disclosure.open) return;

  requestAnimationFrame(() => {
    const menu = disclosure.querySelector<HTMLElement>(".subcategory-list");
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const minLeft = 8;
    const maxLeft = Math.max(minLeft, window.innerWidth - 8 - bounds.width);
    const clampedLeft = Math.min(Math.max(bounds.left, minLeft), maxLeft);
    const offset = clampedLeft - bounds.left;
    disclosure.dataset.menuAlign = offset < 0 ? "right" : "left";
    menu.style.transform = offset ? `translateX(${offset}px)` : "";
  });
}
