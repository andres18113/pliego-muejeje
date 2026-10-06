import { Button } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./homeActions.module.css";

/** Read/recovery commands share the Home's sizing and text reflow rules. */
export function HomeActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button type="button" onClick={onClick} className={classes.action} data-tone="blue">{children}</Button>;
}
