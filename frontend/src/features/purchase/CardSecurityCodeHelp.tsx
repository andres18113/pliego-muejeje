import { Modal } from "@mantine/core";
import { useId, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import type { CardBrand } from "./purchaseText";
import classes from "./cardSecurityCodeHelp.module.css";
import flow from "./purchaseFlow.module.css";

export function CardSecurityCodeHelp({ controlId, brand, opened, onChange, triggerRef, disabled, reducedMotion }: {
  controlId: string; brand: CardBrand | null; opened: boolean; onChange: (opened: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>; disabled: boolean; reducedMotion: boolean;
}) {
  const id = useId();
  const front = brand === "amex";
  function restoreFocus() {
    const trigger = triggerRef.current;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
  }
  function closeWithFocus() {
    onChange(false);
    // Let the card dialog reactivate its focus trap before restoring this trigger.
    window.setTimeout(restoreFocus, 10);
  }

  return <div className={classes.labelRow}>
    <label htmlFor={controlId}>Código de seguridad</label>
    <button ref={triggerRef} type="button" className={classes.trigger} disabled={disabled}
      aria-label="Ayuda sobre el código de seguridad" aria-haspopup="dialog" aria-expanded={opened}
      aria-controls={opened ? `${id}-panel` : undefined} onClick={() => onChange(true)}>
      <MaterialSymbol name="info" size={20} />
    </button>
    <Modal.Root opened={opened} onClose={closeWithFocus} centered size={360} zIndex={400} returnFocus={false}
      onExitTransitionEnd={restoreFocus}
      classNames={{ content: `${flow.flow} ${classes.panel}`, header: classes.header, title: classes.title, body: classes.body }}
      transitionProps={{ transition: "fade", duration: reducedMotion ? 0 : 140 }}>
      <Modal.Overlay backgroundOpacity={0.22} color="#252740" />
      <Modal.Content id={`${id}-panel`} aria-describedby={`${id}-description`}>
        <Modal.Header role="presentation"><Modal.Title data-autofocus tabIndex={-1}>Código de seguridad</Modal.Title></Modal.Header>
        <Modal.Body>
        <p id={`${id}-description`}>{front ? "Busca los 4 dígitos en el frente de tu tarjeta." : "Busca los 3 dígitos en el reverso de tu tarjeta."}</p>
        <svg className={classes.illustration} viewBox="0 0 240 160" role="img" aria-labelledby={`${id}-illustration`} focusable="false">
          <title id={`${id}-illustration`}>{front ? "Código de 4 dígitos en el frente de la tarjeta" : "Código de 3 dígitos al reverso de la tarjeta"}</title>
          <rect className={classes.card} x="8" y="18" width="224" height="132" rx="14" />
          {front ? <>
            <rect className={classes.chip} x="30" y="48" width="35" height="26" rx="5" />
            <path className={classes.cardLines} d="M30 105h30m12 0h30m12 0h30m12 0h30M30 125h68" />
            <rect className={classes.codeBox} x="155" y="48" width="58" height="30" rx="4" />
            <text className={classes.digits} x="184" y="68" textAnchor="middle">1234</text>
          </> : <>
            <path className={classes.stripe} d="M8 45h224v27H8z" />
            <rect className={classes.signature} x="29" y="90" width="125" height="23" rx="3" />
            <rect className={classes.codeBox} x="165" y="86" width="48" height="31" rx="4" />
            <text className={classes.digits} x="189" y="107" textAnchor="middle">123</text>
          </>}
        </svg>
        <div className={classes.actions}><Button variant="secondary" type="button" onClick={closeWithFocus}>Entendido</Button></div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  </div>;
}
