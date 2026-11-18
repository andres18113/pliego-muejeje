import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { Button } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { useSessionOperationScope, type SessionOperationScope } from "@/app/sessionOperation";
import { ReadFailure } from "@/features/purchase/CartPage";
import { addressesQueryKey, deleteAddress, listAddresses, setPrimaryAddress, type CustomerAddress } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { AccountShell } from "./AccountShell";
import { AddressEditorDialog } from "./AddressEditorDialog";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { UndoToast, type UndoToastMessage } from "@/shared/ui/UndoToast";
import classes from "./addresses.module.css";
import { useCountries } from "@/shared/api/reference";

type Action = { kind: "delete" | "primary"; addressId: string };

/** How long a confirmed change stays in the snackbar (it waits while hovered or focused). */
export const ADDRESS_TOAST_MS = 10_000;

export function AddressBookPage() {
  return <PurchasePage title="Mis direcciones"><CustomerOnly intent="/account/addresses" task="ver tus direcciones">
    <AccountShell title="Direcciones" trail="Direcciones" intro="Dónde recibes tus libros. La dirección principal aparece primero al finalizar una compra."><AddressBook /></AccountShell>
  </CustomerOnly></PurchasePage>;
}

export function AddressBook() {
  const scope = useSessionOperationScope("address-book");
  const { clear } = useSession();
  const countries = useCountries();
  const query = useQuery({
    queryKey: addressesQueryKey,
    queryFn: ({ signal }) => listAddresses(signal),
    meta: { authRequired: true },
    refetchOnMount: "always",
    retry: false,
  });
  const [formAddressId, setFormAddressId] = useState<string | "new" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Only what still needs the customer: a failure or a list that could not be refreshed. Successes are toasts.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // A confirmed change (saved, added, made primary, deleted) is a passing fact, not a state of the page: one toast,
  // never a banner. Banners stay for what still needs the customer (a failure, a list that could not be refreshed).
  const [toast, setToast] = useState<UndoToastMessage | null>(null);
  const missingRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Dialogs outlive their own close animation: remember what the delete confirmation was asking about.
  const deleteShown = useRef<{ addressId: string; alias: string; where: string } | null>(null);
  // The editor outlives its own close animation: remember what it was showing and give every opening a fresh form.
  const shown = useRef<{ id: string | "new"; opening: number }>({ id: "new", opening: 0 });
  const mutation = useMutation({
    meta: { authRequired: true },
    mutationFn: ({ kind, addressId, scope: issued }: Action & {scope:SessionOperationScope}) => { issued.assertCurrent(); return kind === "delete" ? deleteAddress(addressId) : setPrimaryAddress(addressId); },
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);

  async function perform(action: Action) {
    if (!scope.isCurrent()) return;
    if (mutation.isPending || query.isError || query.isFetching) return;
    setNotice(null);
    const position = query.data?.findIndex((address) => address.addressId === action.addressId) ?? -1;
    try {
      await mutation.mutateAsync({...action,scope});
      if (!scope.isCurrent()) return;
      const current = await query.refetch();
      if (!scope.isCurrent()) return;
      setConfirmDeleteId(null);
      if (action.kind === "delete" && !current.isError) { deleted(position); return; }
      if (!current.isError) { madePrimary(action.addressId); return; }
      setNotice("Guardamos el cambio, pero no pudimos actualizar la lista. Pulsa Actualizar para comprobarlo.");
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) { clear("expired"); return; }
      const current = await query.refetch();
      if (!scope.isCurrent()) return;
      setConfirmDeleteId(null);
      const applied = !current.isError && (action.kind === "delete"
        ? !current.data?.some((address) => address.addressId === action.addressId)
        : current.data?.some((address) => address.addressId === action.addressId && address.primary));
      if (applied && action.kind === "delete") { deleted(position); return; }
      if (applied) { madePrimary(action.addressId); return; }
      if (!(error instanceof ApiRequestError) || error.status >= 500) {
        setNotice("No pudimos confirmar el cambio. Consulta la lista actual antes de decidir si quieres intentarlo otra vez.");
      } else {
        setNotice(`${error.title}. ${error.detail}`);
      }
    }
  }

  /** The deleted object's trigger is gone: focus moves to the address now in its place (or the add tile), and a toast reports it. */
  function deleted(position: number) {
    setToast({ key: Date.now(), message: "Dirección eliminada", detail: deleteShown.current?.alias });
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLElement>("#direcciones .account-address-row");
      const next = rows[Math.min(Math.max(position, 0), rows.length - 1)];
      (next?.querySelector<HTMLElement>("button") ?? document.querySelector<HTMLElement>('#direcciones button[aria-label="Agregar dirección"]'))?.focus({ preventScroll: true });
    });
  }

  function madePrimary(addressId: string) {
    const alias = query.data?.find((address) => address.addressId === addressId)?.alias;
    setToast({ key: Date.now(), message: "Dirección principal actualizada", detail: alias });
  }

  const addresses = query.data;
  const currentRead = !query.isError && !query.isFetching && !mutation.isPending;
  // The editor and the confirmations are modal, so the list behind them keeps its normal, readable state.
  const editable = currentRead;
  const editing = formAddressId === "new" ? undefined : addresses?.find((address) => address.addressId === formAddressId);
  const editorOpen = formAddressId !== null && (formAddressId === "new" || Boolean(editing));
  const shownAddress = shown.current.id === "new" ? undefined : addresses?.find((address) => address.addressId === shown.current.id);
  const missingEditedAddress = formAddressId !== null && formAddressId !== "new" && Boolean(addresses) && !editing;
  useEffect(() => { if (missingEditedAddress) missingRef.current?.focus({ preventScroll: true }); }, [missingEditedAddress]);

  function openEditor(id: string | "new", trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    shown.current = { id, opening: shown.current.opening + 1 };
    setNotice(null);
    setConfirmDeleteId(null);
    setFormAddressId(id);
  }

  function closeEditor() {
    setFormAddressId(null);
    returnFocus();
  }

  function startDelete(address: CustomerAddress, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    deleteShown.current = { addressId: address.addressId, alias: address.alias, where: `${address.line1}, ${address.city}` };
    setNotice(null);
    setConfirmDeleteId(address.addressId);
  }

  function returnFocus() {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  const addButton = addresses && <button type="button" className={classes.addTile} disabled={!editable} aria-label="Agregar dirección" aria-describedby="account-add-address-hint" onClick={(event) => openEditor("new", event.currentTarget)}>
    <span className={classes.addIcon}><MaterialSymbol name="add" aria-hidden="true" size={22} /></span>
    <span className={classes.addCopy}><strong>Agregar dirección</strong><small id="account-add-address-hint">{addresses.length ? "Casa, oficina o donde prefieras recibirlos." : "Agrega una para elegir dónde recibir tus libros al comprar."}</small></span>
  </button>;
  return <section className={`account-section account-addresses ${classes.section}`} id="direcciones" aria-labelledby="account-addresses-heading">
    <h2 id="account-addresses-heading" className="visually-hidden">Direcciones de entrega</h2>
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus direcciones…</p> : !addresses ? <ReadFailure error={query.error} title="No pudimos consultar tus direcciones." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus direcciones. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {notice && <p
        ref={noticeRef}
        tabIndex={-1}
        className="purchase-notice purchase-notice--error"
        role="alert"
      >{notice}</p>}
      {addresses.length === 0 && <div className={`purchase-empty account-address-empty ${classes.empty}`}><h3>Aún no tienes direcciones guardadas.</h3></div>}
      <div className={classes.grid}>
      {addresses.length > 0 && <ul className={`account-address-list ${classes.list}`}>
        {addresses.map((address) => <AddressRow
          key={address.addressId}
          address={address}
          countryName={countries.data?.find((country) => country.code === address.countryCode)?.name ?? new Intl.DisplayNames(["es"], { type: "region" }).of(address.countryCode) ?? ""}
          editable={editable}
          onEdit={(trigger) => openEditor(address.addressId, trigger)}
          onPrimary={() => void perform({ kind: "primary", addressId: address.addressId })}
          onDelete={(trigger) => startDelete(address, trigger)}
        />)}
      </ul>}
      {addButton}
      </div>
      {missingEditedAddress && <div ref={missingRef} tabIndex={-1} className="purchase-problem" role="alert" aria-label="Esta dirección ya no está guardada."><h3>Esta dirección ya no está guardada.</h3><p>Actualizamos tu lista de direcciones. Puedes elegir otra o agregar una nueva.</p><Button variant="secondary" type="button" onClick={() => setFormAddressId(null)}>Volver a la lista</Button></div>}
      <AddressEditorDialog
        opened={editorOpen}
        opening={shown.current.opening}
        address={shownAddress}
        firstAddress={addresses.length === 0}
        disabled={query.isError || query.isFetching || mutation.isPending}
        onClose={closeEditor}
        onSaved={async (addressId) => {
          if (!scope.isCurrent()) return;
          const edited = Boolean(shownAddress);
          const current = await query.refetch();
          if (!scope.isCurrent()) return;
          setFormAddressId(null);
          if (current.isError) {
            setNotice("Guardamos la dirección, pero no pudimos actualizar la lista. Pulsa Actualizar para comprobarla.");
            return;
          }
          // Called only after the server confirmed the write; focus goes back to what opened the editor.
          const alias = current.data?.find((address) => address.addressId === addressId)?.alias;
          setToast({ key: Date.now(), message: edited ? "Dirección actualizada" : "Dirección agregada", detail: alias });
          returnFocus();
        }}
        onUncertain={async () => { if (scope.isCurrent()) await query.refetch(); }}
        onSessionExpired={() => { if (scope.isCurrent()) clear("expired"); }}
      />
      <ConfirmDialog opened={confirmDeleteId !== null} destructive title={`¿Eliminar «${deleteShown.current?.alias ?? ""}»?`}
        confirmLabel="Eliminar dirección" busyLabel="Eliminando…" keepLabel="Conservar dirección" busy={mutation.isPending}
        onConfirm={() => { if (confirmDeleteId) void perform({ kind: "delete", addressId: confirmDeleteId }); }}
        onKeep={() => { setConfirmDeleteId(null); returnFocus(); }}>
        <p>Ya no podrás elegir {deleteShown.current?.where} en compras nuevas.</p>
        <p>Los pedidos anteriores conservan los datos de entrega con los que se hicieron.</p>
      </ConfirmDialog>
    </>}
    <UndoToast toast={toast} onDismiss={() => setToast(null)} duration={ADDRESS_TOAST_MS} />
  </section>;
}

function AddressRow({ address, countryName, editable, onEdit, onPrimary, onDelete }: {
  address: CustomerAddress;
  countryName: string;
  editable: boolean;
  onEdit: (trigger: HTMLButtonElement) => void;
  onPrimary: () => void;
  onDelete: (trigger: HTMLButtonElement) => void;
}) {
  return <li className={`account-address-row ${classes.object}`} data-primary={address.primary || undefined}>
    <div className={classes.objectHead}>
      <h3 className={classes.alias}>{address.alias}</h3>
      {address.primary && <span className={classes.primaryMark}><span className={classes.primaryDot} aria-hidden="true" />Principal</span>}
    </div>
    <address className={classes.lines}>
      <span className={classes.recipient}>{address.recipient}</span>
      <span>{address.line1}{address.line2 && <>, {address.line2}</>}</span>
      <span>{address.city}, {address.province}, {countryName}{address.postalCode && <> · {address.postalCode}</>}</span>
      <span className={classes.phone}>{parsePhoneNumberFromString(address.phone)?.formatInternational() ?? address.phone}</span>
    </address>
    {address.reference && <p className={classes.reference}>{address.reference}</p>}
    {/* An older address whose city is not in the catalog (ADR 0044): it still delivers, but asks for its city once. */}
    {address.cityNeedsReview && <p className={classes.cityReview}><MaterialSymbol name="info" aria-hidden="true" size={16} />Elige su ciudad de la lista con Editar para usarla también en tus facturas.</p>}
    <div className={`account-address-actions ${classes.actions}`}>
      {!address.primary && <Button variant="secondary" type="button" className={classes.makePrimary} disabled={!editable} onClick={onPrimary}>Usar como principal<span className="visually-hidden"> {address.alias}</span></Button>}
      <Button variant="text" type="button" className={`${classes.quiet} ${classes.edit}`} disabled={!editable} onClick={(event) => onEdit(event.currentTarget)}><MaterialSymbol name="edit" aria-hidden="true" size={16} />Editar <span className="visually-hidden">{address.alias}</span></Button>
      <Button variant="text" type="button" className={`${classes.quiet} ${classes.remove}`} disabled={!editable} onClick={(event) => onDelete(event.currentTarget)}><MaterialSymbol name="delete" aria-hidden="true" size={16} />Eliminar <span className="visually-hidden">{address.alias}</span></Button>
    </div>
  </li>;
}
