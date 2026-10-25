import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MaterialSymbol } from "./MaterialSymbol";
import classes from "./parentLink.module.css";

/**
 * A child page's way back to its parent ("Volver a Ayuda", "Volver al carrito"): the first line under the header,
 * on the content's start edge, naming its destination so the result is predictable. Primary sections reached
 * from the header carry none; the edition page keeps its own arrow and trail.
 */
export function ParentLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className={classes.link}><MaterialSymbol name="arrow_back" aria-hidden="true" size={20} /><span>{children}</span></Link>;
}
