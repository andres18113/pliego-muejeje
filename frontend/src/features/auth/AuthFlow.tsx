import type { ReactNode } from "react";
import { MaterialSymbol, type MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import classes from "./authFlow.module.css";

export { classes as authFlowClasses };

/**
 * One state grammar for registration, verification and recovery: a marked disc, what happened, what to do.
 * waiting = the customer acts elsewhere (their inbox); info = a decision here; success = done;
 * error = it can be tried again; terminal = this link is finished, a new one is needed.
 */
export type AuthStateTone = "waiting" | "info" | "success" | "error" | "terminal";

const toneSymbols: Record<AuthStateTone, MaterialSymbolName> = { waiting: "mail", info: "info", success: "check_circle", error: "error", terminal: "link_off" };

export function AuthState({ tone, symbol, title, titleId, scene = false, children, actions }: {
  tone: AuthStateTone; symbol?: MaterialSymbolName; title: ReactNode; titleId?: string;
  /** The one bounded mist scene: used where the next step happens outside PLIEGO. */
  scene?: boolean; children: ReactNode; actions?: ReactNode;
}) {
  return <section className={classes.state} data-tone={tone} data-scene={scene || undefined} aria-labelledby={titleId}>
    <span className={classes.stateMark} aria-hidden="true"><MaterialSymbol name={symbol ?? toneSymbols[tone]} size={24} fill={tone === "success"} /></span>
    <div className={classes.stateCopy}>
      <h2 className={classes.stateTitle} id={titleId}>{title}</h2>
      {children}
      {actions && <div className={classes.stateActions}>{actions}</div>}
    </div>
  </section>;
}
