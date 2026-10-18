import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/session";
import { useSessionOperationScope } from "@/app/sessionOperation";
import { billingIdentityQueryKey, getBillingIdentity, setBillingIdentity, removeBillingIdentity } from "@/shared/api/customer";
import { ApiRequestError, readRecoveryDetail } from "@/shared/api/errors";
import { ecuadorianCedulaError } from "@/shared/validation/cedula";
import { EcuadorianCedulaInput } from "@/shared/ui/EcuadorianCedulaInput";
import { FieldMessage } from "@/shared/ui/Field";
import { Button } from "@/components/ui/button";
import classes from "./profile.module.css";

export function BillingIdentityEditor() {
  const scope = useSessionOperationScope("profile-billing-identity");
  const { clear } = useSession();
  const query = useQuery({ queryKey: billingIdentityQueryKey, queryFn: ({signal}) => getBillingIdentity(signal), meta: {authRequired:true}, retry:false });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  function close() { setEditing(false); requestAnimationFrame(() => action.current?.focus()); }
  async function save(remove: boolean) {
    if (lock.current || !scope.isCurrent()) return;
    const validation = remove ? null : ecuadorianCedulaError(value);
    if (validation) { setInvalid(validation); input.current?.focus(); return; }
    lock.current = true; setSaving(true); setNotice(null);
    try {
      scope.assertCurrent();
      if (remove) await removeBillingIdentity();
      else await setBillingIdentity({type:"EC_CEDULA",number:value});
      if (!scope.isCurrent()) return;
      await query.refetch();
      if (!scope.isCurrent()) return;
      setNotice(remove ? "Quitamos la cédula de tu perfil. Tus documentos anteriores se conservan." : "Guardamos tu cédula para facturación.");
      close();
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (error instanceof ApiRequestError && error.status === 401) { clear("expired"); return; }
      // A lost reply never causes an automatic replay of a profile write.
      await query.refetch();
      if (!scope.isCurrent()) return;
      setNotice(`No pudimos confirmar el cambio. Revisa el dato actual antes de guardar otra vez. ${readRecoveryDetail(error)}`);
    } finally { lock.current=false; if(scope.isCurrent()) setSaving(false); }
  }
  return <section className={classes.profile} aria-labelledby="billing-profile-heading">
    <h2 id="billing-profile-heading">Identificación para facturación</h2>
    <p>Opcional en tu perfil. Se usa para nuevas facturas a tu nombre.</p>
    <details className={classes.securityDisclosure}>
      <summary>Uso y validación de la cédula</summary>
      <p>Comprobamos el formato y el dígito verificador; no verificamos la titularidad. No cambia documentos anteriores.</p>
      <p>La facturación es una simulación académica sin validez tributaria.</p>
    </details>
    {query.isPending ? <p role="status">Consultando identificación…</p> : query.isError ? <p role="alert">No pudimos consultar tu identificación. <Button type="button" variant="text" onClick={() => void query.refetch()}>Volver a consultar</Button></p> : <>
      <p>Cédula: {query.data ? `••••••${query.data.number.slice(-4)}` : "Sin cédula"}</p>
      {editing ? <form noValidate className={classes.inline} aria-label="Editar cédula" onSubmit={event => {event.preventDefault(); void save(false);}}>
        <div className={classes.inlineFields}><label htmlFor="profile-cedula">Cédula</label>
          <EcuadorianCedulaInput id="profile-cedula" ref={input} value={value} autoFocus disabled={saving} aria-invalid={Boolean(invalid) || undefined} aria-describedby={invalid ? "profile-cedula-error" : "profile-cedula-help"}
            onChange={event => {setValue(event.currentTarget.value); setInvalid(null);}}
            onBlur={event => setInvalid(ecuadorianCedulaError(event.currentTarget.value))}/>
          <FieldMessage id={invalid ? "profile-cedula-error" : "profile-cedula-help"} tone={invalid ? "error" : "help"}>{invalid ?? "Escribe los 10 dígitos de tu cédula."}</FieldMessage>
        </div><div className={classes.inlineActions}>
          <button type="submit" className={classes.save} disabled={saving}>Guardar cédula</button>
          <button type="button" className={classes.cancel} disabled={saving} onClick={close}>Cancelar</button>
          {query.data && <button type="button" className={classes.cancel} disabled={saving} onClick={() => void save(true)}>Quitar cédula</button>}
        </div>
      </form> : <button ref={action} type="button" className={classes.save} onClick={() => {setValue(query.data?.number ?? ""); setInvalid(null); setNotice(null); setEditing(true);}}>{query.data ? "Editar cédula" : "Agregar cédula"}</button>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
