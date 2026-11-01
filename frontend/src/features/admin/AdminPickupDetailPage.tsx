import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { formatEdition, formatUsd } from "@/features/catalog/formatters";
import { orderDateLabel, orderReference, paymentMethodLabel, paymentStateLabel } from "@/features/purchase/purchaseText";
import { ApiRequestError } from "@/shared/api/errors";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { AdminPage } from "./AdminArea";
import { adminMomentLabel, identityTypeLabel, normalizePickupCode, pickupStateLabel, isDomainError } from "./adminModels";
import {
  forgetVerifiedCode, peekVerifiedCode, useAdminPickup, useCancelPickupOrder, useCollectPickup, useVerifyPickupCode, type AdminPickupOrder,
} from "./adminQueries";
import classes from "./admin.module.css";

type Notice = { tone: "success" | "error"; text: string };
const queueLink = { label: "Retiros en tienda", to: "/admin/retiros" };

/**
 * One pickup order at the counter (ADR 0047, V-Model REQ-1…8). It reads as the order's identity, then the handover —
 * the only decision on the page — beside who is collecting and where. The handover is three steps in a fixed order:
 * the customer's code checked by the server against this order, the person checked against the registered identity,
 * then the confirmation. The server decides every state and refuses what its rules do not allow; after any refusal
 * the page shows the order as it is now.
 */
export function AdminPickupDetailPage() {
  const { orderId = "" } = useParams();
  const validId = /^[1-9][0-9]{0,18}$/.test(orderId);
  const pickup = useAdminPickup(orderId, validId);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);

  const missing = !validId || (pickup.error instanceof ApiRequestError && pickup.error.status === 404);
  if (missing) return <AdminPage title="Retiro no encontrado" parents={[queueLink]}>
    <section className={`${classes.card} ${classes.missing}`} aria-labelledby="pickup-missing">
      <h2 id="pickup-missing">No encontramos este retiro.</h2>
      <p className={classes.muted}>Puede que el pedido no exista o que no sea un retiro en tienda.</p>
      <div className={classes.actions}><ButtonLink variant="secondary" to="/admin/retiros">Volver a Retiros en tienda</ButtonLink></div>
    </section>
  </AdminPage>;
  if (pickup.isPending) return <AdminPage title="Retiro en tienda" parents={[queueLink]}>
    <p className={classes.count} role="status">Consultando el pedido…</p>
  </AdminPage>;
  if (!pickup.data) return <AdminPage title="Retiro en tienda" parents={[queueLink]}>
    <p className={classes.status} data-tone="error" role="alert">No pudimos consultar el pedido. <Button type="button" variant="text" onClick={() => void pickup.refetch()}>Reintentar</Button></p>
  </AdminPage>;

  const order = pickup.data;
  const reference = orderReference(order);
  return <AdminPage title={`Pedido ${reference}`} parents={[queueLink]}>
    {notice && <p ref={noticeRef} tabIndex={-1} className={classes.status} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
    <dl className={classes.orderFacts}>
      <div><dt>Realizado</dt><dd>{orderDateLabel(order.createdAt)}</dd></div>
      <div><dt>Libros</dt><dd>{order.unitCount === 1 ? "1 libro" : `${order.unitCount} libros`}</dd></div>
      <div><dt>Total</dt><dd>{formatUsd(order.total)}</dd></div>
      <div><dt>Pago</dt><dd>{[order.paymentMethod ? paymentMethodLabel(order.paymentMethod) : null, paymentStateLabel(order.paymentState)].filter(Boolean).join(" · ")}</dd></div>
    </dl>
    <div className={classes.detailLayout}>
      <div className={classes.detailMain}>
        <section className={classes.card} aria-labelledby="pickup-state-heading" data-admin="pickup-state" data-state={order.state}>
          <div className={classes.sectionHead}>
            <span className={classes.stateChip} data-state={order.state}>{pickupStateLabel(order.state)}</span>
            <h2 id="pickup-state-heading">Entrega</h2>
          </div>
          <PickupState key={`${order.orderId}:${order.state}`} order={order} onNotice={setNotice} />
        </section>
        <section className={classes.card} aria-labelledby="pickup-items-heading">
          <div className={classes.sectionHead}><h2 id="pickup-items-heading">Libros del pedido</h2></div>
          <ul className={classes.items} aria-labelledby="pickup-items-heading">
            {order.items.map((item) => <li key={item.orderItemId}>
              <span><strong>{item.title}</strong>{item.format ? <span className={classes.itemFormat}>{formatEdition(item.format)}</span> : null}</span>
              <span>× {item.quantity}</span>
            </li>)}
          </ul>
        </section>
      </div>
      <aside className={classes.detailAside} aria-label="Cliente y punto de retiro">
        <section className={classes.card} aria-labelledby="pickup-customer-heading">
          <div className={classes.sectionHead}><h2 id="pickup-customer-heading">Cliente</h2></div>
          <dl className={classes.sideFacts}>
            <div><dt>Nombre</dt><dd>{order.customer.name}</dd></div>
            <div><dt>Correo</dt><dd>{order.customer.email}</dd></div>
            <div><dt>{identityTypeLabel(order.customer.identityType)}</dt><dd className={order.customer.identityNumber ? classes.numberInline : undefined}>{order.customer.identityNumber ?? "No registrada"}</dd></div>
          </dl>
        </section>
        <section className={classes.card} aria-labelledby="pickup-point-heading">
          <div className={classes.sectionHead}><h2 id="pickup-point-heading">Punto de retiro</h2></div>
          <dl className={classes.sideFacts}>
            <div><dt>Lugar</dt><dd>{order.location.name}<span className={classes.muted}>{[order.location.address, order.location.city].filter(Boolean).join(", ")}</span></dd></div>
            {order.state === "COLLECTED" ? <>
              <div><dt>Retirado</dt><dd>{adminMomentLabel(order.collectedAt) ?? "—"}</dd></div>
              <div><dt>Confirmó</dt><dd>{order.collectedBy?.email ?? "Sin registro"}</dd></div>
              <div><dt>Identidad</dt><dd>{order.identityVerified ? "Verificada al entregar" : "Sin registro (retiro anterior)"}</dd></div>
            </> : order.state !== "CANCELLED" && adminMomentLabel(expectedReadyAt(order))
              ? <div><dt>{order.state === "READY" ? "Listo desde" : "Listo aprox."}</dt><dd>{adminMomentLabel(expectedReadyAt(order))}</dd></div> : null}
          </dl>
        </section>
      </aside>
    </div>
  </AdminPage>;
}

/**
 * When a preparing order can be collected: the later of the two server facts — its preparation time and, while the
 * cancellation window is open, the window's end (READY needs both). Presentation only; READY is the server's.
 */
function expectedReadyAt(order: AdminPickupOrder) {
  const times = [order.readyAt, order.availableActions?.cancellationDeadline].filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)));
  return times.length ? times.reduce((later, value) => (Date.parse(value) > Date.parse(later) ? value : later)) : null;
}

function PickupState({ order, onNotice }: { order: AdminPickupOrder; onNotice: (notice: Notice | null) => void }) {
  switch (order.state) {
    case "READY": return <Handover order={order} onNotice={onNotice} />;
    case "PENDING": return <>
      <p className={classes.outcome}><MaterialSymbol name="schedule" size={20} aria-hidden="true" />
        <span>Aún no está listo para retirar.{adminMomentLabel(expectedReadyAt(order)) ? ` Estará listo aproximadamente el ${adminMomentLabel(expectedReadyAt(order))}.` : ""} No entregues los libros todavía.</span></p>
      <CancelOrder order={order} onNotice={onNotice} />
    </>;
    case "COLLECTED": return <p className={classes.outcome} data-tone="success"><MaterialSymbol name="check_circle" size={20} aria-hidden="true" />
      <span>Retirado{adminMomentLabel(order.collectedAt) ? ` el ${adminMomentLabel(order.collectedAt)}` : ""}{order.collectedBy?.email ? `; lo confirmó ${order.collectedBy.email}` : ""}. No hay nada más que entregar.</span></p>;
    case "CANCELLED": return <p className={classes.outcome} data-tone="stop"><MaterialSymbol name="block" size={20} aria-hidden="true" />
      <span>Este pedido fue cancelado. No entregues los libros.</span></p>;
    default: return <p className={classes.outcome}>Estado no disponible.</p>;
  }
}

function verifyErrorText(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (isDomainError(error, "PICKUP_CODE_INVALID")) return "El código no corresponde a este pedido. Revísalo con el cliente.";
    if (error.status === 403) return "Tu cuenta no tiene permiso para verificar retiros.";
    if (error.status === 404) return "Este pedido ya no es un retiro disponible.";
    if (error.status === 400 && error.detail) return error.detail;
  }
  return "No pudimos verificar el código. Revisa tu conexión e inténtalo otra vez.";
}

function collectErrorText(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (isDomainError(error, "PICKUP_ALREADY_COLLECTED")) return "Este pedido ya fue retirado. No entregues los libros otra vez.";
    if (isDomainError(error, "PICKUP_NOT_READY")) return "El pedido todavía no está listo para retirar.";
    if (isDomainError(error, "PICKUP_CODE_INVALID")) return "El código ya no corresponde a este pedido. Vuelve a verificarlo.";
    if (isDomainError(error, "ORDER_INVALID_TRANSITION")) return "Este pedido ya no se puede entregar. Revisa su estado.";
    if (error.status === 403) return "Tu cuenta no tiene permiso para confirmar retiros.";
    if (error.detail) return error.detail;
  }
  return "No pudimos confirmar la entrega. Revisa tu conexión e inténtalo otra vez.";
}

/** Code → identity → confirm. Each step opens only when the previous one is done; nothing is confirmed by accident. */
function Handover({ order, onNotice }: { order: AdminPickupOrder; onNotice: (notice: Notice | null) => void }) {
  const { session } = useSession();
  const inputId = useId(), checkId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const identityRef = useRef<HTMLDivElement>(null);
  // A code verified at the counter arrives in memory once; otherwise the customer's code is asked here.
  const adminId = session?.user.userId ?? "";
  const [carried] = useState(() => adminId ? peekVerifiedCode(adminId, order.orderId) : null);
  // The carried code belongs to this visit only: leaving the page forgets it (the state above keeps it meanwhile).
  useEffect(() => () => forgetVerifiedCode(adminId, order.orderId), [adminId, order.orderId]);
  const [code, setCode] = useState("");
  const [verifiedCode, setVerifiedCode] = useState<string | null>(carried);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const verify = useVerifyPickupCode(order.orderId);
  const collect = useCollectPickup();
  const name = order.customer.name || "el cliente";
  const units = order.unitCount === 1 ? "1 libro" : `${order.unitCount} libros`;
  const ready = Boolean(verifiedCode) && checked;

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizePickupCode(code);
    if (normalized.length < 4) { setCodeError("Escribe el código de retiro del cliente."); inputRef.current?.focus(); return; }
    setCodeError(null); onNotice(null);
    verify.mutate(normalized, {
      onSuccess: () => { setVerifiedCode(normalized); setCode(""); requestAnimationFrame(() => identityRef.current?.focus()); },
      onError: (error) => { setCodeError(verifyErrorText(error)); inputRef.current?.focus(); },
    });
  };
  const changeCode = () => { forgetVerifiedCode(adminId, order.orderId); setVerifiedCode(null); setChecked(false); setConfirmError(null); requestAnimationFrame(() => inputRef.current?.focus()); };
  const confirm = () => {
    if (!verifiedCode) { setConfirmError("Primero verifica el código del cliente."); return; }
    if (!checked) { setConfirmError("Confirma que verificaste el documento de identidad."); return; }
    setConfirmError(null);
    collect.mutate({ orderId: order.orderId, pickupCode: verifiedCode }, {
      onSuccess: () => { forgetVerifiedCode(adminId, order.orderId); onNotice({ tone: "success", text: `Entrega confirmada: entregaste ${units} a ${name}.` }); },
      // The page re-reads the order (onSettled), so it shows what is true now.
      onError: (error) => onNotice({ tone: "error", text: collectErrorText(error) }),
    });
  };

  return <ol className={classes.steps}>
    <li className={classes.step} data-done={verifiedCode ? true : undefined}>
      <span className={classes.stepMark} aria-hidden="true">{verifiedCode ? <MaterialSymbol name="check" size={18} /> : 1}</span>
      <div className={classes.stepBody}>
        <h3>Código de retiro</h3>
        {verifiedCode ? <div className={classes.stepDone}>
          <p>Código verificado para este pedido.</p>
          <button type="button" className={classes.textAction} onClick={changeCode}>Usar otro código</button>
        </div> : <form className={classes.lookup} onSubmit={submitCode} noValidate>
          <div className={classes.codeField}>
            <label htmlFor={inputId}>Pide al cliente su código</label>
            <input ref={inputRef} id={inputId} className={classes.codeInput} value={code} placeholder="P-XXXXXXXX"
              autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14}
              aria-invalid={codeError ? true : undefined} aria-describedby={codeError ? `${inputId}-error` : undefined}
              onChange={(event) => { setCode(event.target.value); if (codeError) setCodeError(null); }} />
            {codeError && <p id={`${inputId}-error`} className={classes.fieldError} role="alert">{codeError}</p>}
          </div>
          <Button type="submit" variant="primary" disabled={verify.isPending} aria-busy={verify.isPending || undefined}>
            {verify.isPending ? "Verificando…" : "Verificar código"}
          </Button>
        </form>}
      </div>
    </li>
    <li className={classes.step} data-locked={verifiedCode ? undefined : true} data-done={checked ? true : undefined}>
      <span className={classes.stepMark} aria-hidden="true">{checked ? <MaterialSymbol name="check" size={18} /> : 2}</span>
      <div className={classes.stepBody} ref={identityRef} tabIndex={-1}>
        <h3>Identidad de quien retira</h3>
        {verifiedCode ? <>
          <div className={classes.identity}>
            <dl>
              <div><dt>Nombre</dt><dd>{order.customer.name}</dd></div>
              {order.customer.identityNumber
                ? <div><dt>{identityTypeLabel(order.customer.identityType)}</dt><dd className={classes.number}>{order.customer.identityNumber}</dd></div>
                : <div><dt>Identificación</dt><dd>No registrada</dd></div>}
            </dl>
            <p>{order.customer.identityNumber
              ? "Pide su documento y comprueba que el nombre y el número coincidan."
              : "No tiene una identificación registrada: comprueba que el nombre de su documento coincida."}</p>
          </div>
          <label className={classes.check} htmlFor={checkId}>
            <input id={checkId} type="checkbox" checked={checked} onChange={(event) => { setChecked(event.target.checked); if (event.target.checked) setConfirmError(null); }} />
            <span>Verifiqué el documento de identidad de {name}.</span>
          </label>
        </> : <p className={classes.muted}>Se habilita después de verificar el código.</p>}
      </div>
    </li>
    <li className={classes.step} data-locked={ready ? undefined : true}>
      <span className={classes.stepMark} aria-hidden="true">3</span>
      <div className={classes.stepBody}>
        <h3>Entrega</h3>
        <p className={classes.muted} id={`${checkId}-summary`}>{ready ? `Entregarás ${units} a ${name}.` : "Verifica el código y la identidad para continuar."}</p>
        {confirmError && <p className={classes.fieldError} role="alert">{confirmError}</p>}
        <div className={classes.actions}>
          <Button type="button" variant="primary" onClick={confirm} disabled={!ready || collect.isPending}
            aria-busy={collect.isPending || undefined} aria-describedby={`${checkId}-summary`}>
            {collect.isPending ? "Confirmando…" : "Confirmar entrega"}
          </Button>
        </div>
      </div>
    </li>
  </ol>;
}

/** REQ-8: the existing admin cancel, offered only while the server's own rules allow it, decided in a dialog. */
function CancelOrder({ order, onNotice }: { order: AdminPickupOrder; onNotice: (notice: Notice | null) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancel = useCancelPickupOrder(order.orderId);
  if (!order.availableActions?.cancel) return null;
  const close = () => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); };
  const deadline = adminMomentLabel(order.availableActions.cancellationDeadline);
  const consequence: ReactNode = order.paymentState === "PENDING"
    ? "No se realizará ningún cobro."
    : `Se reembolsarán ${formatUsd(order.total)} a ${order.customer.name || "el cliente"}.`;
  return <div className={classes.cancelFoot}>
    <p className={classes.muted}>{deadline ? `Todavía se puede cancelar hasta el ${deadline}.` : "Todavía se puede cancelar."}</p>
    <button ref={triggerRef} type="button" className={classes.textAction} onClick={() => setOpen(true)}>Cancelar pedido</button>
    <ConfirmDialog opened={open} destructive title={`¿Cancelar el pedido ${orderReference(order)}?`}
      confirmLabel="Cancelar pedido" busyLabel="Cancelando…" keepLabel="Conservar pedido" busy={cancel.isPending}
      onKeep={close} onConfirm={() => cancel.mutate(undefined, {
        onSuccess: () => { setOpen(false); onNotice({ tone: "success", text: `Cancelaste el pedido ${orderReference(order)}. ${consequence}` }); },
        onError: (error) => { setOpen(false); onNotice({ tone: "error", text: error instanceof ApiRequestError && error.status === 409
          ? "Este pedido ya no se puede cancelar." : "No pudimos cancelar el pedido. Revisa su estado e inténtalo otra vez." }); },
      })}>
      <p className={classes.dialogText}>{consequence}</p>
      <p className={classes.dialogText}>Los libros reservados quedarán libres.</p>
    </ConfirmDialog>
  </div>;
}
