import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { TransactionButtonLabel } from "@/shared/ui/TransactionButtonLabel";
import classes from "./profile.module.css";

export type Result = { message: string; error: boolean };

/** One field's inline editor: its input(s) where the value was, Guardar/Cancelar where Editar was; Escape cancels. */
export function EditorFrame({ label, onSubmit, onCancel, saving, saved, children, error, notice, blocked = false, submit = { idle: "Guardar", pending: "Guardando…", success: "Guardado" } }: {
  label: string; onSubmit: () => void; onCancel: () => void; saving: boolean; saved: boolean; children: ReactNode; error: string | null; notice?: string;
  /** The data shown is not current (e.g. a refresh is in flight): the action waits. */
  blocked?: boolean;
  submit?: { idle: string; pending: string; success: string };
}) {
  return <form className={classes.inline} noValidate aria-label={label}
    onSubmit={(event: FormEvent) => { event.preventDefault(); if (!saving && !blocked) onSubmit(); }}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" && !saving && !event.defaultPrevented) { event.preventDefault(); onCancel(); } }}>
    <div className={classes.inlineFields}>
      {children}
      {error && <p className={`${classes.feedback} ${classes.feedbackError}`} role="alert"><MaterialSymbol name="info" aria-hidden="true" size={16} />{error}</p>}
    </div>
    <div className={classes.inlineActionGroup} role="group" aria-label="Acciones de edición">
      <div className={classes.inlineActions}>
        <button type="submit" className={classes.save} aria-disabled={saving || blocked || undefined} aria-busy={saving || undefined}>
          <TransactionButtonLabel state={saving ? "pending" : saved ? "success" : "idle"} idle={submit.idle} pending={submit.pending} success={submit.success} />
        </button>
        <button type="button" className={classes.cancel} aria-disabled={saving || undefined} onClick={() => { if (!saving) onCancel(); }}>Cancelar</button>
      </div>
      {(saving || notice) && <p className={saving ? "visually-hidden" : classes.draftNotice} role="status">
        {saving ? "Guardando cambios." : <><MaterialSymbol name="edit" size={14} aria-hidden="true" />{notice}</>}
      </p>}
    </div>
  </form>;
}
