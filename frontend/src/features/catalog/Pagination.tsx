import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { Link } from "react-router-dom";
import { Button } from "@mantine/core";
import classes from "./exploration.module.css";
import { parseTotalCount } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";

interface PaginationProps {
  criteria: CatalogCriteria;
  totalCount: string;
  onRetry: () => void;
}

const numberFormat = new Intl.NumberFormat("es-EC");

/** First, last and the current neighbourhood; gaps collapse to an ellipsis. */
function visiblePages(current: number, total: number): (number | "gap")[] {
  const pages = new Set([0, total - 1, current - 1, current, current + 1].filter((page) => page >= 0 && page < total));
  if (current <= 2) [1, 2, 3].forEach((page) => page < total && pages.add(page));
  if (current >= total - 3) [total - 4, total - 3, total - 2].forEach((page) => page >= 0 && pages.add(page));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((page, index) => index > 0 && page - sorted[index - 1] > 1 ? ["gap" as const, page] : [page]);
}

export function Pagination({ criteria, totalCount, onRetry }: PaginationProps) {
  const total = parseTotalCount(totalCount);
  if (total === null) {
    return (
      <div className="pagination-error" role="alert">
        <p>No pudimos calcular las páginas del catálogo.</p>
        <Button variant="subtle" type="button" onClick={onRetry}>Volver a intentar</Button>
      </div>
    );
  }

  const totalPagesValue = (total + BigInt(criteria.pageSize) - 1n) / BigInt(criteria.pageSize);
  if (totalPagesValue <= 1n) return null;
  // Page numbers are only listed while they stay a small, readable set.
  const totalPages = totalPagesValue > 9999n ? null : Number(totalPagesValue);
  const hasNextPage = BigInt(criteria.page + 1) < totalPagesValue;
  const href = (page: number) => catalogHref({ ...criteria, page });

  return (
    <nav className={classes.pagination} aria-label="Paginación del catálogo">
      <p className="visually-hidden">Página {numberFormat.format(criteria.page + 1)} de {numberFormat.format(totalPagesValue)}</p>
      {criteria.page > 0 ? (
        <Link className={classes.pageStep} to={href(criteria.page - 1)} preventScrollReset>
          <MaterialSymbol name="arrow_back" size={20} />
          <span>Anterior</span>
        </Link>
      ) : (
        <span className={classes.pageStep} aria-hidden="true" data-disabled><MaterialSymbol name="arrow_back" size={20} /><span>Anterior</span></span>
      )}
      {totalPages !== null ? (
        <ol className={classes.pageList}>
          {visiblePages(criteria.page, totalPages).map((page, index) => page === "gap"
            ? <li key={`gap-${index}`} className={classes.pageGap} aria-hidden="true">…</li>
            : <li key={page}>
              <Link className={classes.pageNumber} to={href(page)} preventScrollReset aria-current={page === criteria.page ? "page" : undefined}
                aria-label={`Página ${numberFormat.format(page + 1)} de ${numberFormat.format(totalPages)}`}>
                {numberFormat.format(page + 1)}
              </Link>
            </li>)}
        </ol>
      ) : (
        <p className={classes.pageSummary} aria-hidden="true">{numberFormat.format(criteria.page + 1)} / {numberFormat.format(totalPagesValue)}</p>
      )}
      {hasNextPage ? (
        <Link className={classes.pageStep} to={href(criteria.page + 1)} preventScrollReset>
          <span>Siguiente</span>
          <MaterialSymbol name="arrow_forward" size={20} />
        </Link>
      ) : (
        <span className={classes.pageStep} aria-hidden="true" data-disabled><span>Siguiente</span><MaterialSymbol name="arrow_forward" size={20} /></span>
      )}
    </nav>
  );
}
