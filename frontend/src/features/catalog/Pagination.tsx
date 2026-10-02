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

  const totalPages = (total + BigInt(criteria.pageSize) - 1n) / BigInt(criteria.pageSize);
  if (totalPages <= 1n) return null;

  const previous = { ...criteria, page: Math.max(0, criteria.page - 1) };
  const next = { ...criteria, page: criteria.page + 1 };
  const previousHref = catalogHref(previous);
  const nextHref = catalogHref(next);
  const hasNextPage = BigInt(criteria.page + 1) < totalPages;

  return (
    <nav className={classes.pagination} aria-label="Paginación del catálogo">
      {criteria.page > 0 ? (
        <Button component={Link} variant="subtle" className={classes.control} to={previousHref} preventScrollReset>
          <MaterialSymbol name="arrow_back" aria-hidden="true" size={18} />
          Anterior
        </Button>
      ) : (
        <span className="pagination-placeholder" aria-hidden="true" />
      )}
      <p>Página {numberFormat.format(criteria.page + 1)} de {numberFormat.format(totalPages)}</p>
      {hasNextPage ? (
        <Button component={Link} variant="subtle" className={classes.control} to={nextHref} preventScrollReset>
          Siguiente
          <MaterialSymbol name="arrow_forward" aria-hidden="true" size={18} />
        </Button>
      ) : (
        <span className="pagination-placeholder" aria-hidden="true" />
      )}
    </nav>
  );
}
