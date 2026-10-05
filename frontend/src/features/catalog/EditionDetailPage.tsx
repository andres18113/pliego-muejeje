import { useAvailabilityFocus } from "./useAvailabilityFocus";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { addEditionToCart, getActiveCart } from "@/shared/api/cart";
import { ApiRequestError, describeApiError } from "@/shared/api/errors";
import { getPublicEdition } from "@/shared/api/catalog";
import { isDigitalFormat } from "@/shared/api/editionFormats";
import { authLocation } from "@/features/auth/authLocation";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { BackToCatalogLink, CatalogReturnLink } from "@/shared/ui/BackToCatalogLink";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import { useSession } from "@/app/session";
import { useFavoriteSessionFailure, useFavoriteStatuses } from "@/features/favorites/favoriteStatus";
import { FavoriteButton } from "./FavoriteButton";
import { favoriteStatusQueryKey } from "@/shared/api/favorites";
import { BookCover } from "./BookCover";
import { StockStatus } from "./StockStatus";
import { availabilityConflictMessage, resolveStockStatus, stockReadOptions } from "./stockStatusModel";
import surface from "./availabilitySurface.module.css";
import classes from "./editionDetail.module.css";
import { formatAudioDuration, formatEdition, formatLanguage, formatPageCount, formatPublicationDate, formatUsd } from "./formatters";
import { catalogHref, readCatalogCriteria, safeCatalogReturnHref, safeExternalHttpHref } from "./catalogUrl";

type PurchaseFeedback = {
  kind: "success" | "unavailable" | "validation" | "failure" | "unknown" | "auth";
  message: string;
};

type CoverPreview = {
  url: string;
  license: string | null;
  attribution: string | null;
  title: string;
};

function coverPreviewFromNavigation(state: unknown, editionId: string): CoverPreview | null {
  if (!state || typeof state !== "object" || !("coverPreview" in state)) return null;
  const preview = state.coverPreview;
  if (!preview || typeof preview !== "object" || !("editionId" in preview)
      || preview.editionId !== editionId || !("url" in preview) || typeof preview.url !== "string"
      || !("title" in preview) || typeof preview.title !== "string") return null;
  const license = "license" in preview && typeof preview.license === "string" ? preview.license : null;
  const attribution = "attribution" in preview && typeof preview.attribution === "string"
    ? preview.attribution
    : null;
  return { url: preview.url, license, attribution, title: preview.title };
}

export function EditionDetailPage() {
  const { editionId = "" } = useParams();
  const location = useLocation();
  const { session, clear: clearSession } = useSession();
  const queryClient = useQueryClient();
  const addLock = useRef(false);
  const cartPreflightComplete = useRef(false);
  const quantityBeforeAttempt = useRef(0);
  const addAttemptStartedAt = useRef<number | null>(null);
  const addedPulseTimer = useRef<number | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const [purchaseFeedback, setPurchaseFeedback] = useState<PurchaseFeedback | null>(null);
  const [addedPulse, setAddedPulse] = useState(false);
  const returnHref = safeCatalogReturnHref(new URLSearchParams(location.search).get("from"));
  const currentIntent = `${location.pathname}${location.search}`;
  const coverPreview = coverPreviewFromNavigation(location.state, editionId);
  const historyIndex = Number(window.history.state?.idx);
  const cameFromCatalog = Boolean(
    location.state && typeof location.state === "object"
      && "catalogReturn" in location.state && location.state.catalogReturn === true,
  );
  const returnWithHistory = Boolean(cameFromCatalog && Number.isInteger(historyIndex) && historyIndex > 0);
  const criteria = useMemo(
    () => readCatalogCriteria(new URL(returnHref, window.location.origin).search),
    [returnHref],
  );
  const isValidEditionId = isEditionId(editionId);
  const customerId = session?.user.role === "CUSTOMER" ? session.user.userId : null;
  const favoriteQuery = useFavoriteStatuses(isValidEditionId ? [editionId] : [], customerId);
  useFavoriteSessionFailure(favoriteQuery.error, clearSession);
  const detailQuery = useQuery({
    queryKey: ["public-catalog", "edition", editionId],
    ...stockReadOptions,
    queryFn: ({ signal }) => getPublicEdition(editionId, signal),
    enabled: isValidEditionId,
    staleTime: 30_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 404) && failureCount < 1,
  });
  const safeCoverSourceHref = safeExternalHttpHref(detailQuery.data?.coverSourceUrl);
  const addToCartMutation = useMutation({
    mutationFn: async () => {
      cartPreflightComplete.current = false;
      const cart = await getActiveCart();
      quantityBeforeAttempt.current = cart.items.find((item) => item.editionId === editionId)?.quantity ?? 0;
      cartPreflightComplete.current = true;
      if (isDigitalFormat(detailQuery.data?.format) && quantityBeforeAttempt.current >= 1) {
        return { quantity: quantityBeforeAttempt.current, alreadyInCart: true };
      }
      return { ...await addEditionToCart(editionId), alreadyInCart: false };
    },
    retry: false,
    onSuccess: async ({ quantity, alreadyInCart }) => {
      await queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
      await keepAddFeedbackVisible(addAttemptStartedAt.current);
      setAddedPulse(true);
      if (addedPulseTimer.current !== null) window.clearTimeout(addedPulseTimer.current);
      addedPulseTimer.current = window.setTimeout(() => setAddedPulse(false), 1_100);
      setPurchaseFeedback({ kind: "success", message: alreadyInCart ? "Esta edición digital ya está en tu carrito." : addedQuantityMessage(quantity) });
    },
    onError: async (error: Error) => {
      await keepAddFeedbackVisible(addAttemptStartedAt.current);
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        setPurchaseFeedback({
          kind: "auth",
          message: "Tu sesión ya no está activa. Inicia sesión para agregar esta edición.",
        });
        return;
      }

      const availabilityMessage = error instanceof ApiRequestError ? availabilityConflictMessage(error.code) : null;
      if (availabilityMessage) {
        setPurchaseFeedback({
          kind: "unavailable",
          message: availabilityMessage,
        });
        await detailQuery.refetch();
        return;
      }

      if (!(error instanceof ApiRequestError) || error.status >= 500) {
        if (!cartPreflightComplete.current) {
          setPurchaseFeedback({
            kind: "failure",
            message: "No pudimos consultar tu carrito y no enviamos la solicitud. Comprueba tu conexión antes de volver a intentarlo.",
          });
          return;
        }
        setPurchaseFeedback({
          kind: "unknown",
          message: "No pudimos confirmar si se agregó. Comprueba el estado del carrito antes de volver a intentarlo.",
        });
        return;
      }

      const apiError = describeApiError(error, "No pudimos agregar esta edición al carrito", "Revisa la solicitud e inténtalo otra vez.");
      setPurchaseFeedback({
        kind: error.status === 400 ? "validation" : "failure",
        message: `${apiError.title}. ${apiError.detail}`,
      });
    },
  });
  const cartCheckMutation = useMutation({
    mutationFn: getActiveCart,
    retry: false,
    onSuccess: (cart) => {
      const currentItem = cart.items.find((item) => item.editionId === editionId);
      const currentQuantity = currentItem?.quantity ?? 0;
      const quantityDelta = currentQuantity - quantityBeforeAttempt.current;

      if (quantityDelta === 1) {
        setPurchaseFeedback({
          kind: "success",
          message: cartQuantityMessage(currentQuantity, "El carrito ahora muestra"),
        });
        void queryClient.invalidateQueries({ queryKey: ["customer-cart"] });
      } else if (quantityDelta === 0) {
        setPurchaseFeedback({
          kind: "failure",
          message: "El carrito no muestra una unidad nueva de esta edición. Puedes volver a intentarlo.",
        });
      } else {
        setPurchaseFeedback({
          kind: "unknown",
          message: cartQuantityMessage(currentQuantity, "El carrito cambió mientras confirmábamos y ahora muestra"),
        });
      }
    },
    onError: (error: Error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        setPurchaseFeedback({
          kind: "auth",
          message: "Tu sesión ya no está activa. Inicia sesión para consultar el carrito.",
        });
        return;
      }
      setPurchaseFeedback({
        kind: "unknown",
        message: "No pudimos consultar el carrito. Comprueba tu conexión antes de volver a intentarlo.",
      });
    },
  });
  const stockFocus = useAvailabilityFocus(!detailQuery.error && Boolean(detailQuery.data?.available), () => document.getElementById("detail-error-heading") ?? detailHeadingRef.current, () => detailHeadingRef.current);
  const detail = detailQuery.data;

  useEffect(() => {
    document.title = detail?.title ? `${detail.title} · PLIEGO` : "Edición · PLIEGO";
    if (detail?.title && document.activeElement === document.body) {
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [detail?.title]);

  useEffect(() => () => {
    if (addedPulseTimer.current !== null) window.clearTimeout(addedPulseTimer.current);
  }, []);

  if (!isValidEditionId) {
    return (
      <DetailErrorPage
        returnHref={returnHref}
        title="No encontramos esta edición."
        detail="Puede que ya no esté disponible en el catálogo. Vuelve a la búsqueda para explorar las ediciones actuales."
        historyBack={returnWithHistory}
      />
    );
  }

  if (detailQuery.isPending) {
    return (
      <>

        <main className="detail-route page-frame" id="contenido-principal" tabIndex={-1} aria-busy="true">
          {!coverPreview && <h1 className="visually-hidden">Consultando la edición</h1>}
          <BackToCatalogLink to={returnHref} historyBack={returnWithHistory} />
          {coverPreview ? (
            <div className="edition-detail detail-loading-preview">
              <div className="detail-cover-column">
                <BookCover
                  url={coverPreview.url}
                  license={coverPreview.license}
                  attribution={coverPreview.attribution}
                  title={coverPreview.title}
                  size="detail"
                  loading="eager"
                />
              </div>
              <div className="detail-copy">
                <h1>{coverPreview.title}</h1>
                <p className="detail-loading" role="status" aria-live="polite">Consultando la edición…</p>
              </div>
            </div>
          ) : (
            <p className="detail-loading" role="status" aria-live="polite">Consultando la edición…</p>
          )}
        </main>
        <SiteFooter returnHref={returnHref} historyBack={returnWithHistory} />
      </>
    );
  }

  if (detailQuery.error || !detail) {
    const unavailable = detailQuery.error instanceof ApiRequestError && detailQuery.error.status === 404;
    return (
      <DetailErrorPage
        returnHref={returnHref}
        title={unavailable ? "No encontramos esta edición." : "No pudimos actualizar la edición."}
        detail={unavailable
          ? "Puede que ya no esté disponible en el catálogo. Vuelve a la búsqueda para explorar las ediciones actuales."
          : "Comprueba tu conexión e inténtalo otra vez."}
        historyBack={returnWithHistory}
        onRetry={unavailable ? undefined : () => void detailQuery.refetch()}
      />
    );
  }

  const title = detail.title || "Edición";
  const authors = detail.authors?.map((author) => author.name).filter(Boolean).join(", ") || "";
  const publisher = detail.publisher?.name || "";
  const stock = resolveStockStatus(detail);
  const purchasingAvailable = stock.canAddToCart && Boolean(detail.price);
  const customerSession = session?.user.role === "CUSTOMER";
  const adminSession = session?.user.role === "ADMIN";

  function addToCart() {
    if (!purchasingAvailable || addLock.current || addToCartMutation.isPending || cartCheckMutation.isPending || purchaseFeedback?.kind === "unknown") return;
    addLock.current = true;
    addAttemptStartedAt.current = Date.now();
    setAddedPulse(false);
    if (addedPulseTimer.current !== null) window.clearTimeout(addedPulseTimer.current);
    setPurchaseFeedback(null);
    addToCartMutation.mutate(undefined, { onSettled: () => { addLock.current = false; } });
  }

  function checkCart() {
    if (cartCheckMutation.isPending) return;
    cartCheckMutation.mutate();
  }

  const physical = !isDigitalFormat(detail.format);
  const favorite = (
    <FavoriteButton
                editionId={editionId}
                title={title}
                isFavorite={favoriteQuery.statusByEdition.get(editionId) ?? false}
                ready={!customerId || Boolean(favoriteQuery.data)}
                queryKey={favoriteStatusQueryKey(customerId ?? "guest", favoriteQuery.stableIds)}
                returnHref={currentIntent}
                className={physical ? classes.favorite : "detail-favorite-button"}
              />
  );
  const purchase = !purchasingAvailable ? (
                <p
                  className={`detail-purchase-feedback${purchaseFeedback?.kind === "unavailable" || !detail.available ? " detail-purchase-feedback--unavailable" : ""}`}
                  role="status"
                >
                  {purchaseFeedback?.kind === "unavailable"
                    ? purchaseFeedback.message
                    : detail.available
                    ? "No podemos agregar esta edición porque no hay un precio disponible."
                    : "Esta edición no está disponible para agregar al carrito."}
                </p>
              ) : customerSession ? (
                <>
                  {purchaseFeedback?.kind === "unknown" && (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={checkCart}
                      aria-disabled={cartCheckMutation.isPending}
                      aria-busy={cartCheckMutation.isPending}
                    >
                      {cartCheckMutation.isPending ? "Comprobando…" : "Comprobar el estado del carrito"}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    type="button"
                    onClick={addToCart}
                    {...stockFocus}
                    aria-describedby="edition-stock"
                    aria-disabled={addToCartMutation.isPending || cartCheckMutation.isPending || purchaseFeedback?.kind === "unknown"}
                    aria-busy={addToCartMutation.isPending}
                  >
                    <TransactionButtonLabel
                      state={addToCartMutation.isPending ? "pending" : addedPulse ? "success" : "idle"}
                      idle="Agregar al carrito"
                      pending="Agregando…"
                      success="Agregado"
                    />
                  </Button>
                  {purchaseFeedback?.kind === "success" && (
                    <ButtonLink variant="secondary" to="/cart">Ver el carrito</ButtonLink>
                  )}
                  {addToCartMutation.isPending && (
                    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
                      Agregando esta edición al carrito…
                    </p>
                  )}
                  {cartCheckMutation.isPending && (
                    <p
                      className="detail-purchase-feedback"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      Consultando el estado del carrito…
                    </p>
                  )}
                  {purchaseFeedback && (
                      <p
                        className={purchaseFeedback.kind === "success"
                          ? "visually-hidden"
                          : `detail-purchase-feedback detail-purchase-feedback--${purchaseFeedback.kind === "unavailable" ? "unavailable" : "error"}`}
                        role={purchaseFeedback.kind === "success" || purchaseFeedback.kind === "unavailable" ? "status" : "alert"}
                        aria-live={purchaseFeedback.kind === "success" || purchaseFeedback.kind === "unavailable" ? "polite" : "assertive"}
                        aria-atomic="true"
                      >
                        {purchaseFeedback.message}
                      </p>
                  )}
                </>
              ) : adminSession ? (
                <p className="detail-purchase-feedback">
                  El carrito está disponible únicamente para cuentas de cliente.
                </p>
              ) : (
                <>
                  {purchaseFeedback?.kind === "auth" && (
                    <p className="detail-purchase-feedback detail-purchase-feedback--error" role="alert">
                      {purchaseFeedback.message}
                    </p>
                  )}
                  <div className="detail-purchase-links">
                    <ButtonLink variant="primary" to={authLocation("/sign-in", currentIntent)}>
                      Iniciar sesión para agregar
                    </ButtonLink>
                    <Link to={authLocation("/register", currentIntent)}>Crear cuenta</Link>
                  </div>
                </>
              );

  if (physical) {
    const secondary = [publisher, formatEdition(detail.format), detail.language ? formatLanguage(detail.language) : ""].filter(Boolean);
    const facts = [
      detail.isbn13 ? ["ISBN-13", detail.isbn13] : null,
      detail.pageCount ? ["Páginas", formatPageCount(detail.pageCount)] : null,
      detail.publicationDate ? ["Publicación", formatPublicationDate(detail.publicationDate)] : null,
    ].filter((fact): fact is [string, string] => fact !== null);
    return (
      <>
        <main className={`detail-route page-frame ${classes.page}`} id="contenido-principal" tabIndex={-1}>
          <nav className={classes.trail} aria-label="Ruta de navegación">
            <CatalogReturnLink to={returnHref} historyBack={returnWithHistory}>Catálogo</CatalogReturnLink>
            <span aria-current="page">{title}</span>
          </nav>

          <article className={classes.edition} data-available={detail.available}>
            <div className={classes.cover}>
              <BookCover
                url={detail.coverUrl ?? null}
                license={detail.coverLicense ?? null}
                attribution={detail.coverAttribution ?? null}
                title={title}
                size="detail"
                loading="eager"
              />
              {safeCoverSourceHref && (
                <a className={classes.coverSource} href={safeCoverSourceHref} target="_blank" rel="noopener noreferrer">
                  Consultar fuente de la portada <span>(abre en pestaña nueva)</span>
                </a>
              )}
            </div>

            <header className={classes.identity}>
              <h1 ref={detailHeadingRef} tabIndex={-1} aria-describedby="edition-stock" data-long={title.length > 56 || undefined}>{title}</h1>
              {detail.subtitle && <p className={classes.subtitle}>{detail.subtitle}</p>}
              {authors && <p className={classes.authors}>{authors}</p>}
              {secondary.length > 0 && <p className={classes.secondary}>{secondary.map((fact) => <span key={fact}>{fact}</span>)}</p>}
            </header>

            <section className={classes.buy} aria-label="Compra">
              <div className={classes.offer}>
                {detail.price && <p className={classes.price}>{formatUsd(detail.price)}</p>}
                {detail.offer && <div aria-label="Oferta vigente"><p>Precio anterior: <s>{formatUsd(detail.offer.originalPrice!)}</s></p><p>Descuento: {formatUsd(detail.offer.discountAmount!)}</p></div>}
                <StockStatus id="edition-stock" available={detail.available} variant="quiet" className={classes.stock} />
              </div>
              <div className={classes.actions}>
                {purchase}
                {favorite}
              </div>
            </section>

            {facts.length > 0 && (
              <dl className={classes.facts}>
                {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            )}

            {detail.synopsis && <Synopsis text={detail.synopsis} />}

            {detail.categories && detail.categories.length > 0 && (
              <section className={classes.categories} aria-labelledby="detail-categories-heading">
                <h2 id="detail-categories-heading">Categorías</h2>
                <ul>
                  {detail.categories.map((category) => (
                    <li key={category.slug || category.name}>
                      {category.slug && category.name
                        ? <Link to={catalogHref({ ...criteria, category: category.slug, page: 0 })}>{category.name}</Link>
                        : category.name}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        </main>
        <SiteFooter returnHref={returnHref} historyBack={returnWithHistory} />
      </>
    );
  }

  // eBooks and audiobooks keep the previous presentation until their page is designed.
  return (
    <>

      <main className="detail-route page-frame" id="contenido-principal" tabIndex={-1}>
        <nav className="detail-breadcrumb" aria-label="Ruta de navegación">
          <CatalogReturnLink to={returnHref} historyBack={returnWithHistory}>Catálogo</CatalogReturnLink>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
        </nav>

        <article className="edition-detail">
          <div className="detail-cover-column">
            <BookCover
              url={detail.coverUrl ?? null}
              license={detail.coverLicense ?? null}
              attribution={detail.coverAttribution ?? null}
              title={title}
              size="detail"
              loading="eager"
            />
            {safeCoverSourceHref && (
              <a className="cover-source" href={safeCoverSourceHref} target="_blank" rel="noopener noreferrer">
                Consultar fuente de la portada <span>(abre en pestaña nueva)</span>
              </a>
            )}
          </div>

          <div className={`detail-copy ${surface.surface}`}>
            <h1 ref={detailHeadingRef} tabIndex={-1} aria-describedby="edition-stock">{title}</h1>
            {detail.subtitle && <p className="detail-subtitle">{detail.subtitle}</p>}
            {authors && <p className="detail-authors">{authors}</p>}
            {publisher && <p className="detail-publisher">{publisher}</p>}

            {detail.price && <p className="detail-price">{formatUsd(detail.price)}</p>}
            {detail.offer && <div aria-label="Oferta vigente"><p>Precio anterior: <s>{formatUsd(detail.offer.originalPrice!)}</s></p><p>Descuento: {formatUsd(detail.offer.discountAmount!)}</p></div>}
            <StockStatus id="edition-stock" available={detail.available} className={surface.status} />

            <div className="detail-purchase">
              {favorite}
              {purchase}
            </div>

            <dl className="edition-facts">
              <div><dt>Formato</dt><dd>{formatEdition(detail.format)}</dd></div>
              {detail.format === "EBOOK" && detail.ebookFileFormat && <div><dt>Formato de archivo</dt><dd>{detail.ebookFileFormat}</dd></div>}
              {detail.format === "AUDIOBOOK" && detail.audioDurationSeconds && <div><dt>Duración</dt><dd>{formatAudioDuration(detail.audioDurationSeconds)}</dd></div>}
              {detail.format === "AUDIOBOOK" && Boolean(detail.narrators?.length) && <div><dt>Narración</dt><dd>{detail.narrators!.join(", ")}</dd></div>}
              {detail.language && <div><dt>Idioma</dt><dd>{formatLanguage(detail.language)}</dd></div>}
              {detail.isbn13 && <div><dt>ISBN-13</dt><dd>{detail.isbn13}</dd></div>}
              {detail.pageCount && <div><dt>Páginas</dt><dd>{formatPageCount(detail.pageCount)}</dd></div>}
              {detail.publicationDate && <div><dt>Publicación</dt><dd>{formatPublicationDate(detail.publicationDate)}</dd></div>}
            </dl>

            {detail.synopsis && (
              <section className="detail-synopsis" aria-labelledby="synopsis-heading">
                <h2 id="synopsis-heading">Sinopsis</h2>
                <p>{detail.synopsis}</p>
              </section>
            )}

            {detail.categories && detail.categories.length > 0 && (
              <section className="detail-categories" aria-labelledby="detail-categories-heading">
                <h2 id="detail-categories-heading">Categorías</h2>
                <ul>
                  {detail.categories.map((category) => (
                    <li key={category.slug || category.name}>
                      {category.slug && category.name
                        ? <Link to={catalogHref({ ...criteria, category: category.slug, page: 0 })}>{category.name}</Link>
                        : category.name}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </article>
      </main>
      <SiteFooter returnHref={returnHref} historyBack={returnWithHistory} />
    </>
  );
}

/** The synopsis reads after the purchase decision: a comfortable column, opened in full only on request when long. */
function Synopsis({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 560;
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <section className={classes.synopsis} aria-labelledby="synopsis-heading">
      <h2 id="synopsis-heading">Sinopsis</h2>
      <div id="synopsis-text" className={classes.synopsisText} data-clamped={long && !open ? true : undefined}>
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      {long && (
        <button type="button" className={classes.more} aria-expanded={open} aria-controls="synopsis-text" onClick={() => setOpen(!open)}>
          {open ? "Mostrar menos" : "Leer la sinopsis completa"}
        </button>
      )}
    </section>
  );
}

function addedQuantityMessage(quantity: number) {
  const formattedQuantity = new Intl.NumberFormat("es-EC").format(quantity);
  return quantity === 1
    ? "Edición agregada al carrito. Ahora tienes 1 unidad de esta edición."
    : `Edición agregada al carrito. Ahora tienes ${formattedQuantity} unidades de esta edición.`;
}

async function keepAddFeedbackVisible(startedAt: number | null) {
  if (startedAt === null) return;
  const remaining = 500 - (Date.now() - startedAt);
  if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
}

function cartQuantityMessage(quantity: number, prefix: string) {
  const formattedQuantity = new Intl.NumberFormat("es-EC").format(quantity);
  return quantity === 1
    ? `${prefix} 1 unidad de esta edición. No repetimos la solicitud.`
    : `${prefix} ${formattedQuantity} unidades de esta edición. No repetimos la solicitud.`;
}

function DetailErrorPage({
  returnHref,
  title,
  detail,
  onRetry,
  historyBack = false,
}: {
  returnHref: string;
  title: string;
  detail: string;
  onRetry?: () => void;
  historyBack?: boolean;
}) {
  return (
    <>

      <main className="detail-route page-frame" id="contenido-principal" tabIndex={-1}>
        <BackToCatalogLink to={returnHref} historyBack={historyBack} />
        <section className="detail-error" role="alert" aria-labelledby="detail-error-heading">
          <h1 id="detail-error-heading" tabIndex={-1}>{title}</h1>
          <p>{detail}</p>
          {onRetry && (
            <Button variant="secondary" type="button" onClick={onRetry}>
              Volver a intentar
            </Button>
          )}
        </section>
      </main>
      <SiteFooter returnHref={returnHref} historyBack={historyBack} />
    </>
  );
}

function isEditionId(value: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}
