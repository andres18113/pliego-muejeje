import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { useSession } from "@/app/session";
import { AddressForm } from "@/features/purchase/AddressForm";
import { ReadFailure } from "@/features/purchase/CartPage";
import { addressesQueryKey, deleteAddress, listAddresses, setPrimaryAddress, type CustomerAddress } from "@/shared/api/customer";
import { ApiRequestError } from "@/shared/api/errors";
import { CustomerOnly, PurchasePage } from "@/features/purchase/PurchaseChrome";
import { AccountNavigation } from "./AccountNavigation";
import { useCountries } from "@/shared/api/reference";

type Action = { kind: "delete" | "primary"; addressId: string };

export function AddressBookPage() {
  return <PurchasePage title="Mis direcciones"><CustomerOnly intent="/account/addresses" task="ver tus direcciones">
    <div className="account-page"><header className="purchase-heading"><h1>Mis direcciones</h1><p>Guarda tus lugares de entrega para elegirlos al comprar.</p></header><AccountNavigation /><AddressBook /></div>
  </CustomerOnly></PurchasePage>;
}

export function AddressBook() {
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
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const missingRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: ({ kind, addressId }: Action) => kind === "delete" ? deleteAddress(addressId) : setPrimaryAddress(addressId),
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401) clear("expired");
  }, [clear, query.error]);
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);
  useEffect(() => { if (confirmDeleteId) confirmRef.current?.focus({ preventScroll: true }); }, [confirmDeleteId]);

  async function perform(action: Action) {
    if (mutation.isPending || query.isError || query.isFetching) return;
    setNotice(null);
    const wasPrimary = query.data?.find((address) => address.addressId === action.addressId)?.primary;
    try {
      await mutation.mutateAsync(action);
      const current = await query.refetch();
      setConfirmDeleteId(null);
      setNotice({ text: current.isError ? "Guardamos el cambio, pero no pudimos actualizar la lista. Pulsa Actualizar para comprobarlo." : action.kind === "primary"
        ? "Esta es ahora tu dirección principal."
        : wasPrimary && current.data?.length ? "Eliminamos la dirección. Elige otra como principal para tus próximas compras." : "Eliminamos la dirección.", error: current.isError });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) { clear("expired"); return; }
      const current = await query.refetch();
      setConfirmDeleteId(null);
      const applied = !current.isError && (action.kind === "delete"
        ? !current.data?.some((address) => address.addressId === action.addressId)
        : current.data?.some((address) => address.addressId === action.addressId && address.primary));
      if (!(error instanceof ApiRequestError) || error.status >= 500) {
        setNotice({ text: applied
          ? action.kind === "delete" ? "Confirmamos que la dirección ya no está guardada." : "Confirmamos que esta es tu dirección principal."
          : "No pudimos confirmar el cambio. Consulta la lista actual antes de decidir si quieres intentarlo otra vez.", error: !applied });
      } else {
        setNotice({ text: `${error.title}. ${error.detail}`, error: true });
      }
    }
  }

  const addresses = query.data;
  const currentRead = !query.isError && !query.isFetching && !mutation.isPending;
  const editable = currentRead && formAddressId === null && confirmDeleteId === null;
  const editing = formAddressId === "new" ? undefined : addresses?.find((address) => address.addressId === formAddressId);
  const missingEditedAddress = formAddressId !== null && formAddressId !== "new" && Boolean(addresses) && !editing;
  useEffect(() => { if (missingEditedAddress) missingRef.current?.focus({ preventScroll: true }); }, [missingEditedAddress]);

  function startEdit(addressId: string, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setNotice(null);
    setConfirmDeleteId(null);
    setFormAddressId(addressId);
  }

  function startDelete(addressId: string, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setNotice(null);
    setConfirmDeleteId(addressId);
  }

  function returnFocus() {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  return <section className="account-section account-addresses" id="direcciones" aria-labelledby="account-addresses-heading">
    <div className="account-section-heading">
      <div><h2 id="account-addresses-heading">Direcciones de entrega</h2><p>Elige una dirección principal para encontrarla primero al finalizar una compra.</p></div>
      {addresses && formAddressId === null && <Button variant="secondary" type="button" disabled={!editable} onClick={(event) => { triggerRef.current = event.currentTarget; setNotice(null); setFormAddressId("new"); }}>Agregar dirección</Button>}
    </div>
    {query.isPending ? <p className="purchase-loading" role="status">Consultando tus direcciones…</p> : !addresses ? <ReadFailure title="No pudimos consultar tus direcciones." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : <>
      {query.isError && <p className="stale-data-note" role="status">No pudimos actualizar tus direcciones. Se muestra la última consulta disponible. <Button variant="text" type="button" onClick={() => void query.refetch()}>Actualizar</Button></p>}
      {notice && <p ref={noticeRef} tabIndex={-1} className={`purchase-notice ${notice.error ? "purchase-notice--error" : "purchase-notice--success"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      {addresses.length === 0 && <div className="purchase-empty account-address-empty"><h3>Aún no tienes direcciones guardadas.</h3><p>Agrega una para elegir dónde recibir tus libros al finalizar una compra.</p></div>}
      {addresses.length > 0 && <ul className="account-address-list">
        {addresses.map((address) => <AddressRow
          key={address.addressId}
          address={address}
          countryName={countries.data?.find((country) => country.code === address.countryCode)?.name ?? new Intl.DisplayNames(["es"], { type: "region" }).of(address.countryCode) ?? ""}
          editable={editable}
          canConfirm={currentRead}
          busy={mutation.isPending}
          confirming={confirmDeleteId === address.addressId}
          confirmRef={confirmRef}
          onEdit={(trigger) => startEdit(address.addressId, trigger)}
          onPrimary={() => void perform({ kind: "primary", addressId: address.addressId })}
          onDelete={(trigger) => startDelete(address.addressId, trigger)}
          onConfirmDelete={() => void perform({ kind: "delete", addressId: address.addressId })}
          onKeep={() => { setConfirmDeleteId(null); returnFocus(); }}
        />)}
      </ul>}
      {missingEditedAddress && <div ref={missingRef} tabIndex={-1} className="purchase-problem" role="alert" aria-label="Esta dirección ya no está guardada."><h3>Esta dirección ya no está guardada.</h3><p>Actualizamos tu lista de direcciones. Puedes elegir otra o agregar una nueva.</p><Button variant="secondary" type="button" onClick={() => setFormAddressId(null)}>Volver a la lista</Button></div>}
      {formAddressId !== null && (formAddressId === "new" || editing) && <AddressForm
        key={formAddressId}
        address={editing}
        firstAddress={addresses.length === 0}
        focusOnMount
        disabled={query.isError || query.isFetching || mutation.isPending}
        onSaved={async () => {
          const current = await query.refetch();
          setFormAddressId(null);
          setNotice({ text: current.isError ? "Guardamos la dirección, pero no pudimos actualizar la lista. Pulsa Actualizar para comprobarla." : editing ? "Guardamos los cambios de la dirección." : "Guardamos la dirección. Ya puedes elegirla al finalizar una compra.", error: current.isError });
        }}
        onCancel={() => { setFormAddressId(null); returnFocus(); }}
        onUncertain={async () => { await query.refetch(); }}
        onSessionExpired={() => clear("expired")}
      />}
    </>}
  </section>;
}

function AddressRow({ address, countryName, editable, canConfirm, busy, confirming, confirmRef, onEdit, onPrimary, onDelete, onConfirmDelete, onKeep }: {
  address: CustomerAddress;
  countryName: string;
  editable: boolean;
  canConfirm: boolean;
  busy: boolean;
  confirming: boolean;
  confirmRef: React.RefObject<HTMLButtonElement | null>;
  onEdit: (trigger: HTMLButtonElement) => void;
  onPrimary: () => void;
  onDelete: (trigger: HTMLButtonElement) => void;
  onConfirmDelete: () => void;
  onKeep: () => void;
}) {
  return <li className="account-address-row">
    <div className="account-address-copy">
      <h3><MapPin aria-hidden="true" size={19} />{address.alias}{address.primary && <span className="choice-tag">Principal</span>}</h3>
      <address>
        {address.line1}{address.line2 && <>, {address.line2}</>}<br />
        {address.city}, {address.province}, {countryName}{address.postalCode && <> · {address.postalCode}</>}<br />
        {address.phone}
      </address>
      {address.reference && <p>{address.reference}</p>}
    </div>
    <div className="account-address-actions">
      <Button variant="text" type="button" disabled={!editable} onClick={(event) => onEdit(event.currentTarget)}><Pencil aria-hidden="true" size={16} />Editar <span className="visually-hidden">{address.alias}</span></Button>
      {!address.primary && <Button variant="text" type="button" disabled={!editable} onClick={onPrimary}>Elegir {address.alias} como principal</Button>}
      <Button variant="text" type="button" disabled={!editable} onClick={(event) => onDelete(event.currentTarget)}><Trash2 aria-hidden="true" size={16} />Eliminar <span className="visually-hidden">{address.alias}</span></Button>
    </div>
    {confirming && <div className="account-delete-confirm" role="group" aria-label={`Eliminar ${address.alias}`}>
      <p>¿Eliminar {address.alias}? Ya no podrás elegir esta dirección para compras nuevas. Los pedidos anteriores conservarán sus datos de entrega.</p>
      <div className="purchase-actions">
        <Button ref={confirmRef} variant="secondary" type="button" disabled={!canConfirm} onClick={onConfirmDelete}>{busy ? "Eliminando…" : "Confirmar eliminación"}</Button>
        <Button variant="text" type="button" disabled={busy} onClick={onKeep}>Conservar dirección</Button>
      </div>
    </div>}
  </li>;
}
