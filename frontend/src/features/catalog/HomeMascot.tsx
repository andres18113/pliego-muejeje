import classes from "./homeMascot.module.css";

/**
 * PLIEGO's brand character: a soft, calm form with one gently folded corner,
 * looking toward a full stop. It wears headphones and reads from a small screen: PLIEGO is
 * books to hold, to read on a device and to listen to. Purely decorative — the hero's heading carries the message.
 */
export function HomeMascot({ className }: { className?: string }) {
  return <svg className={`${classes.mascot}${className ? ` ${className}` : ""}`} viewBox="0 0 600 562" aria-hidden="true" focusable="false">
    <circle className={classes.stop} cx="118" cy="132" r="50" />
    <g className={classes.figure}>
      {/* The band follows the head's own outline from behind, around the folded corner; only the ear cups sit in front. */}
      <path className={classes.band} d="M163.8 344.7C196.9 248.1 266.2 180.2 360 176C384 175 400 182 414 196L494 276C508 290 514 306 514 330V352" />
      <path className={classes.body} d="M210 560C162 560 142 532 142 482C142 318 226 182 360 176C384 175 400 182 414 196L494 276C508 290 514 306 514 330V482C514 532 494 560 446 560Z" />
      <path className={classes.fold} d="M420 202L486 268H440Q420 268 420 248Z" />
      <g className={classes.face}>
        <path className={classes.mark} d="M258 356q10 8 20 0" />
        <path className={classes.mark} d="M340 352q10 8 20 0" />
        <path className={classes.mark} d="M302 386q10 7 20 0" />
      </g>
      <rect className={classes.cup} x="134" y="306" width="40" height="92" rx="20" transform="rotate(-9 154 352)" />
      <rect className={classes.cup} x="498" y="306" width="40" height="92" rx="20" />
      <g transform="rotate(-7 318 480)">
        <rect className={classes.cup} x="264" y="410" width="108" height="140" rx="18" />
        <rect className={classes.device} x="274" y="420" width="88" height="104" rx="9" />
        <path className={classes.line} d="M290 444h56M290 466h56M290 488h32" />
      </g>
    </g>
  </svg>;
}
