import type { CSSProperties } from "react";
import { MaterialSymbol } from "./MaterialSymbol";
import classes from "./accountMonogram.module.css";

const initial = (text: string | null | undefined) => {
  const first = Array.from((text ?? "").trim())[0];
  return first && /\p{L}/u.test(first) ? first.toLocaleUpperCase("es") : "";
};

/**
 * The account's identity mark: the customer's initials on an ultramar disc, or Material `person` when there is
 * no name to draw from. Decorative — the name itself is always beside it as text. It carries no status mark:
 * a dot on an avatar reads as a state (online, unread), so the brand's full stop is not drawn here.
 */
export function AccountMonogram({ firstNames, lastNames, size = 40, className }: {
  firstNames?: string | null;
  lastNames?: string | null;
  size?: number;
  className?: string;
}) {
  const letters = `${initial(firstNames)}${initial(lastNames)}`;
  return <span className={[classes.monogram, className].filter(Boolean).join(" ")} style={{ "--monogram-size": `${size / 16}rem` } as CSSProperties} aria-hidden="true">
    {letters ? <span className={classes.letters}>{letters}</span> : <MaterialSymbol name="person" size={Math.round(size * 0.56)} fill />}
  </span>;
}
