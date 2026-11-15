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
      {/* The draft's state belongs to what was typed: the last helper line of the fields, aligned with their text,
          never under the actions (where it would push Guardar/Cancelar off their line). */}
      {notice && !saving && <p className={classes.draftNotice} role="status">{notice}</p>}
    </div>
    <div className={classes.inlineActions} role="group" aria-label="Acciones de edición">
      <button type="submit" className={classes.save} aria-disabled={saving || blocked || undefined} aria-busy={saving || undefined}>
        <TransactionButtonLabel state={saving ? "pending" : saved ? "success" : "idle"} idle={submit.idle} pending={submit.pending} success={submit.success} />
      </button>
      <button type="button" className={classes.cancel} aria-disabled={saving || undefined} onClick={() => { if (!saving) onCancel(); }}>Cancelar</button>
      {saving && <span className="visually-hidden" role="status">Guardando cambios.</span>}
    </div>
  </form>;
}
