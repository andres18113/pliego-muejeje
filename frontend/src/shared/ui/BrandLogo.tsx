import classes from "./brandLogo.module.css";

/**
 * PLIEGO's approved logo, drawn from the runtime copies of `docs/design/brand` under `/brand`. Decorative: the link
 * or region that holds it carries the name. Its height is `--brand-height`, set by the place that uses it.
 * `compact` swaps the lockup for the mark where the bar is too narrow for both: "narrow" under 360px, "phone" under 600px.
 * The reverse drawings stand in on the dark scheme's grounds.
 */
export function BrandLogo({ className, compact }: { className?: string; compact?: "narrow" | "phone" }) {
  return <span className={`${classes.root}${className ? ` ${className}` : ""}`} data-compact={compact} aria-hidden="true">
    <img className={`${classes.logo} ${classes.light}`} src="/brand/pliego-logo.svg" alt="" width={172} height={40} />
    <img className={`${classes.logo} ${classes.dark}`} src="/brand/pliego-logo-reverse.svg" alt="" width={172} height={40} />
    {compact && <>
      <img className={`${classes.mark} ${classes.light}`} src="/brand/pliego-mark.svg" alt="" width={32} height={40} />
      <img className={`${classes.mark} ${classes.dark}`} src="/brand/pliego-mark-reverse.svg" alt="" width={32} height={40} />
    </>}
  </span>;
}
