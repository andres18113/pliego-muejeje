import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "@/app/session";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/shared/api/errors";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import filterChips from "@/shared/ui/filterChips.module.css";
import { orderReference } from "@/features/purchase/purchaseText";
import { AdminPage } from "./AdminArea";
import { adminMomentLabel, normalizePickupCode, pickupStateFilters, pickupStateLabel, type PickupState, isDomainError } from "./adminModels";
import { rememberVerifiedCode, useAdminPickups, useLookupPickup, type AdminPickup } from "./adminQueries";
import classes from "./admin.module.css";

const PAGE_SIZE = 10;

/**
 * Retiros en tienda: the counter. A code the customer brings opens their order's page with the code already verified
 * (AdminPickupDetailPage: identity, then the confirmation). The queue below shows who is expected, each order one link
 * to that page; it never shows a pickup code, so nothing can be handed over without the customer's code.
 */
export function AdminPickupsPage() {
  return <AdminPage title="Retiros en tienda" intro="Verifica el código del cliente y su identidad antes de entregar el pedido.">
    <PickupCounter />
    <PickupQueue />
  </AdminPage>;
}

function lookupErrorText(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || isDomainError(error, "PICKUP_CODE_INVALID") || isDomainError(error, "PICKUP_NOT_FOUND")) return "No encontramos un retiro con ese código. Revisa los caracteres con el cliente.";
    if (error.status === 403) return "Tu cuenta no tiene permiso para verificar retiros.";
    if (error.status === 400) return error.detail || "Escribe el código tal como aparece en la confirmación del cliente.";
  }
  return "No pudimos verificar el código. Revisa tu conexión e inténtalo otra vez.";
}

function PickupCounter() {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { session } = useSession();
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const lookup = useLookupPickup();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizePickupCode(code);
    if (normalized.length < 4) { setFieldError("Escribe el código de retiro del cliente."); inputRef.current?.focus(); return; }
    setFieldError(null);
    lookup.mutate(normalized, {
      // The verified code goes to the order's page in memory only (never the URL or history).
      onSuccess: (pickup) => {
        if (session) rememberVerifiedCode(session.user.userId, pickup.orderId, normalized);
        navigate(`/admin/retiros/${pickup.orderId}`);
      },
      onError: (error) => { setFieldError(lookupErrorText(error)); inputRef.current?.focus(); },
    });
  };

  return <section className={classes.card} aria-labelledby="pickup-counter-heading">
    <div className={classes.sectionHead}>
      <h2 id="pickup-counter-heading">Entregar un pedido</h2>
      <p>Pide al cliente su código de retiro. Está en su confirmación de compra y en el correo que recibió.</p>
    </div>
    <form className={classes.lookup} onSubmit={submit} noValidate>
      <div className={classes.codeField}>
        <label htmlFor={inputId}>Código de retiro</label>
        <input ref={inputRef} id={inputId} className={classes.codeInput} value={code} placeholder="P-XXXXXXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14}
          aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? errorId : undefined}
          onChange={(event) => { setCode(event.target.value); if (fieldError) setFieldError(null); }} />
        {fieldError && <p id={errorId} className={classes.fieldError} role="alert">{fieldError}</p>}
      </div>
      <Button type="submit" variant="primary" disabled={lookup.isPending} aria-busy={lookup.isPending || undefined}>
        <MaterialSymbol name="search" size={20} aria-hidden="true" />{lookup.isPending ? "Verificando…" : "Verificar código"}
      </Button>
    </form>
  </section>;
}

function queueWhen(pickup: AdminPickup) {
  const ready = adminMomentLabel(pickup.readyAt);
  switch (pickup.state) {
    case "READY": return ready ? `Listo desde el ${ready}` : "Listo para retirar";
    case "PENDING": return ready ? `Listo aprox. el ${ready}` : "En preparación";
    case "COLLECTED": {
      const at = adminMomentLabel(pickup.collectedAt);
      return `${at ? `Retirado el ${at}` : "Retirado"}${pickup.collectedBy?.email ? ` · ${pickup.collectedBy.email}` : ""}`;
    }
    case "CANCELLED": return "Pedido cancelado";
    default: return null;
  }
}

const emptyText: Record<PickupState, string> = {
  READY: "No hay pedidos listos para retirar.",
  PENDING: "No hay pedidos en preparación.",
  COLLECTED: "Todavía no hay retiros confirmados.",
  CANCELLED: "No hay retiros cancelados.",
};

/** Who is expected, as the server orders them; it identifies orders and people, never their codes. */
function PickupQueue() {
  const searchId = useId();
  const [state, setState] = useState<PickupState>("READY");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pickups = useAdminPickups({ state, q: query || undefined, page, pageSize: PAGE_SIZE });
  const total = pickups.data ? Number(pickups.data.totalCount) : null;
  const pages = total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;

  return <section className={classes.queue} aria-labelledby="pickup-queue-heading">
    <div className={classes.sectionHead}>
      <h2 id="pickup-queue-heading">Pedidos para retirar</h2>
      <p>Para entregar uno, pide siempre su código al cliente.</p>
    </div>
    <div className={classes.toolbar}>
      <div className={filterChips.chips} role="group" aria-label="Estado del retiro">
        {pickupStateFilters.map((filter) => <button key={filter.value} type="button" className={filterChips.chip}
          aria-pressed={state === filter.value} onClick={() => { setState(filter.value); setPage(0); }}>{filter.label}</button>)}
      </div>
      <form className={classes.search} role="search" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setPage(0); }}>
        <MaterialSymbol name="search" size={20} aria-hidden="true" />
        <label htmlFor={searchId} className="visually-hidden">Buscar por pedido, nombre o correo</label>
        <input id={searchId} type="search" value={draft} placeholder="Pedido, nombre o correo" onChange={(event) => {
          setDraft(event.target.value);
          if (!event.target.value) { setQuery(""); setPage(0); }
        }} />
        <Button type="submit" variant="text">Buscar</Button>
      </form>
    </div>
    {pickups.isPending ? <p className={classes.count} role="status">Consultando retiros…</p>
      : pickups.isError ? <p className={classes.status} data-tone="error" role="alert">No pudimos consultar los retiros. <Button type="button" variant="text" onClick={() => void pickups.refetch()}>Reintentar</Button></p>
      : pickups.data.items.length === 0 ? <div className={classes.empty}>
        <MaterialSymbol name="storefront" size={28} aria-hidden="true" />
        <p>{query ? `Ningún retiro coincide con «${query}».` : emptyText[state]}</p>
      </div>
      : <>
        <p className={classes.count} aria-live="polite">{total === 1 ? "1 pedido" : `${total} pedidos`}{query ? ` para «${query}»` : ""}</p>
        <ul className={classes.rows} aria-label={pickupStateFilters.find((filter) => filter.value === state)?.label}>
          {pickups.data.items.map((pickup) => <li key={pickup.orderId}>
            <Link className={classes.row} to={`/admin/retiros/${pickup.orderId}`}>
              <div className={classes.rowRef}>
                <p>Pedido {orderReference(pickup)}</p>
                <span className={classes.stateChip} data-state={pickup.state}>{pickupStateLabel(pickup.state)}</span>
              </div>
              <div>
                <p><strong>{pickup.customer?.name ?? "Cliente"}</strong></p>
                <p className={classes.muted}>{[pickup.customer?.email, pickup.unitCount === 1 ? "1 libro" : `${pickup.unitCount} libros`].filter(Boolean).join(" · ")}</p>
              </div>
              <p className={classes.rowWhen}>{queueWhen(pickup)}{pickup.location?.name ? <><br />{pickup.location.name}</> : null}</p>
              <span className={classes.rowGo}>{pickup.state === "READY" ? "Entregar" : "Ver pedido"}<MaterialSymbol name="chevron_right" size={20} aria-hidden="true" /></span>
            </Link>
          </li>)}
        </ul>
        {pages > 1 && <nav className={classes.pager} aria-label="Páginas de retiros">
          <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {pages}</span>
          <Button type="button" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Siguiente</Button>
        </nav>}
      </>}
  </section>;
}
