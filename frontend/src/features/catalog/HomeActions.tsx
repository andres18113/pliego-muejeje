import { Button } from "@mantine/core";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./homeEditorial.module.css";

/** Navigation actions shared by the Home's editorial compositions. */
export function HomeActionLink({ to, children, tone = "blue" }: { to: string; children: ReactNode; tone?: "blue" | "yellow" }) {
  return <Button component={Link} to={to} className={classes.action} data-tone={tone} rightSection={<MaterialSymbol name="arrow_forward" size={22} />}>{children}</Button>;
}

/** Read/recovery commands share the Home's sizing and text reflow rules. */
export function HomeActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button type="button" onClick={onClick} className={classes.action} data-tone="blue">{children}</Button>;
}
