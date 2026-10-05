import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { stockReadOptions } from "@/features/catalog/stockStatusModel";
import { FavoriteRow } from "@/features/favorites/FavoriteRow";
import { ApiRequestError } from "@/shared/api/errors";
import { favoriteListQueryKey, favoriteStatusQueryKey, listCustomerFavorites } from "@/shared/api/favorites";
import classes from "./cart.module.css";

/** The cart previews the most recent saved editions; the whole collection lives in Favoritos. */
const SHOWN = 4;

/**
 * "Guardado para después" is the customer's Favoritos, not a second list: the same API, the same rows
 * (`FavoriteRow`: today's price and stock, add to cart, remove) and a way through to the full collection.
 */
export function SavedForLater() {
  const { session, clear } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.userId ?? "";
  const query = useQuery({
    queryKey: favoriteListQueryKey(userId, 0, SHOWN),
    ...stockReadOptions,
    queryFn: ({ signal }) => listCustomerFavorites(0, SHOWN, signal),
    meta: { authRequired: true },
    retry: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);

  const saved = query.data;
  const total = saved ? Number(saved.totalCountValue) : 0;

  return (
    <section className={classes.saved} aria-labelledby="cart-saved-heading" data-cart-saved>
      <header className={classes.savedHead}>
        <h2 id="cart-saved-heading">Guardado para después</h2>
        <p>Lo que guardas para después queda en tus <Link to="/favorites">Favoritos</Link>.</p>
      </header>
      {query.isPending ? (
        <p className={classes.savedQuiet} role="status">Consultando tus libros guardados…</p>
      ) : !saved ? (
        <p className={classes.savedQuiet}>
          No pudimos consultar tus libros guardados.{" "}
          <Button variant="text" type="button" onClick={() => void query.refetch()}>Volver a intentar</Button>
        </p>
      ) : saved.items.length === 0 ? (
        <div className={classes.savedEmpty}>
          <strong>No hay libros guardados</strong>
          <p>Guarda aquí los libros que no comprarás hoy.</p>
        </div>
      ) : (
        <>
          <ul className={classes.savedList}>
            {saved.items.map((edition) => (
              <li key={edition.editionId}>
                <FavoriteRow
                  edition={edition}
                  detailHref={`/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent("/cart")}`}
                  returnHref="/cart"
                  queryKey={favoriteStatusQueryKey(userId, [edition.editionId])}
                  onRemoved={() => void queryClient.invalidateQueries({ queryKey: ["customer-favorites", userId] })}
                />
              </li>
            ))}
          </ul>
          {total > saved.items.length && (
            <Link className={classes.savedAll} to="/favorites">Ver los {new Intl.NumberFormat("es-EC").format(total)} en Favoritos</Link>
          )}
        </>
      )}
    </section>
  );
}
