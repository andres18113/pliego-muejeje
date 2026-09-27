import { zodResolver } from "@hookform/resolvers/zod";
import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/shared/ui/Field";
import { useSession } from "@/app/session";
import { authLocation } from "@/features/auth/authLocation";
import { catalogHref, safeCatalogReturnHref, type CatalogCriteria } from "./catalogUrl";

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
  const { session, clear } = useSession();
  const isSubmittingRef = useRef(false);
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
  const returnTo = safeCatalogReturnHref(returnCandidate);

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
        <Link className="wordmark" to="/" aria-label="PLIEGO, ir al catálogo">
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

        {!compact && <nav className="account-links" aria-label="Tu cuenta">
          {session ? (
            <>
              <span className="account-email">{session.user.email}</span>
              <Button className="account-session-end" type="button" onClick={clear}>
                Cerrar sesión
              </Button>
            </>
          ) : (
            <>
              <Link to={authLocation("/sign-in", returnTo)}>Iniciar sesión</Link>
              <Link className="account-create" to={authLocation("/register", returnTo)}>
                Crear cuenta
              </Link>
            </>
          )}
        </nav>}
      </div>
    </header>
  );
}
