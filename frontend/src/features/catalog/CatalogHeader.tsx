import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { Menu } from "@base-ui/react/menu";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { authLocation, safeAuthReturnHref } from "@/features/auth/authLocation";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { getProfile, profileQueryKey } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { searchPublicEditions } from "@/shared/api/catalog";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";

interface CatalogHeaderProps {
  criteria: CatalogCriteria;
  pending?: boolean;
  onSearch?: (query: string) => void;
  compact?: boolean;
}

function validateSearchQuery(query: string) {
  if (query.length > 140) return "La búsqueda no puede superar 140 caracteres.";
  return null;
}

export function CatalogHeader({ criteria, pending = false, onSearch, compact = false }: CatalogHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { session, clear, logout } = useSession();
  const isSubmittingRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(criteria.query);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchDialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionListRef = useRef<HTMLUListElement>(null);
  const restoreSearchFocusRef = useRef(true);
  const searchInputId = useId();
  const searchHelpId = useId();
  const searchErrorId = useId();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [query, setQuery] = useState(criteria.query);
  const previousQuery = useRef(criteria.query);

  useEffect(() => {
    if (navigationType === "POP" || previousQuery.current !== criteria.query) {
      setQuery(criteria.query);
      setSearchInput(criteria.query);
      setSearchError(null);
    }
    previousQuery.current = criteria.query;
  }, [criteria.query, location.key, navigationType]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => setSuggestionQuery(searchInput.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchOpen]);

  const searchSuggestions = useQuery({
    queryKey: ["catalog-search-suggestions", suggestionQuery],
    queryFn: ({ signal }) => searchPublicEditions({
      query: suggestionQuery,
      category: "",
      minPrice: "",
      maxPrice: "",
      language: "",
      format: "",
      sort: "TITLE_ASC",
      page: 0,
      pageSize: 6,
    }, signal),
    enabled: searchOpen && suggestionQuery.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    const dialog = searchDialogRef.current;
    if (!dialog) return;
    if (searchOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    } else if (!searchOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else {
        dialog.removeAttribute("open");
        onSearchDialogClose();
      }
    }
  }, [searchOpen]);

  const rawFrom = new URLSearchParams(location.search).get("from");
  const returnCandidate = location.pathname === "/sign-in" || location.pathname === "/register"
    ? rawFrom
    : `${location.pathname}${location.search}`;
  const returnTo = safeAuthReturnHref(returnCandidate);
  const isCustomer = session?.user.role === "CUSTOMER";
  const cartQuery = useCustomerCart(isCustomer, { fresh: false });
  const cartUnits = cartQuery.data ? cartUnitCount(cartQuery.data.items) : null;
  const cartCountKey = cartUnits ?? "loading";
  const initialCartCountKey = useRef(cartCountKey);
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

  function openSearch() {
    setSearchInput(query);
    setSuggestionQuery("");
    setSearchError(null);
    restoreSearchFocusRef.current = true;
    setSearchOpen(true);
  }

  function closeSearch(restoreFocus = true) {
    restoreSearchFocusRef.current = restoreFocus;
    setSearchOpen(false);
  }

  function onSearchDialogClose() {
    setSearchOpen(false);
    if (restoreSearchFocusRef.current) {
      window.setTimeout(() => searchTriggerRef.current?.focus(), 0);
    }
    restoreSearchFocusRef.current = true;
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || isSubmittingRef.current) return;
    const error = validateSearchQuery(searchInput);
    setSearchError(error);
    if (error) return;
    isSubmittingRef.current = true;
    try {
      const normalized = searchInput.trim();
      if (onSearch) onSearch(normalized);
      else navigate(catalogHref({ ...criteria, query: normalized, page: 0 }));
      setQuery(normalized);
      setSearchInput(normalized);
      closeSearch();
    } finally {
      isSubmittingRef.current = false;
    }
  }

  function focusSuggestion(index: number) {
    const links = suggestionListRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
    if (links?.length) links[Math.max(0, Math.min(index, links.length - 1))]?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && searchSuggestions.data?.items.length) {
      event.preventDefault();
      focusSuggestion(0);
    }
  }

  function handleSuggestionKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSuggestion(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchInputRef.current?.focus();
      else focusSuggestion(index - 1);
    }
  }

  const waitingForSuggestions = searchInput.trim().length > 0
    && (searchInput.trim() !== suggestionQuery || searchSuggestions.isFetching);

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

        <nav className="account-links" aria-label="Cuenta y carrito">
          {!compact && (
            <button
              ref={searchTriggerRef}
              className="header-icon-action search-trigger"
              type="button"
              aria-label="Buscar en el catálogo"
              title="Buscar"
              onClick={openSearch}
            >
              <MaterialSymbol name="search" aria-hidden="true" context="header" />
            </button>
          )}
          {session ? (
            <>
              {isCustomer && (
                <Link
                  className="account-cart"
                  to="/cart"
                  aria-label={`Carrito, ${cartUnits === null ? "consultando unidades" : cartUnits === 1 ? "1 unidad" : `${cartUnits} unidades`}`}
                  aria-current={location.pathname === "/cart" ? "page" : undefined}
                >
                  <MaterialSymbol name="shopping_cart" aria-hidden="true" context="header" />
                  <span className="account-cart-count" aria-hidden="true">
                    <span
                      key={cartCountKey}
                      className="account-cart-count-value"
                      data-animate={initialCartCountKey.current === cartCountKey ? undefined : "true"}
                      aria-hidden="true"
                    >
                      {cartUnits ?? "…"}
                    </span>
                  </span>
                  <span className="visually-hidden" aria-live="polite" aria-atomic="true">
                    {cartUnits === null ? "Consultando unidades" : `${cartUnits} unidades`}
                  </span>
                </Link>
              )}
              <Menu.Root open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
                <Menu.Trigger className="account-menu-trigger" aria-label="Menú de cuenta" title="Menú de cuenta">
                  <MaterialSymbol name="account_circle" aria-hidden="true" context="header" />
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
                            <MaterialSymbol name="account_circle" aria-hidden="true" size={17} />
                            <span>Mi cuenta</span>
                          </Menu.LinkItem>
                          <Menu.LinkItem
                            render={<Link to="/orders" />}
                            closeOnClick
                            className="account-menu-item"
                            aria-current={location.pathname.startsWith("/orders") ? "page" : undefined}
                          >
                            <MaterialSymbol name="shopping_cart" aria-hidden="true" size={17} />
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
                        <MaterialSymbol name="logout" aria-hidden="true" size={17} />
                        <span>Cerrar sesión</span>
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </>
          ) : (
            compact ? (
              <>
                <Link to={authLocation("/sign-in", returnTo)}>Iniciar sesión</Link>
                <Link className="account-create" to={authLocation("/register", returnTo)}>Crear cuenta</Link>
              </>
            ) : (
              <Link
                className="header-icon-action account-icon-link"
                to={authLocation("/sign-in", returnTo)}
                aria-label="Iniciar sesión"
                title="Iniciar sesión"
              >
                <MaterialSymbol name="account_circle" aria-hidden="true" context="header" />
              </Link>
            )
          )}
        </nav>
      </div>
      {!compact && (
        <dialog
          ref={searchDialogRef}
          className="search-dialog"
          aria-labelledby="global-search-title"
          onCancel={(event) => {
            event.preventDefault();
            closeSearch();
          }}
          onClose={onSearchDialogClose}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch(true);
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <div className="search-dialog-frame">
            <div className="search-dialog-header">
              <Link
                className="wordmark search-dialog-wordmark"
                to="/"
                aria-label="PLIEGO, ir al inicio"
                onClick={(event) => {
                  if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeSearch(false);
                }}
              >
                <span>PLIEGO</span>
                <small>CATÁLOGO</small>
              </Link>
              <form className="search-dialog-form" onSubmit={submitSearch} role="search">
                <h2 id="global-search-title" className="visually-hidden">Buscar en el catálogo</h2>
                <MaterialSymbol name="search" aria-hidden="true" context="header" />
                <label className="visually-hidden" htmlFor={searchInputId}>Buscar en el catálogo</label>
                <input
                  ref={searchInputRef}
                  id={searchInputId}
                  name="query"
                  type="search"
                  maxLength={140}
                  placeholder="Buscar títulos, autores o ISBN…"
                  aria-invalid={Boolean(searchError)}
                  aria-describedby={searchError ? searchErrorId : searchHelpId}
                  aria-busy={waitingForSuggestions}
                  value={searchInput}
                  onKeyDown={handleSearchKeyDown}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSearchInput(next);
                    if (searchError) setSearchError(validateSearchQuery(next));
                  }}
                />
                <span id={searchHelpId} className="visually-hidden">
                  Busca coincidencias en títulos, autores o ISBN-13. Usa las flechas para recorrer las ediciones sugeridas.
                </span>
                <button className="search-dialog-close" type="button" aria-label="Cerrar búsqueda" onClick={() => closeSearch(true)}>
                  <MaterialSymbol name="close" aria-hidden="true" context="header" />
                </button>
                {searchError && <span id={searchErrorId} className="visually-hidden">{searchError}</span>}
              </form>
            </div>
            {searchInput.trim() && (
              <section className="search-suggestions" aria-label="Resultados sugeridos" aria-busy={waitingForSuggestions}>
                {searchError ? (
                  <p className="search-suggestions-message" role="alert">{searchError}</p>
                ) : waitingForSuggestions ? (
                  <p className="search-suggestions-message" role="status">Buscando ediciones…</p>
                ) : searchSuggestions.isError ? (
                  <div className="search-suggestions-error" role="alert">
                    <p>No pudimos cargar sugerencias. Comprueba tu conexión e inténtalo otra vez.</p>
                    <Button variant="secondary" type="button" onClick={() => void searchSuggestions.refetch()}>Reintentar</Button>
                  </div>
                ) : searchSuggestions.data?.items.length ? (
                  <>
                    <h2 className="search-suggestions-heading">Ediciones</h2>
                    <ul className="search-suggestions-list" ref={suggestionListRef}>
                      {searchSuggestions.data.items.map((edition, index) => (
                        <li key={edition.editionId}>
                          <Link
                            className="search-suggestion-link"
                            to={`/catalog/editions/${edition.editionId}?from=${encodeURIComponent(catalogHref({ ...criteria, query: searchInput.trim(), page: 0 }))}`}
                            onClick={(event) => {
                              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeSearch(false);
                            }}
                            onKeyDown={(event) => handleSuggestionKeyDown(event, index)}
                          >
                            <MaterialSymbol name="search" aria-hidden="true" size={18} />
                            <span className="search-suggestion-copy">
                              <strong>{edition.title}</strong>
                              <span>{edition.authors || edition.publisher || "Edición del catálogo"}</span>
                            </span>
                            {edition.isbn13 && <span className="search-suggestion-isbn">ISBN {edition.isbn13}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : searchSuggestions.data ? (
                  <p className="search-suggestions-message" role="status">No encontramos ediciones para “{suggestionQuery}”.</p>
                ) : null}
              </section>
            )}
          </div>
        </dialog>
      )}
    </header>
  );
}
