import classes from "./homeMascot.module.css";

/**
 * PLIEGO's brand character: a soft, calm form with one gently folded corner,
 * looking toward a full stop. Purely decorative — the hero's heading carries the message.
 */
export function HomeMascot({ className }: { className?: string }) {
  return <svg className={`${classes.mascot}${className ? ` ${className}` : ""}`} viewBox="0 0 600 562" aria-hidden="true" focusable="false">
    <circle className={classes.stop} cx="118" cy="132" r="50" />
    <g className={classes.figure}>
      <path className={classes.body} d="M210 560C162 560 142 532 142 482C142 318 226 182 360 176C384 175 400 182 414 196L494 276C508 290 514 306 514 330V482C514 532 494 560 446 560Z" />
      <path className={classes.fold} d="M420 202L486 268H440Q420 268 420 248Z" />
      <g className={classes.face}>
        <path className={classes.mark} d="M258 356q10 8 20 0" />
        <path className={classes.mark} d="M340 352q10 8 20 0" />
        <path className={classes.mark} d="M302 386q10 7 20 0" />
      </g>
    </g>
  </svg>;
}
