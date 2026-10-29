import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import classes from "./accountShell.module.css";

/**
 * The Account family: each page stands on its own — a quiet orientation trail (Inicio | page) at the start,
 * then the page name centered on the content axis in the functional face (the header's language, not a
 * second brand statement), an optional intro, then the page body. Moving between Account pages happens in
 * the header's account menu. Each page composes its own body; the shell never forces a shared card layout.
 */
export function AccountShell({ title, trail, intro, before, headingRef, headingId, children }: {
  title: ReactNode;
  /** The page's name in the orientation trail after "Inicio". */
  trail?: string;
  intro?: ReactNode;
  /** Small wayfinding above the title (e.g. "Volver a mis pedidos" on an order). */
  before?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  headingId?: string;
  children: ReactNode;
}) {
  return <div className={`account-page ${classes.shell}`} data-storefront-surface>
    {trail && <nav className={classes.trail} aria-label="Ruta">
      <ol>
        <li><Link to="/" className={classes.trailLink}>Inicio</Link></li>
        <li aria-current="page">{trail}</li>
      </ol>
    </nav>}
    <header className={classes.masthead}>
      {before && <div className={classes.before}>{before}</div>}
      <h1 className={classes.title} ref={headingRef} id={headingId} tabIndex={headingRef ? -1 : undefined}>{title}</h1>
      {intro && <p className={classes.intro}>{intro}</p>}
    </header>
    <div className={classes.body}>{children}</div>
  </div>;
}
