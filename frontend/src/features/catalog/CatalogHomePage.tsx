import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { HomeActionButton } from "./HomeActions";
import { HomeEditorial, HomeCategories, HomeLiterature } from "./HomeEditorial";
import classes from "./homePage.module.css";
import { getPublicCategories } from "@/shared/api/catalog";
import { HomeFooter } from "./HomeFooter";
import { HomeNextReading } from "./HomeNextReading";
import { categoryGroups } from "./catalogCategories";
import { useCategoryPreviews } from "./useCategoryPreviews";
import { useCatalogReturnScrollRestoration } from "./catalogScrollRestoration";

export function CatalogHomePage() {
  const categoriesQuery = useQuery({
    queryKey: ["public-catalog", "categories"],
    queryFn: ({ signal }) => getPublicCategories(signal),
    staleTime: 60_000,
  });

  useEffect(() => {
    document.title = "Descubre el catálogo · PLIEGO";
  }, []);

  const categories = categoriesQuery.data?.items ?? [];
  const previews = useCategoryPreviews(categoryGroups(categories).map(({ category }) => category));
  useCatalogReturnScrollRestoration(!categoriesQuery.isFetching && !previews.some((preview) => preview.isFetching));

  return (
    <div className={classes.surface} data-storefront-surface>

      <main id="contenido-principal" tabIndex={-1} className={classes.home}>
        <HomeEditorial />
        <div className={classes.shell}>
        <HomeNextReading categories={categories} categoriesPending={categoriesQuery.isPending} categoriesError={categoriesQuery.isError} onRetryCategories={() => void categoriesQuery.refetch()} />
        <HomeLiterature categories={categories} />
        <HomeCategories categories={categories} />
        {categoriesQuery.isError && <p className={classes.note} role="alert">No pudimos cargar las categorías. <HomeActionButton onClick={() => void categoriesQuery.refetch()}>Reintentar</HomeActionButton></p>}
        </div>
      </main>

      <HomeFooter categories={categories} />
    </div>
  );
}
