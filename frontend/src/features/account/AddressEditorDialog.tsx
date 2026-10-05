import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { AddressForm } from "@/features/purchase/AddressForm";
import type { CustomerAddress } from "@/shared/api/customer";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { ConfirmDialog } from "./ConfirmDialog";
import shellClasses from "./accountShell.module.css";
import classes from "./addresses.module.css";

/**
 * PLIEGO's address editor, shared by Direcciones and Checkout: the address form in a sheet-tone panel over a
 * light ink veil (a full-height sheet on phones). Escape, the close button, the veil and Cancelar all leave
 * the same way — never while a request is in flight, and never over typed data without asking. The caller
 * owns what is being edited, what happens after a save, and where focus returns.
 */
export function AddressEditorDialog({ opened, opening, address, firstAddress, disabled, onClose, onSaved, onUncertain, onSessionExpired }: {
  opened: boolean;
  /** Changes with every opening so each one gets a fresh form. */
  opening: number;
  /** The address being edited; none when adding. */
  address?: CustomerAddress;
  firstAddress: boolean;
  disabled?: boolean;
  /** The editor was dismissed without saving. */
  onClose: () => void;
  onSaved: (addressId: string) => Promise<void> | void;
  onUncertain: () => Promise<void> | void;
  onSessionExpired: () => void;
}) {
  const phone = useMediaQuery("(max-width: 599px)");
  const reduceMotion = useReducedMotion();
  const formState = useRef({ dirty: false, busy: false });
  const resumeRef = useRef<HTMLElement | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const trackForm = useCallback((state: { dirty: boolean; busy: boolean }) => { formState.current = state; }, []);
  useEffect(() => { formState.current = { dirty: false, busy: false }; setDiscarding(false); }, [opening]);

  function requestClose() {
    if (formState.current.busy || discarding) return;
    if (!formState.current.dirty) { onClose(); return; }
    resumeRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDiscarding(true);
  }

  function keepEditing() {
    setDiscarding(false);
    requestAnimationFrame(() => {
      const previous = resumeRef.current;
      (previous?.isConnected && previous.closest("[role='dialog']") ? previous : document.getElementById("address-form-heading"))?.focus({ preventScroll: true });
    });
  }

  return <>
    <Modal.Root opened={opened} onClose={requestClose} fullScreen={phone} size={680} yOffset="max(24px, 6dvh)"
      returnFocus={false} closeOnEscape={false}
      // Escape is read here, not on the window: a country or prefix list opened from the form (its own layer,
      // outside this element) takes its Escape without also closing the editor.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing || !event.currentTarget.contains(event.target as Node)) return;
        event.stopPropagation();
        requestClose();
      }}
      classNames={{ content: `account-page storefront-panel ${shellClasses.shell} ${classes.editor}` }}
      transitionProps={{ transition: phone ? "slide-up" : "pop", duration: reduceMotion ? 0 : 220, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}>
      <Modal.Overlay backgroundOpacity={0.28} color="#252740" />
      <Modal.Content aria-label={address ? `Editar ${address.alias}` : "Nueva dirección"}>
        <div className={classes.editorClose}>
          <button type="button" aria-label="Cerrar sin guardar" onClick={requestClose}><MaterialSymbol name="close" aria-hidden="true" size={22} /></button>
        </div>
        <div className={classes.editorBody}>
          <AddressForm
            key={opening}
            address={address}
            firstAddress={firstAddress}
            focusOnMount
            disabled={disabled}
            onStateChange={trackForm}
            onSaved={async (addressId) => { setDiscarding(false); await onSaved(addressId); }}
            onCancel={requestClose}
            onUncertain={onUncertain}
            onSessionExpired={onSessionExpired}
          />
        </div>
      </Modal.Content>
    </Modal.Root>
    <ConfirmDialog opened={discarding && opened} zIndex={250} title="¿Descartar los cambios?"
      confirmLabel="Descartar cambios" keepLabel="Seguir editando" onConfirm={() => { setDiscarding(false); onClose(); }} onKeep={keepEditing}>
      <p>{address ? `Lo que cambiaste en «${address.alias}» no se guardará.` : "La dirección que empezaste a escribir no se guardará."}</p>
    </ConfirmDialog>
  </>;
}
