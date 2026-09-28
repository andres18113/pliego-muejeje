import { Minus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { BookCover } from "@/features/catalog/BookCover";
import { formatUsd } from "@/features/catalog/formatters";
import { removeCartItem, updateCartItemQuantity, type CartLine } from "@/shared/api/cart";
import { ApiRequestError } from "@/shared/api/errors";
import { cartUnitCount, useCustomerCart } from "./cartQuery";
import { CustomerOnly, PurchasePage } from "./PurchaseChrome";
import { canChangeQuantity, unavailabilityText, unitsLabel } from "./purchaseText";

type LineFeedback = { cartItemId: string; tone: "success" | "error"; message: string };
type CartNotice = { tone: "success" | "error"; message: string };
type CartCommand =
  | { kind: "quantity"; line: CartLine; quantity: number }
  | { kind: "remove"; line: CartLine };

export function CartPage() {
  return (
    <PurchasePage title="Tu carrito">
      <CustomerOnly intent="/cart" task="ver tu carrito">
        <CartContent />
      </CustomerOnly>
    </PurchasePage>
  );
}

function CartContent() {
  const { clear: clearSession } = useSession();
  const cartQuery = useCustomerCart(true);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const commandLock = useRef(false);
  const [lineFeedback, setLineFeedback] = useState<LineFeedback | null>(null);
  const [notice, setNotice] = useState<CartNotice | null>(null);

  const command = useMutation({
    mutationFn: async (next: CartCommand) => {
      if (next.kind === "quantity") await updateCartItemQuantity(next.line.cartItemId, next.quantity);
      else await removeCartItem(next.line.cartItemId);
    },
    retry: false,
    onSuccess: async (_, next) => {
      await cartQuery.refetch();
      if (next.kind === "quantity") {
        setLineFeedback({
          cartItemId: next.line.cartItemId,
          tone: "success",
          message: `Cantidad actualizada: ${unitsLabel(next.quantity)}.`,
        });
      } else {
        setLineFeedback(null);
        showNotice({ tone: "success", message: `Quitamos «${next.line.title}» del carrito.` });
      }
    },
    onError: async (error: Error, next) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession("expired");
        return;
      }
      const code = error instanceof ApiRequestError ? error.code : undefined;
      await cartQuery.refetch();
      if (code === "P4003" || code === "P4001") {
        showNotice({ tone: "error", message: "Ese artículo ya no estaba en tu carrito. Mostramos el carrito actual." });
        return;
      }
      const message = code === "P3002"
        ? `No hay existencias suficientes para ${next.kind === "quantity" ? unitsLabel(next.quantity) : "esta cantidad"}. La cantidad no cambió.`
        : code === "P2042" || code === "P2043"
        ? "Esta edición ya no está a la venta. Puedes quitarla del carrito."
        : error instanceof ApiRequestError && error.status < 500
        ? `${error.title}. ${error.detail}`
        : "No pudimos confirmar el cambio. Mostramos el estado actual del carrito; revísalo antes de intentarlo otra vez.";
      setLineFeedback({ cartItemId: next.line.cartItemId, tone: "error", message });
    },
    onSettled: () => {
      commandLock.current = false;
    },
  });

  function run(next: CartCommand) {
    if (commandLock.current) return;
    commandLock.current = true;
    setNotice(null);
    setLineFeedback(null);
    command.mutate(next);
  }

  function showNotice(next: CartNotice) {
    setNotice(next);
    // The removed line's controls leave the DOM; keep keyboard users in the cart.
    window.requestAnimationFrame(() => noticeRef.current?.focus({ preventScroll: false }));
  }

  const cart = cartQuery.data;
  const busyLineId = command.isPending ? command.variables?.line.cartItemId : undefined;

  return (
    <>
      <header className="purchase-heading">
        <h1>Tu carrito</h1>
        <p>El carrito no reserva existencias. Los precios y la disponibilidad son los actuales y se confirman otra vez al finalizar la compra.</p>
      </header>

      <p
        ref={noticeRef}
        className={notice ? `purchase-notice purchase-notice--${notice.tone}` : "visually-hidden"}
        role={notice?.tone === "error" ? "alert" : "status"}
        tabIndex={-1}
      >
        {notice?.message}
      </p>

      {cartQuery.isPending ? (
        <p className="purchase-loading" role="status">Consultando tu carrito…</p>
      ) : cartQuery.isError && !cart ? (
        <ReadFailure onRetry={() => void cartQuery.refetch()} retrying={cartQuery.isFetching} />
      ) : cart && cart.items.length === 0 ? (
        <section className="empty-state purchase-empty" aria-labelledby="cart-empty-heading">
          <div className="empty-rule" aria-hidden="true" />
          <h2 id="cart-empty-heading">Tu carrito está vacío.</h2>
          <p>Explora el catálogo y agrega una edición para empezar.</p>
          <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
        </section>
      ) : cart ? (
        <div className="purchase-layout">
          <section aria-labelledby="cart-lines-heading">
            <h2 id="cart-lines-heading" className="visually-hidden">Libros en tu carrito</h2>
            {cartQuery.isError && (
              <p className="purchase-notice purchase-notice--error" role="alert">
                No pudimos actualizar el carrito. Lo que ves puede estar desactualizado.{" "}
                <Button variant="text" type="button" onClick={() => void cartQuery.refetch()}>Volver a consultar</Button>
              </p>
            )}
            <ul className="cart-lines">
              {cart.items.map((line) => (
                <CartLineItem
                  key={line.cartItemId}
                  line={line}
                  busy={busyLineId === line.cartItemId}
                  locked={command.isPending}
                  feedback={lineFeedback?.cartItemId === line.cartItemId ? lineFeedback : null}
                  onQuantity={(quantity) => run({ kind: "quantity", line, quantity })}
                  onRemove={() => run({ kind: "remove", line })}
                />
              ))}
            </ul>
          </section>

          <aside className="purchase-summary" aria-labelledby="cart-summary-heading">
            <h2 id="cart-summary-heading">Resumen</h2>
            <dl>
              <div><dt>Unidades</dt><dd>{cartUnitCount(cart.items)}</dd></div>
              <div className="purchase-total"><dt>Total</dt><dd>{formatUsd(cart.totalCurrent)}</dd></div>
            </dl>
            <p className="purchase-summary-note">El total es la suma de los precios actuales de tus libros.</p>
            {cart.items.some((line) => !line.available) ? (
              <p className="purchase-summary-blocker" role="status">
                Ajusta o quita los libros no disponibles para continuar con la compra.
              </p>
            ) : (
              <ButtonLink variant="primary" className="purchase-primary" to="/checkout">
                Continuar con la compra
              </ButtonLink>
            )}
            <Link className="purchase-secondary-link" to="/catalog">Seguir explorando el catálogo</Link>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function CartLineItem({
  line,
  busy,
  locked,
  feedback,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  busy: boolean;
  locked: boolean;
  feedback: LineFeedback | null;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const quantityEditable = canChangeQuantity(line.unavailabilityReason);
  const canIncrease = quantityEditable && line.unavailabilityReason !== "P3002";
  const statusId = `cart-line-status-${line.cartItemId}`;

  return (
    <li className={`cart-line${line.available ? "" : " cart-line--unavailable"}`} aria-busy={busy}>
      <Link className="cart-line-cover" to={`/catalog/editions/${line.editionId}`} tabIndex={-1} aria-hidden="true">
        <BookCover url={line.coverUrl} license={null} attribution={null} title={line.title} size="compact" />
      </Link>
      <div className="cart-line-copy">
        <h3><Link to={`/catalog/editions/${line.editionId}`}>{line.title}</Link></h3>
        {line.authors && <p className="cart-line-authors">{line.authors}</p>}
        <p className="cart-line-price">{formatUsd(line.currentPrice)} <span>por unidad</span></p>
        <p className={`edition-availability ${line.available ? "is-available" : "is-unavailable"}`}>
          <span className="availability-mark" aria-hidden="true" />
          {line.available ? "Disponible" : unavailabilityText(line.unavailabilityReason)}
        </p>
      </div>

      <div className="cart-line-controls">
        {quantityEditable ? (
          <div className="quantity-stepper" role="group" aria-label={`Cantidad de ${line.title}`} aria-describedby={statusId}>
            <Button
              type="button"
              className="quantity-step"
              aria-label={`Quitar una unidad de ${line.title}`}
              aria-disabled={locked || line.quantity <= 1 || undefined}
              onClick={() => !locked && line.quantity > 1 && onQuantity(line.quantity - 1)}
            >
              <Minus aria-hidden="true" size={16} />
            </Button>
            <span className="quantity-value" aria-live="off">
              <span className="visually-hidden">Cantidad: </span>{line.quantity}
            </span>
            <Button
              type="button"
              className="quantity-step"
              aria-label={`Agregar una unidad de ${line.title}`}
              aria-disabled={locked || !canIncrease || undefined}
              onClick={() => !locked && canIncrease && onQuantity(line.quantity + 1)}
            >
              <Plus aria-hidden="true" size={16} />
            </Button>
          </div>
        ) : (
          <p className="quantity-static">Cantidad: {line.quantity}</p>
        )}
        <p className="cart-line-subtotal">
          <span className="visually-hidden">Subtotal: </span>{formatUsd(line.currentSubtotal)}
        </p>
        <Button
          variant="text"
          type="button"
          className="cart-line-remove"
          aria-label={`Quitar ${line.title} del carrito`}
          aria-disabled={locked || undefined}
          onClick={() => !locked && onRemove()}
        >
          Quitar
        </Button>
      </div>

      <p
        id={statusId}
        className={`cart-line-feedback${feedback ? ` cart-line-feedback--${feedback.tone}` : ""}`}
        role={feedback?.tone === "error" ? "alert" : "status"}
      >
        {busy ? "Actualizando el carrito…" : feedback?.message}
      </p>
    </li>
  );
}

export function ReadFailure({ onRetry, retrying, title = "No pudimos consultar tu carrito." }: {
  onRetry: () => void;
  retrying: boolean;
  title?: string;
}) {
  return (
    <section className="purchase-error" role="alert" aria-labelledby="purchase-read-error">
      <h2 id="purchase-read-error">{title}</h2>
      <p>Comprueba tu conexión e inténtalo otra vez.</p>
      <Button variant="secondary" type="button" onClick={onRetry} aria-disabled={retrying || undefined}>
        {retrying ? "Consultando…" : "Volver a intentar"}
      </Button>
    </section>
  );
}
