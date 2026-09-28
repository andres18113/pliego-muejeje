import { zodResolver } from "@hookform/resolvers/zod";
import { Menu } from "@base-ui/react/menu";
import { LogOut, Search, ShoppingBag, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/shared/ui/Field";
import { useSession } from "@/app/session";
import { authLocation, safeAuthReturnHref } from "@/features/auth/authLocation";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { getProfile, profileQueryKey } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";

interface CatalogHeaderProps {
  criteria: CatalogCriteria;
  pending?: boolean;
  onSearch?: (query: string, scope: CatalogCriteria["scope"]) => void;
  compact?: boolean;
}

const searchLabels = {
  title: "Título",
  author: "Autor",
  isbn13: "ISBN-13",
} as const;

const searchSchema = z.object({
  query: z.string().max(140, "La búsqueda no puede superar 140 caracteres."),
  scope: z.enum(["title", "author", "isbn13"]),
}).superRefine(({ query, scope }, context) => {
  if (scope === "isbn13" && !/^[0-9]{13}$/.test(query.trim().replace(/[\s-]/g, ""))) {
    context.addIssue({
      code: "custom",
      path: ["query"],
      message: "Escribe los 13 dígitos del ISBN-13. Puedes usar espacios o guiones.",
    });
  }
});

type SearchForm = z.infer<typeof searchSchema>;

export function CatalogHeader({ criteria, pending = false, onSearch, compact = false }: CatalogHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, clear, logout } = useSession();
  const isSubmittingRef = useRef(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const { register, handleSubmit, reset, watch, clearErrors, formState: { errors, isSubmitting } } = useForm<SearchForm>({
    resolver: zodResolver(searchSchema),
    defaultValues: { query: criteria.query, scope: criteria.scope },
  });
  const scope = watch("scope");

  useEffect(() => {
    reset({ query: criteria.query, scope: criteria.scope });
  }, [criteria.query, criteria.scope, reset]);

  const rawFrom = new URLSearchParams(location.search).get("from");
  const returnCandidate = location.pathname === "/sign-in" || location.pathname === "/register"
    ? rawFrom
    : `${location.pathname}${location.search}`;
  const returnTo = safeAuthReturnHref(returnCandidate);
  const isCustomer = session?.user.role === "CUSTOMER";
  const cartQuery = useCustomerCart(isCustomer, { fresh: false });
  const cartUnits = cartQuery.data ? cartUnitCount(cartQuery.data.items) : null;
  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: ({ signal }) => getProfile(signal),
    enabled: accountMenuOpen && isCustomer,
    meta: { authRequired: true },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!session || !isCustomer) setAccountMenuOpen(false);
  }, [isCustomer, session]);

  useEffect(() => {
    if (session && profileQuery.error instanceof ApiRequestError && profileQuery.error.status === 401) {
      clear("expired");
    }
  }, [clear, profileQuery.error, session]);

  const accountName = profileQuery.data
    ? [profileQuery.data.firstNames.trim(), profileQuery.data.lastNames.trim()].filter(Boolean).join(" ")
    : "Tu cuenta";

  const submitSearch = handleSubmit(async (values) => {
    if (pending || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const query = values.scope === "isbn13"
        ? values.query.trim().replace(/[\s-]/g, "")
        : values.query.trim();
      if (onSearch) onSearch(query, values.scope);
      else navigate(catalogHref({ ...criteria, query, scope: values.scope, page: 0 }));
    } finally {
      isSubmittingRef.current = false;
    }
  });

  return (
    <header className={`site-header${compact ? " site-header--compact" : ""}`}>
      <Link
        className="skip-link"
        to="#contenido-principal"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("contenido-principal")?.focus();
        }}
      >
        Saltar al contenido
      </Link>
      <div className={`masthead page-frame${compact ? " masthead--compact" : ""}`}>
        <Link className="wordmark" to="/" aria-label="PLIEGO, ir al inicio">
          <span>PLIEGO</span>
          <small>CATÁLOGO</small>
        </Link>

        {!compact && <form className="catalog-search" onSubmit={submitSearch} role="search">
          <Field controlId="search-scope" className="search-scope" label="Buscar por">
            <select
              id="search-scope"
              {...register("scope", { onChange: () => clearErrors("query") })}
            >
              <option value="title">Título</option>
              <option value="author">Autor</option>
              <option value="isbn13">ISBN-13</option>
            </select>
          </Field>
          <Field controlId="catalog-query" className="search-query" label={searchLabels[scope]}>
            <input
              id="catalog-query"
              type="search"
              inputMode={scope === "isbn13" ? "numeric" : undefined}
              maxLength={scope === "isbn13" ? 19 : 140}
              aria-invalid={Boolean(errors.query)}
              aria-describedby={errors.query ? "search-error" : "search-help"}
              {...register("query")}
            />
            <span id="search-help" className="search-help">
              {scope === "isbn13"
                ? "Admite 13 dígitos, con espacios o guiones."
                : `Busca por ${searchLabels[scope].toLowerCase()}.`}
            </span>
          </Field>
          <Button
            variant="primary"
            className="search-submit"
            type="submit"
            aria-disabled={pending || isSubmitting}
            aria-busy={pending || isSubmitting}
          >
            <Search aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{pending || isSubmitting ? "Buscando" : "Buscar"}</span>
          </Button>
          {errors.query && (
            <p className="search-error" id="search-error" role="alert">
              {errors.query.message}
            </p>
          )}
        </form>}

        <nav className="account-links" aria-label="Cuenta y carrito">
          {session ? (
            <>
              {isCustomer && (
                <Link
                  className="account-cart"
                  to="/cart"
                  aria-current={location.pathname === "/cart" ? "page" : undefined}
                >
                  <ShoppingBag aria-hidden="true" size={17} strokeWidth={1.7} />
                  <span>Carrito</span>
                  <span className="account-cart-count" aria-live="polite">
                    <span aria-hidden="true">{cartUnits ?? "…"}</span>
                    <span className="visually-hidden">, {cartUnits === null ? "consultando unidades" : cartUnits === 1 ? "1 unidad" : `${cartUnits} unidades`}</span>
                  </span>
                </Link>
              )}
              <Menu.Root open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
                <Menu.Trigger className="account-menu-trigger" aria-label="Menú de cuenta" title="Menú de cuenta">
                  <UserRound aria-hidden="true" size={20} strokeWidth={1.8} />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner className="account-menu-positioner" side="bottom" align="end" sideOffset={8}>
                    <Menu.Popup className="account-menu-popup">
                      <div className="account-menu-identity" aria-busy={isCustomer && profileQuery.isPending}>
                        <p className="account-menu-name">{isCustomer ? accountName || "Tu cuenta" : "Sesión iniciada"}</p>
                        <p className="account-menu-email">{session.user.email}</p>
                      </div>
                      {logoutError && <p className="account-menu-error" role="alert">No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo otra vez.</p>}
                      {isCustomer && (
                        <>
                          <Menu.Separator className="account-menu-separator" />
                          <Menu.LinkItem
                            render={<Link to="/account" />}
                            closeOnClick
                            className="account-menu-item"
                            aria-current={location.pathname === "/account" ? "page" : undefined}
                          >
                            <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
                            <span>Mi cuenta</span>
                          </Menu.LinkItem>
                          <Menu.LinkItem
                            render={<Link to="/orders" />}
                            closeOnClick
                            className="account-menu-item"
                            aria-current={location.pathname.startsWith("/orders") ? "page" : undefined}
                          >
                            <ShoppingBag aria-hidden="true" size={17} strokeWidth={1.8} />
                            <span>Mis pedidos</span>
                          </Menu.LinkItem>
                        </>
                      )}
                      <Menu.Separator className="account-menu-separator" />
                      <Menu.Item className="account-menu-item account-menu-logout" onClick={() => {
                        void logout().then(() => setLogoutError(false)).catch(() => {
                          setLogoutError(true);
                          setAccountMenuOpen(true);
                        });
                      }}>
                        <LogOut aria-hidden="true" size={17} strokeWidth={1.8} />
                        <span>Cerrar sesión</span>
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </>
          ) : (
            <>
              <Link to={authLocation("/sign-in", returnTo)}>Iniciar sesión</Link>
              <Link className="account-create" to={authLocation("/register", returnTo)}>
                Crear cuenta
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
