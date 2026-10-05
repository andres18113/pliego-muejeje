import type { ReactNode } from "react";
import { Modal } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { Button } from "@/components/ui/button";
import shellClasses from "./accountShell.module.css";
import classes from "./confirmDialog.module.css";

/**
 * The Account's confirmation: one small sheet over a light ink veil that asks a single question. The title names
 * the decision, the body its consequence, and the two answers are spelled out. Focus opens on the answer that
 * keeps things as they are, which Escape and the veil also give. The caller owns where focus returns.
 */
export function ConfirmDialog({ opened, title, children, confirmLabel, keepLabel, busyLabel, busy = false, destructive = false, zIndex, onConfirm, onKeep }: {
  opened: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  /** The answer that changes nothing. */
  keepLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  zIndex?: number;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return <Modal.Root opened={opened} onClose={() => { if (!busy) onKeep(); }} centered size={440} zIndex={zIndex} returnFocus={false}
    classNames={{ content: `account-page storefront-panel ${shellClasses.shell} ${classes.dialog}`, title: classes.title, body: classes.body }}
    transitionProps={{ transition: "pop", duration: reduceMotion ? 0 : 180, timingFunction: "cubic-bezier(.32, .94, .6, 1)" }}>
    <Modal.Overlay backgroundOpacity={0.28} color="#252740" />
    <Modal.Content>
      <Modal.Title>{title}</Modal.Title>
      <Modal.Body>{children}</Modal.Body>
      <div className={classes.actions}>
        <Button variant="primary" type="button" className={destructive ? classes.destructive : undefined} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) onConfirm(); }}>{busy && busyLabel ? busyLabel : confirmLabel}</Button>
        <Button variant="secondary" type="button" data-autofocus aria-disabled={busy || undefined} onClick={() => { if (!busy) onKeep(); }}>{keepLabel}</Button>
      </div>
    </Modal.Content>
  </Modal.Root>;
}
