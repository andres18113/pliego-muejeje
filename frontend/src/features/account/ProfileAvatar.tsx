import classes from "./profile.module.css";

/**
 * The profile's reader: a small member of PLIEGO's character family (the soft ultramar form with one
 * yellow folded corner and paper-colored marks, beside the yellow full stop), here with lowered eyes
 * over an open book. Decorative — the reader's name follows it as text.
 */
export function ProfileAvatar() {
  return <svg className={classes.avatar} viewBox="96 120 470 450" aria-hidden="true" focusable="false">
    <circle className={classes.avatarStop} cx="140" cy="176" r="34" />
    <g className={classes.avatarFigure}>
      <path className={classes.avatarBody} d="M210 560C162 560 142 532 142 482C142 318 226 182 360 176C384 175 400 182 414 196L494 276C508 290 514 306 514 330V482C514 532 494 560 446 560Z" />
      <path className={classes.avatarFold} d="M420 202L486 268H440Q420 268 420 248Z" />
      <g className={classes.avatarFace}>
        <path className={classes.avatarMark} d="M262 368q10 7 20 0" />
        <path className={classes.avatarMark} d="M344 364q10 7 20 0" />
        <path className={classes.avatarMark} d="M306 398q9 6 18 0" />
      </g>
      <g className={classes.avatarBook}>
        <path className={classes.avatarPage} d="M196 470Q258 446 326 474V552Q258 526 196 548Z" />
        <path className={classes.avatarPage} d="M326 474Q394 446 456 470V548Q394 526 326 552Z" />
        <path className={classes.avatarLines} d="M222 488Q258 476 300 490M222 510Q258 498 300 512M352 490Q394 476 430 488M352 512Q394 498 430 510" />
      </g>
    </g>
  </svg>;
}
